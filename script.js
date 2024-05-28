document.addEventListener('DOMContentLoaded', () => {
    var map = L.map('map').setView([51.2465, 22.5684], 13); // Default to Lublin coordinates

    // Add the base map tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
    }).addTo(map);

    // Initialize marker cluster group
    var markers = L.markerClusterGroup();

    // Load data from JSON files
    Promise.all([
        fetch('operator.json').then(response => response.json()),
        fetch('bazy.json').then(response => response.json()),
        fetch('stacje.json').then(response => response.json()),
        fetch('punkty.json').then(response => response.json()),
        fetch('slownik.json').then(response => response.json())
    ]).then(([operatorData, bazyData, stacjeData, punktyData, slownikData]) => {
        // Create a map for charging modes
        const chargingModeMap = slownikData.charging_mode.reduce((map, mode) => {
            map[mode.id] = mode.name;
            return map;
        }, {});

        // Filter stations with charging=true
        punktyData.data.forEach(station => {
            // Find matching station and base
            var matchingStacja = stacjeData.data.find(stacja => stacja.id === station.station_id);
            var matchingBaza = bazyData.data.find(baza => baza.id === matchingStacja.pool_id);

            // Find matching operator
            var matchingOperator = operatorData.data.find(operator => operator.id === matchingBaza.operator_id);

            // Check if charging is true in base data
            if (matchingBaza.charging) {
                var modeId = station.charging_solutions[0] && station.charging_solutions[0].mode;
                var modeName = chargingModeMap[modeId] || "Nieznany";
                var power = station.charging_solutions[0] && station.charging_solutions[0].power;
                var popupContent = "Miasto: " + matchingStacja.location.city + "<br>Operator: " + matchingOperator.name + "<br>Typ ładowania: " + modeName + "<br>Moc: " + power + " kW";

                // Create marker and bind popup
                var marker = L.marker([matchingStacja.latitude, matchingStacja.longitude]).bindPopup(popupContent);

                // Add marker to cluster group
                markers.addLayer(marker);
            }
        });

        // Add cluster group to map
        map.addLayer(markers);
    });

    var routingControl = null; // Reference to routing control

    function findNearestStation(e) {
        var userClick = e.latlng;
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
                map.removeControl(routingControl); // Remove previous routing control
            }

            routingControl = L.Routing.control({
                waypoints: [
                    L.latLng(userClick.lat, userClick.lng),
                    nearestStation.getLatLng()
                ],
                routeWhileDragging: true,
                language: 'pl' // Set language to Polish
            }).addTo(map);
        }
    }

    map.on('click', findNearestStation);

    // Add geocoder control to search for addresses or coordinates
    L.Control.geocoder().addTo(map);

    // Try to get user's location
    map.locate({setView: true, maxZoom: 16});

    // Handle location found
    function onLocationFound(e) {
        var radius = e.accuracy / 2;

        L.circle(e.latlng, {
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0.5,
            radius: radius
        }).addTo(map).bindPopup("Twoja lokalizacja (dokładność " + radius + " metrów)");
    }

    map.on('locationfound', onLocationFound);

    // Handle location error
    function onLocationError(e) {
        alert("Nie udało się zlokalizować Twojej pozycji.");
    }

    map.on('locationerror', onLocationError);
});
