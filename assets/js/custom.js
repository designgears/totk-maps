// Modern ES6+ version of the TOTK map application

// Configuration constants
const CONFIG = {
    TILE_SIZE: 256,
    IMAGE_HEIGHT: 30000,
    IMAGE_WIDTH: 36000,
    TILE_URL: 'https://raw.githubusercontent.com/designgears/totk-map-assets/main/tiles/',
    DATA_URL: '/data.json',
    DEFAULT_VIEW: { lat: -1432, lng: 395, zoom: 5 }
};

// Calculate transformation factors
const factorX = 1 / (CONFIG.TILE_SIZE / 3); // 3 image pixels per game unit
const factorY = 1 / (CONFIG.TILE_SIZE / 3);

// Custom CRS for Zelda map
L.CRS.Zelda = L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(factorX, 70.31, -factorY, 58.59)
});

class TotkMapManager {
    constructor() {
        this.overlays = {};
        this.markers = {};
        this.groupedOverlays = {};
        this.control = null;
        this.currentBaseLayer = 'Sky';
        this.previousBaseLayer = null;
        this.iconZoomScaling = true;

        this.loadingOverlay = null;
        
        this.init();
    }

    async init() {
        try {
            this.showLoadingOverlay();
            this.loadZoomScalingPreference();
            this.initializeMap();
            this.setupBaseLayers();
            this.setupEventListeners();
            await this.loadMapData();
            this.setupUIElements();
            this.hideLoadingOverlay();
        } catch (error) {
            console.error('Failed to initialize map:', error);
            this.hideLoadingOverlay();
        }
    }

    initializeMap() {
        // Disable jQuery AJAX caching
        $.ajaxSetup({ cache: false });

        // Initialize the map
        this.map = L.map('map', {
            minZoom: 0,
            maxZoom: 10,
            tileSize: CONFIG.TILE_SIZE,
            attributionControl: false,
            crs: L.CRS.Zelda,
            renderer: L.canvas()
        });

        // Set map bounds
        const southWest = this.map.unproject([0, CONFIG.IMAGE_HEIGHT], 8);
        const northEast = this.map.unproject([CONFIG.IMAGE_WIDTH, 0], 8);
        this.bounds = L.latLngBounds(southWest, northEast);

        // Check for existing hash in URL and use it for initial view
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            // Hash exists, let L.Hash handle the initial view
            new L.Hash(this.map);
        } else {
            // No hash, set default view then initialize hash
            this.map.setView(L.latLng(CONFIG.DEFAULT_VIEW.lat, CONFIG.DEFAULT_VIEW.lng), CONFIG.DEFAULT_VIEW.zoom);
            new L.Hash(this.map);
        }
    }

    setupBaseLayers() {
        const tileOptions = {
            maxNativeZoom: 8,
            bounds: this.bounds
        };

        // Create grouped base layers for Tears of the Kingdom
        this.baseLayers = {
            'Tears of the Kingdom': {
                'Sky Islands': L.tileLayer(`${CONFIG.TILE_URL}sky_complete/{z}/{x}/{y}.png`, { ...tileOptions, name: 'Sky' }),
                'Surface World': L.tileLayer(`${CONFIG.TILE_URL}ground/{z}/{x}/{y}.png`, { ...tileOptions, name: 'Surface' }),
                'The Depths': L.tileLayer(`${CONFIG.TILE_URL}underground/{z}/{x}/{y}.png`, { ...tileOptions, name: 'Depths' })
            }
        };

        // Set initial current base layer
        this.currentBaseLayer = 'Sky';
        
        // Add default layer
        this.baseLayers['Tears of the Kingdom']['Sky Islands'].addTo(this.map);
    }

    setupEventListeners() {
        this.map.on('baselayerchange', (e) => {
            this.previousBaseLayer = this.currentBaseLayer;
            // Use the layer's name property instead of the display name
            this.currentBaseLayer = e.layer.options.name || e.name;
            this.updateLayers();
        });
        
        // Redraw markers when zoom changes (for zoom scaling)
        this.map.on('zoomend', () => {
            if (this.iconZoomScaling) {
                this.redrawAllMarkers();
            }
        });
    }

    onEachFeature = (feature, layer) => {
        const { properties } = feature;
        
        if (properties.title && properties.category !== 'Labels') {
            const popupContent = this.createPopupContent(properties);
            layer.bindPopup(popupContent).bindTooltip(properties.title);
            
            // Check completion status after popup is bound
            if (layer._isComplete) {
                layer._isComplete();
            }
        }

        layer.addTo(this.groupedOverlays[properties.map][properties.category][properties.subcat]);
    }

    createPopupContent(properties) {
        const { title, description, position } = properties;
        
        return `
            <div class="marker-popup">
                <div class="popup-header">
                    <h3 class="popup-title">${title}</h3>
                </div>
                ${description ? `<div class="popup-description">${description}</div>` : ''}
                <div class="popup-details">
                    <div class="popup-position">
                        <span class="popup-label">Location:</span>
                        <span class="popup-value">${position}</span>
                    </div>
                    <div class="popup-status">
                        <span class="popup-label">Status:</span>
                        <span class="status popup-value status-incomplete">Incomplete</span>
                    </div>
                </div>
                <div class="popup-footer">
                    <small class="popup-hint">Right-click to mark as complete</small>
                </div>
            </div>
        `;
    }

    pointToLayer = (feature, latlng) => {
        const { map, category, subcat, icon, hash } = feature.properties;
        
        this.addToOverlays(map, category, subcat);

        const markerOptions = {
            icon,
            hash,
            bringToFront: 'mouseover'
        };
        
        const marker = L.canvasMarker(latlng, markerOptions);
        

        
        return marker;
    }

    addToOverlays(map, category, subcat) {
        if (!this.groupedOverlays[map]) {
            this.groupedOverlays[map] = {};
        }
        if (!this.groupedOverlays[map][category]) {
            this.groupedOverlays[map][category] = {};
        }
        if (!this.groupedOverlays[map][category][subcat]) {
            this.groupedOverlays[map][category][subcat] = new L.LayerGroup();
        }
    }

    async loadMapData() {
        try {
            const response = await fetch(CONFIG.DATA_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const markers = await response.json();
            
            L.geoJSON(markers, {
                pointToLayer: this.pointToLayer,
                onEachFeature: this.onEachFeature
            });

            this.setupLayerControl();
        } catch (error) {
            console.error('Failed to load map data:', error);
            // Fallback to jQuery if fetch fails
            this.loadMapDataFallback();
        }
    }

    loadMapDataFallback() {
        $.getJSON(CONFIG.DATA_URL, (markers) => {
            L.geoJSON(markers, {
                pointToLayer: this.pointToLayer,
                onEachFeature: this.onEachFeature
            });

            this.setupLayerControl();
        }).fail((error) => {
            console.error('Failed to load map data with fallback:', error);
        });
    }

    setupLayerControl() {
        const menuOptions = {
            groupCheckboxes: true,
            collapsed: false,
            groupsCollapsable: true,
            groupsExpandedClass: 'bi bi-caret-down-square-fill',
            groupsCollapsedClass: 'bi bi-caret-right-square-fill'
        };

        // Ensure we have overlays for the current base layer
        const currentOverlays = this.groupedOverlays[this.currentBaseLayer] || {};

        this.control = L.control.groupedLayers(
            this.baseLayers, 
            currentOverlays, 
            {
                ...menuOptions,
                statePersistence: true,
                stateKey: 'totkMapState'
            }
        ).addTo(this.map);

        // State persistence is now handled by the leaflet plugin
    }

    updateLayers() {
        // Remove previous layer overlays
        if (this.previousBaseLayer) {
            this.removeLayerOverlays(this.previousBaseLayer);
        }

        // Add current layer overlays
        this.addLayerOverlays(this.currentBaseLayer);
    }

    removeLayerOverlays(layerName) {
        const overlays = this.groupedOverlays[layerName];
        if (!overlays) return;

        Object.entries(overlays).forEach(([category, subcategories]) => {
            Object.entries(subcategories).forEach(([subcat, layerGroup]) => {
                // Remove all markers from the layer group
                Object.values(layerGroup._layers).forEach(marker => marker.remove());
                // Remove the layer from control
                this.control.removeLayer(layerGroup);
            });
        });
    }

    addLayerOverlays(layerName) {
        const overlays = this.groupedOverlays[layerName];
        if (!overlays) return;

        Object.entries(overlays).forEach(([category, subcategories]) => {
            Object.entries(subcategories).forEach(([subcat, layerGroup]) => {
                // Add all markers back to the layer group
                Object.values(layerGroup._layers).forEach(marker => {
                    marker.addTo(layerGroup);
                });
                // Add the layer to control
                this.control.addOverlay(layerGroup, subcat, category);
            });
        });
    }

    showLoadingOverlay() {
         this.loadingOverlay = document.getElementById('loading-overlay');
         if (this.loadingOverlay) {
             this.loadingOverlay.style.display = 'flex';
         }
     }
 
     hideLoadingOverlay() {
         if (this.loadingOverlay) {
             this.loadingOverlay.style.display = 'none';
         }
     }





    resetView() {
        this.map.setView(L.latLng(CONFIG.DEFAULT_VIEW.lat, CONFIG.DEFAULT_VIEW.lng), CONFIG.DEFAULT_VIEW.zoom);
    }

    setupUIElements() {
        this.createZoomScalingControl();
    }

    createZoomScalingControl() {
        // Create zoom scaling control
        const ZoomScalingControl = L.Control.extend({
            onAdd: (map) => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                
                container.style.backgroundColor = 'rgba(30, 41, 59, 0.9)';
                container.style.border = '1px solid rgba(252, 211, 77, 0.3)';
                container.style.borderRadius = '8px';
                container.style.padding = '8px 12px';
                container.style.backdropFilter = 'blur(8px)';
                container.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                
                const label = L.DomUtil.create('label', 'zoom-scaling-label', container);
                label.style.color = '#fcd34d';
                label.style.fontSize = '14px';
                label.style.fontWeight = '500';
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.gap = '8px';
                label.style.cursor = 'pointer';
                label.style.userSelect = 'none';
                
                const checkbox = L.DomUtil.create('input', '', label);
                checkbox.type = 'checkbox';
                checkbox.checked = this.iconZoomScaling;
                checkbox.style.accentColor = '#fcd34d';
                checkbox.style.transform = 'scale(1.1)';
                
                const text = L.DomUtil.create('span', '', label);
                text.textContent = 'Icon Zoom Scaling';
                
                // Prevent map events when interacting with control
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                
                // Handle checkbox change
                L.DomEvent.on(checkbox, 'change', (e) => {
                    this.toggleIconZoomScaling(e.target.checked);
                }, this);
                
                return container;
            },
            
            onRemove: (map) => {
                // Cleanup if needed
            }
        });
        
        this.zoomScalingControl = new ZoomScalingControl({ position: 'topright' });
        this.zoomScalingControl.addTo(this.map);
    }

    toggleIconZoomScaling(enabled) {
        this.iconZoomScaling = enabled;
        
        // Save preference to localStorage
        try {
            localStorage.setItem('iconZoomScaling', JSON.stringify(enabled));
        } catch (error) {
            console.error('Failed to save zoom scaling preference:', error);
        }
        
        // Redraw all markers to apply/remove scaling
        this.redrawAllMarkers();
    }

    redrawAllMarkers() {
        // Redraw all canvas markers
        Object.values(this.groupedOverlays).forEach(mapLayers => {
            Object.values(mapLayers).forEach(categories => {
                Object.values(categories).forEach(layerGroup => {
                    layerGroup.eachLayer(layer => {
                        if (layer instanceof L.CanvasMarker) {
                            layer.redraw();
                        }
                    });
                });
            });
        });
    }

    loadZoomScalingPreference() {
        try {
            const saved = localStorage.getItem('iconZoomScaling');
            if (saved !== null) {
                this.iconZoomScaling = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Failed to load zoom scaling preference:', error);
        }
    }

    // State persistence is now handled by the leaflet.groupedlayercontrol.js plugin
}

// Initialize the map when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.mapManager = new TotkMapManager();
});

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TotkMapManager;
}
