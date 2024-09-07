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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRouteFromGraphhopper(userLatLng, stationLatLng) {
    const graphhopperUrl = `https://graphhopper.com/api/1/route?point=${userLatLng.lat},${userLatLng.lng}&point=${stationLatLng.lat},${stationLatLng.lng}&vehicle=car&locale=pl&calc_points=true&key=bcf14366-6797-4cc7-95f4-eb61c340c243`;

    return fetch(graphhopperUrl)
        .then(response => response.json())
        .then(data => {
            if (data.paths && data.paths.length > 0) {
                return {
                    distance: data.paths[0].distance / 1000, 
                    route: data.paths[0].points 
                };
            }
            return null;
        })
        .catch(error => {
            console.error('Błąd w zapytaniu do GraphHopper:', error);
            return null;
        });
}

function findNearestStation(e) {
    var userClick = e.latlng;
    lastUserClick = userClick;

    var nearestStation = null;
    var nearestDistance = Infinity;

    const routePromises = [];

    let delayMs = 0;

    markers.eachLayer(function(station) {
        var stationLatLng = station.getLatLng();
        var routePromise = delay(delayMs).then(() => {
            return getRouteFromGraphhopper(userClick, stationLatLng).then(result => {
                if (result && result.distance < nearestDistance) {
                    nearestDistance = result.distance;
                    nearestStation = station;
                    return { station, route: result.route };
                }
                return null;
            });
        });

        routePromises.push(routePromise);
        delayMs += 1000;
    });

    Promise.all(routePromises).then(results => {
        var nearestResult = results.find(result => result && result.station === nearestStation);
        if (nearestResult) {
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
                lineOptions: {
                    styles: [{ color: 'blue', opacity: 1, weight: 4 }]
                }
            }).addTo(map);

            redMarker = L.marker(nearestStation.getLatLng(), { icon: redIcon })
                .bindPopup(nearestStation.getPopup().getContent())
                .addTo(map);
        }
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
