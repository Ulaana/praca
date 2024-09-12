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
var filterControl = L.control({ position: 'topleft' });

filterControl.onAdd = function(map) {
    var div = L.DomUtil.create('div', 'filter-container');

    div.innerHTML = `
        <label for="charging-mode-filter">Wybierz typ ładowania:</label>
        <select id="charging-mode-filter">
            <option value="all">Wszystkie</option>
        </select>`;

    L.DomEvent.disableClickPropagation(div);

    return div;
};

filterControl.addTo(map);

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
    var userPoint = turf.point([userClick.lng, userClick.lat]);
    var nearestStation = null;
    var nearestDistance = Infinity;

    markers.eachLayer(function(station) {
        var stationPoint = turf.point([station.getLatLng().lng, station.getLatLng().lat]);
        var distance = turf.distance(userPoint, stationPoint);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestStation = station;
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
            language: 'pl'
        }).on('waypointschanged', function(e) {
            var newPoint = e.waypoints[0].latLng;  
            findNearestStation({ latlng: newPoint });  
        }).addTo(map);
        redMarker = L.marker(nearestStation.getLatLng(), { icon: redIcon }).bindPopup(nearestStation.getPopup().getContent()).addTo(map);
    }
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
    var div = L.DomUtil.create('div', 'legend');
    
    div.innerHTML = `
        <h3>Legenda</h3>
        <div id="red"></div> Stacja ładowania<br>
        <div id="blue"></div> Punkt użytkownika<br>`;

    L.DomEvent.disableClickPropagation(div);
    
    return div;
};

legend.addTo(map);

var clearRouteControl = L.control({ position: 'topright' });

clearRouteControl.onAdd = function(map) {
    var div = L.DomUtil.create('div', 'clear-route-container');

    div.innerHTML = `
        <button id="remove-route">Wyczyść trasę</button>
    `;

    L.DomEvent.disableClickPropagation(div);

    return div;
};

clearRouteControl.addTo(map);

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
