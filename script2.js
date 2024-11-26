var map = L.map('map').setView([52.0, 19.0], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);

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

filterControl.onAdd = function (map) {
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
            findThreeNearestStations({ latlng: lastUserClick });
        }
    });
}).catch(error => {
    console.error('Błąd w załadowaniu pliku JSON:', error);
});

var routingControl = null;
var redMarker = null;
var lastUserClick = null;

function findThreeNearestStations(e) {
    var userClick = e.latlng;
    lastUserClick = userClick;
    var userPoint = turf.point([userClick.lng, userClick.lat]);

    // Array to store the three nearest stations
    var nearestStations = [];

    markers.eachLayer(function (station) {
        var stationPoint = turf.point([station.getLatLng().lng, station.getLatLng().lat]);
        var distance = turf.distance(userPoint, stationPoint);

        // Add each station with its distance
        nearestStations.push({ station: station, distance: distance });
    });

    // Sort by distance and take the three nearest stations
    nearestStations.sort((a, b) => a.distance - b.distance);
    nearestStations = nearestStations.slice(0, 3);

    // Now calculate the actual route distance for each of the 3 nearest stations
    var routePromises = nearestStations.map(({ station }) => {
        return new Promise((resolve, reject) => {
            var tempRoutingControl = L.Routing.control({
                waypoints: [L.latLng(userClick.lat, userClick.lng), station.getLatLng()],
                createMarker: () => null,  // Don't create any markers for now
                routeWhileDragging: true,
                language: 'pl',
                addWaypoints: false, // Don't display the route just yet
            }).on('routesfound', function (e) {
                var route = e.routes[0];
                resolve({ station, routeLength: route.summary.totalDistance });
                map.removeControl(tempRoutingControl); // Remove the temporary routing control
            }).on('routingerror', function () {
                reject('Routing error');
            }).addTo(map);

            // We don't add the control to the map, just calculate the route
        });
    });

    Promise.all(routePromises).then(results => {
        // Sort by the actual route length and take the shortest one
        results.sort((a, b) => a.routeLength - b.routeLength);
        var shortest = results[0];

        // Display the shortest route on the map
        if (routingControl) {
            map.removeControl(routingControl);
        }
        if (redMarker) {
            map.removeLayer(redMarker);
        }

        // Now add the shortest route to the map
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(userClick.lat, userClick.lng),
                shortest.station.getLatLng()
            ],
            routeWhileDragging: true,
            language: 'pl',
            addWaypoints: false
        }).on('waypointschanged', function (e) {
            var newPoint = e.waypoints[0].latLng;
            findThreeNearestStations({ latlng: newPoint });
        }).addTo(map);

        // Add the marker for the nearest station
        redMarker = L.marker(shortest.station.getLatLng(), { icon: redIcon })
            .bindPopup(shortest.station.getPopup().getContent())
            .addTo(map);
    }).catch(error => {
        console.error(error);
    });
}

// Replace the click event handler with the new function
map.on('click', findThreeNearestStations);


L.Control.geocoder({ defaultMarkGeocode: false }).on('markgeocode', function (e) {
    var latlng = e.geocode.center;
    map.setView(latlng, map.getZoom());
    findThreeNearestStations({ latlng: latlng });
}).addTo(map);

map.locate({ setView: true, maxZoom: 16 });

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


var legend = L.control({ position: 'bottomleft' });

legend.onAdd = function (map) {
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

clearRouteControl.onAdd = function (map) {
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

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

function toggleMenu() {
    const menu = document.querySelector('.menu');
    menu.classList.toggle('show');
}
