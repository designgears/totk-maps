$.ajaxSetup({ cache: false });

var tileSize = 256,
    factorx = 1 / (tileSize / 3), // 3 image pixels per game unit
    factory = 1 / (tileSize / 3),
    imageheight = 30000,
    imagewidth = 36000;

L.CRS.Zelda = L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(factorx, 70.31, -factory, 58.59),
});

var overlays = new Object(),
    markers = new Object(),
    groupedOverlays = new Object();

var zeldaMap = L.map("map", {
    minZoom: 0,
    maxZoom: 10,
    tileSize: 256,
    attributionControl: false,
    crs: L.CRS.Zelda,
    renderer: L.canvas(),
});

var southWest = zeldaMap.unproject([0, imageheight], 8),
    northEast = zeldaMap.unproject([imagewidth, 0], 8),
    bounds = L.latLngBounds(southWest, northEast)

zeldaMap.setView(L.latLng(-1432, 395), 5);

var tile_url = 'https://raw.githubusercontent.com/designgears/totk-map-assets/main/tiles/';

var sky = L.tileLayer(tile_url + 'sky_complete/{z}/{x}/{y}.png', { maxNativeZoom: 8, bounds: bounds, name: 'Sky' }),
    surface = L.tileLayer(tile_url + 'ground/{z}/{x}/{y}.png', { maxNativeZoom: 8, bounds: bounds, name: 'Surface' }),
    depths = L.tileLayer(tile_url + 'underground/{z}/{x}/{y}.png', { maxNativeZoom: 8, bounds: bounds, name: 'Depths' }),
    baseLayers = {
        "Sky": sky,
        "Surface": surface,
        "Depths": depths,
    };

var fuseOptions = {
    position: 'topleft',
    maxResultLength: 50,
    threshold: 0.2,
    showInvisibleFeatures: false,
};

// var searchCtrl = L.control.fuseSearch(fuseOptions).addTo(zeldaMap);
sky.addTo(zeldaMap);
new L.Hash(zeldaMap);

function onEachFeature(feature, layer) {

    feature.layer = layer;

    if (feature.properties.title && feature.properties.category != 'Labels') {
        layer.bindPopup(
            '<div>'
            +feature.properties.title
            +'<br />'+feature.properties.description
            +'<br />'+feature.properties.position
            +'<br /><span class="status">'+feature.properties.completed+'</span>'
            +'</div>'
        )
    }

    layer.addTo(groupedOverlays[feature.properties.map][feature.properties.category][feature.properties.subcat]);

}

function pointToLayer(feature, latlng) {

    addToOverlays(feature.properties.map, feature.properties.category, feature.properties.subcat);

    var markerOptions = {
        icon: feature.properties.icon,
        color: feature.properties.color
    }
    return L.canvasMarker(latlng, markerOptions);
}

function addToOverlays(map, category, subcat) {
    if (!(map in groupedOverlays)) {
        groupedOverlays[map] = {};
    }
    if (!(category in groupedOverlays[map])) {
        groupedOverlays[map][category] = {};
    }
    if (!(subcat in groupedOverlays[map][category])) {
        groupedOverlays[map][category][subcat] = new L.LayerGroup();
    }
}

var control;
$.getJSON("/data.json", function(markers) {
    L.geoJSON(markers, {
        pointToLayer: pointToLayer,
        onEachFeature: onEachFeature
    });

    var menu_options = {
        groupCheckboxes: true,
        collapsed: false,
        groupsCollapsable: true,
        groupsExpandedClass: 'bi bi-caret-down-square-fill',
        groupsCollapsedClass: 'bi bi-caret-right-square-fill',
    };

    control = L.control.groupedLayers(baseLayers, groupedOverlays['Sky'], menu_options).addTo(zeldaMap);
    //searchCtrl.indexFeatures(markers, ['title', 'contents']);
});

zeldaMap.on('baselayerchange', (e) => {
    previousBaseLayer = currentBaseLayer;
    currentBaseLayer = e.name;
    updateLayers();
})

var currentBaseLayer = 'Sky';
var previousBaseLayer;
function updateLayers() {

    // this entire function needs to be built into leaflet.groupedlayercontrol.js

    if (previousBaseLayer) {
        for (var category in groupedOverlays[previousBaseLayer]) {
            for (var subcat in groupedOverlays[previousBaseLayer][category]) {
                for (var marker in groupedOverlays[previousBaseLayer][category][subcat]._layers) {
                    groupedOverlays[previousBaseLayer][category][subcat]._layers[marker].remove();
                }
                control.removeLayer(groupedOverlays[previousBaseLayer][category][subcat]);
            }
        }
    }

    for (var category in groupedOverlays[currentBaseLayer]) {
        for (var subcat in groupedOverlays[currentBaseLayer][category]) {
            for (var marker in groupedOverlays[currentBaseLayer][category][subcat]._layers) {
                groupedOverlays[currentBaseLayer][category][subcat]._layers[marker].addTo(groupedOverlays[currentBaseLayer][category][subcat]);
            }
            control.addOverlay(groupedOverlays[currentBaseLayer][category][subcat], subcat, category)
        }
    }
}