L.canvasMarkerCircle = L.Path.extend({
    options: {
        stroke: false,
        color: false,
        interactive: true,
    },

    initialize: function (latlng, options) {
        L.setOptions(this, options);
        var layer = this;
        this._latlng = L.latLng(latlng);

        this.on('click', function (e) {
            this.bringToFront();
        });

        // Completed Mark
        this._check = new Image();
        this._check.onload = function() {
            layer._check.anchorWidth = 6;
            layer._check.anchorHeight = 6;
            layer.redraw();
        }
        this._check.src = '/assets/img/check2.png';

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
        var width = 6,
            height = 6,
            w = 50,
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
        return !this._renderer._bounds.intersects(this._pxBounds);
    },

    _containsPoint: function (p) {
        var tX = 6,
            tY = 6,
            anchorWidth = 6,
            anchorHeight = 6;

        return (p.x-(tX-anchorWidth) <= this._point.x + tX) &&
            (p.x-(tX-anchorWidth) >= this._point.x - tX) &&
            (p.y-(tY-anchorHeight) <= this._point.y + tY) &&
            (p.y-(tY-anchorHeight) >= this._point.y - tY);
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
        
        ctx.save();

        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI, false);
        ctx.fillStyle = layer.options.color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        if (layer.feature.properties.completed) {
            ctx.drawImage(layer._check, p.x - 5, p.y - 5);
        }

        ctx.restore();
    }
});