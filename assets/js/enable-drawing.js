var customMarkers = {};
var drawnItems = new L.FeatureGroup();

if (localStorage.getItem("customMarkers") !== '' && localStorage.getObj("customMarkers") !== null) {
    customMarkers = localStorage.getObj("customMarkers");
} else {
    localStorage.setObj("customMarkers", customMarkers);
}

function addCustomMarker(feature) {
    var customMaker = feature.toGeoJSON();
    var uuid = feature.uuid;
    customMarkers[uuid] = customMaker;
    localStorage.setObj("customMarkers", customMarkers);
}

function removeCustomMarker(feature) {
    var uuid = feature.uuid;
    delete customMarkers[uuid];
    localStorage.setObj("customMarkers", customMarkers);
}

function addArrows(line) {
    line.setText(' ➞ ', {repeat: true, offset: 6.5, attributes: {'font-size': 18, fill: 'lightgreen'}});
}

$.each(customMarkers, function(uuid, feature) {
    var geoJSONMarker = L.GeoJSON.geometryToLayer(feature.geometry);
    geoJSONMarker.uuid = uuid;
    addArrows(geoJSONMarker);
    drawnItems.addLayer(geoJSONMarker);
});

function guid() {
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
    }

function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
}

var drawControlFull = new L.Control.Draw({
    position: "bottomleft",
    draw: {
        polyline: {
            shapeOptions: {
                color: "red",
                weight: 4
            }
        },
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
    },
    edit: {
        featureGroup: drawnItems
    }
});

zeldaMap.addLayer(drawnItems);
zeldaMap.addControl(drawControlFull);

zeldaMap.on('draw:created', function (e) {
    tmpMarker = e.layer;
    tmpMarker.uuid = guid();
    addCustomMarker(tmpMarker);
    drawnItems.addLayer(tmpMarker);
});

zeldaMap.on('draw:edited', function (e) {
    var edits = e.layers._layers;
    $.each(edits, function(key, feature) {
        addCustomMarker(feature);
    });
});

zeldaMap.on('draw:deleted', function (e) {
    var edits = e.layers._layers;
    $.each(edits, function(key, feature) {
        removeCustomMarker(feature);
    });
});
