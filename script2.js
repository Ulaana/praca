var map = L.map('map').setView([51.2465, 22.5684], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19,}).addTo(map);

var markers = L.markerClusterGroup();
var allStations = [];
var redIcon = L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png',
                iconSize: [25, 41],
                shadowSize: [41, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
});

Promise.all([
    fetch('json/operator.json').then(response => response.json()),
    fetch('json/bazy.json').then(response => response.json()),
    fetch('json/stacje.json').then(response => response.json()),
    fetch('json/punkty.json').then(response => response.json()),
    fetch('json/slownik.json').then(response => response.json())
]).then(([operatorData, bazyData, stacjeData, punktyData, slownikData]) => {

    const chargingModeMap = slownikData.charging_mode.reduce((map, mode) => {
        map[mode.id] = mode.name;
        return map;
    }, {});

    console.log(chargingModeMap);

    const chargingModeFilter = document.getElementById('charging-mode-filter');
    slownikData.charging_mode.forEach(mode => {
        const option = document.createElement('option');
        option.value = mode.id;
        option.textContent = mode.name;
        chargingModeFilter.appendChild(option);
    });

    const aggregatedStations = {};

    punktyData.data.forEach(station => {
        var matchingStacja = stacjeData.data.find(stacja => stacja.id === station.station_id);
        var matchingBaza = bazyData.data.find(baza => baza.id === matchingStacja.pool_id);
        var matchingOperator = operatorData.data.find(operator => operator.id === matchingBaza.operator_id);
        
        if (matchingBaza.charging) {
            var coords = `${matchingStacja.latitude},${matchingStacja.longitude}`;
            if (!aggregatedStations[coords]) {
                aggregatedStations[coords] = {
                    location: matchingStacja.location,
                    operator: matchingOperator.name,
                    chargingSolutions: []
                };
            }
            
            station.charging_solutions.forEach(solution => {
                var modeName = chargingModeMap[solution.mode] || "Nieznany";
                aggregatedStations[coords].chargingSolutions.push({
                    mode: modeName,
                    modeId: solution.mode,
                    power: solution.power
                });
            });
        }
    });

    Object.keys(aggregatedStations).forEach(coords => {
        var station = aggregatedStations[coords];
        var latLng = coords.split(',').map(Number);
        var popupContent = `Miasto: ${station.location.city}<br>Operator: ${station.operator}<br>`;
        
        station.chargingSolutions.forEach(solution => {
            popupContent += `Typ ładowania: ${solution.mode}<br>Moc: ${solution.power} kW<br>`;
        });
        
        var marker = L.marker(latLng, { icon: redIcon }).bindPopup(popupContent);
        marker.chargingSolutions = station.chargingSolutions;
        allStations.push(marker);
        markers.addLayer(marker);
    });

    map.addLayer(markers);

    chargingModeFilter.addEventListener('change', () => {
        var selectedMode = chargingModeFilter.value;
        markers.clearLayers();
        
        allStations.forEach(marker => {
            if (selectedMode === 'all' || marker.chargingSolutions.some(solution => solution.modeId == selectedMode)) {
                markers.addLayer(marker);
            }
        });
        if (lastUserClick) {
            findNearestStation({ latlng: lastUserClick });
        }
    });
}).catch(error => {
    console.error('Błąd w załadowaniu pliku JSON:', error);
});

var routingControl = null;
var redMarker = null;
var lastUserClick = null;

function findNearestStation(e) {
    var userClick = e.latlng;
    lastUserClick = userClick;
    var nearestStation = null;
    var shortestDistance = Infinity;
    var shortestRoute = null; 

    var requests = [];

    markers.eachLayer(function(station) {
        var waypointUser = L.latLng(userClick.lat, userClick.lng);
        var waypointStation = station.getLatLng();

        var routingRequest = new Promise((resolve, reject) => {
            var routingControl = L.Routing.control({
                waypoints: [waypointUser, waypointStation],
                createMarker: function() { return null; }, 
                routeWhileDragging: false,
                addWaypoints: false,
                language: 'pl',
                fitSelectedRoutes: false,
                show: false,
            });

            routingControl.on('routesfound', function(e) {
                var distance = e.routes[0].summary.totalDistance;
                resolve({ station, distance, route: e.routes[0] });
            }).on('routingerror', function(e) {
                reject(e);
            });

            routingControl.spliceWaypoints(0, 2, waypointUser, waypointStation);
        });

        requests.push(routingRequest);
    });

    Promise.all(requests).then(results => {
        results.forEach(result => {
            if (result.distance < shortestDistance) {
                shortestDistance = result.distance;
                nearestStation = result.station;
                shortestRoute = result.route;
            }
        });

        if (nearestStation) {
            if (routingControl) {
                map.removeControl(routingControl);
            }
            if (redMarker) {
                map.removeLayer(redMarker);
            }
            routingControl = L.Routing.control({
                waypoints: [
                    L.latLng(userClick.lat, userClick.lng),
                    nearestStation.getLatLng()
                ],
                routeWhileDragging: true,
                language: 'pl',
                fitSelectedRoutes: true,
                show: true,
            }).addTo(map);

            redMarker = L.marker(nearestStation.getLatLng(), { icon: redIcon }).bindPopup(nearestStation.getPopup().getContent()).addTo(map);
            routingControl.setWaypoints([L.latLng(userClick.lat, userClick.lng), nearestStation.getLatLng()]);
            routingControl.addTo(map).setWaypoints(shortestRoute.waypoints);
        }
    }).catch(error => {
        console.error('Błąd w wyznaczaniu trasy:', error);
    });
}

map.on('click', findNearestStation);


L.Control.geocoder({defaultMarkGeocode: false}).on('markgeocode', function(e) {
    var latlng = e.geocode.center;
    map.setView(latlng, map.getZoom());
    findNearestStation({ latlng: latlng }); 
}).addTo(map);

map.locate({setView: true, maxZoom: 16});

function onLocationFound(e) {
    var radius = e.accuracy / 2;
    L.circle(e.latlng, {
        color: 'blue',
        fillColor: 'blue',
        fillOpacity: 0.5,
        radius: radius,
        fillOpacity: 0,
    }).addTo(map);
}

map.on('locationfound', onLocationFound);

function onLocationError(e) {
    alert("Nie udało się zlokalizować Twojej pozycji.");
}

map.on('locationerror', onLocationError);

var legend = L.control({ position: 'bottomright' });

legend.onAdd = function(map) {
    var div = L.DomUtil.create('div', 'info legend');
    div.style.backgroundColor = 'white';
    div.style.padding = '10px';
    div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';
    
    div.innerHTML += '<h4>Legenda</h4>';
    div.innerHTML += '<i style="background: red; width: 12px; height: 12px; display: inline-block; margin-right: 5px;"></i> Stacja ładowania<br>';
    div.innerHTML += '<i style="background: blue; width: 12px; height: 12px; display: inline-block; margin-right: 5px;"></i> Punkt użytkownika<br>';
    return div;
};

legend.addTo(map);

document.getElementById('remove-route').addEventListener('click', () => {
    if (routingControl) {
        map.removeControl(routingControl); 
        routingControl = null;
    }
    if (redMarker) {
        map.removeLayer(redMarker);
        redMarker = null;
    }
    lastUserClick = null;
});
