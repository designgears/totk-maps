L.CanvasMarker = L.Path.extend({
    options: {
        stroke: false,
        iconAnchor: false,
        icon: false,
        interactive: true
    },

    initialize: function (latlng, options) {
        L.setOptions(this, options);
        var layer = this;
        this._latlng = L.latLng(latlng);

        if (this.options.icon) {
            this._icon = new Image();
            this._icon.onload = function() {
                if (!layer.options.iconAnchor) {
                    layer._icon.anchorWidth = this.width / 2;
                    layer._icon.anchorHeight = this.height / 2;
                } else {
                    layer._icon.anchorWidth = layer.options.iconAnchor[0];
                    layer._icon.anchorHeight = layer.options.iconAnchor[1];
                }
                layer.redraw();
            }
            this._icon.src = this.options.icon;
        
            // Completed Mark
            this._check = new Image();
            this._check.onload = function() {
                if (!layer.options.iconAnchor) {
                    layer._check.anchorWidth = this.width / 2;
                    layer._check.anchorHeight = this.height / 2;
                }
                layer.redraw();
            }
            this._check.src = '/assets/img/check.png';

            this.on('contextmenu', function (e) {
                if ('completed' in e.target.feature.properties && e.target.feature.properties.completed) {
                    e.target.feature.properties.completed = false;
                    removeCompleteMarker(this.feature);
                } else {
                    e.target.feature.properties.completed = true;
                    completeMarker(this.feature);
                }
                layer.redraw();
            });

        }

        this.on('click', function (e) {
            this.bringToFront();
        });

    },

    setLatLng: function (latlng) {
        this._latlng = L.latLng(latlng);
        this.redraw();
    },

    getLatLng: function () {
        return this._latlng;
    },

    _project: function () {
        this._point = this._map.latLngToLayerPoint(this._latlng);
        this._updateBounds();
    },

    _updateBounds: function () {
        if (this.options.icon) {
            var width = this._icon.width,
            height = this._icon.height;
        } else {
            var width = 12,
            height = 12;
        }
        var w = 50,
            topleft = [width + w, height + w],
            bottomright = [width + w, w];

        this._pxBounds = new L.Bounds(this._point.subtract(topleft), this._point.add(bottomright));
    },

    _update: function () {
        if (this._map) {
            this._updatePath();
        }
    },

    _updatePath: function () {
        this._renderer._updateCanvasMarker(this);
    },

    _empty: function () {
        if (this.options.icon) {
            return this._icon.src && !this._renderer._bounds.intersects(this._pxBounds);
        } else {
            return !this._renderer._bounds.intersects(this._pxBounds);
        }
    },

    _containsPoint: function (p) {
        if (this.options.icon) {
            var tX = this._icon.width / 2,
                tY = this._icon.height / 2;
            
            return (p.x-(tX-this._icon.anchorWidth) <= this._point.x + tX) &&
                (p.x-(tX-this._icon.anchorWidth) >= this._point.x - tX) &&
                (p.y-(tY-this._icon.anchorHeight) <= this._point.y + tY) &&
                (p.y-(tY-this._icon.anchorHeight) >= this._point.y - tY);
        } else {
            var tX = 12,
                tY = 12,
                anchorWidth = 12,
                anchorHeight = 12;

            return (p.x-(tX-anchorWidth) <= this._point.x + tX) &&
                (p.x-(tX-anchorWidth) >= this._point.x - tX) &&
                (p.y-(tY-anchorHeight) <= this._point.y + tY) &&
                (p.y-(tY-anchorHeight) >= this._point.y - tY);
        }
    },

});

L.canvasMarker = function (latlng, options) {
    return new L.CanvasMarker(latlng, options);
};

L.Canvas.include({
    _updateCanvasMarker: function (layer) {
        if (layer._empty()) { return; }
        var p = layer._point,
            ctx = this._ctx;

        if (layer.options.icon) {
            // icon rendering
            ctx.drawImage(layer._icon, p.x - layer._icon.anchorWidth, p.y - layer._icon.anchorHeight);
            if (layer.feature.properties.completed) {
                ctx.drawImage(layer._check, p.x - 2, p.y - 3);
            }
            this._fillStroke(ctx, layer);
        } else {

            var maxFontSize = 100;
            var maxZoom = layer._map.getMaxZoom();
            var currentZoom = layer._map.getZoom();

            if (currentZoom < 5) {
                return;
            }

            var fontSize = maxFontSize / (Math.pow(2, (maxZoom - currentZoom)));

            // text redering
            ctx.textRendering = "optimizeLegibility";
            ctx.globalCompositeOperation = 'destination-over';
            ctx.font = fontSize +"px OpenSans";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = "#d4ce46";

            ctx.shadowColor = "rgba(0,0,0,0.85)";
            ctx.shadowBlur = 4;

            ctx.fillText(layer.feature.properties.title, p.x, p.y);

            // reset so settings don't apply to other elements
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.globalCompositeOperation = 'source-over';
        }
        
    }
});