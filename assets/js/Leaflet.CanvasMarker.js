L.CanvasMarker = L.Path.extend({
    options: {
        icon: false,
        iconAnchor: false,
        bringToFront: 'click',
        zoomScaling: true,
        minZoomScale: 0.5,
        hitPadding: 4,
        minHitSize: 24,
        maxZoomScale: 1.0,
        baseZoom: 7
    },

    initialize(latlng, options) {
        L.setOptions(this, options);

        // Initialize completed markers storage
        if (!localStorage.getItem('completedMarkers')) {
            this._setCompletedMarkersObj('completedMarkers', []);
        }

        this._latlng = L.latLng(latlng);
        this._setupIcon();
        this._setupCheckmark();
        this._isComplete();
        this._setupEventListeners();
    },

    _setupIcon() {
        this._icon = new Image();
        this._icon.onload = () => {
            if (!this.options.iconAnchor) {
                this._icon.anchorWidth = Math.round(this._icon.width / 2);
                this._icon.anchorHeight = Math.round(this._icon.height / 2);
            } else {
                this._icon.anchorWidth = Math.round(this.options.iconAnchor[0]);
                this._icon.anchorHeight = Math.round(this.options.iconAnchor[1]);
            }
        };
        this._icon.src = this.options.icon;
    },

    _setupCheckmark() {
        this._check = new Image();
        this._check.src = '/assets/img/check.png';
    },

    _setupEventListeners() {
        this.on('contextmenu', (e) => {
            this._markComplete(e);
        });

        this.on(this.options.bringToFront, () => {
            this.bringToFront();
        });

        // Hover halo so it is obvious which marker will be clicked
        this.on('mouseover', () => {
            if (this._hovered) return;
            this._hovered = true;
            this.redraw();
        });
        this.on('mouseout', () => {
            if (!this._hovered) return;
            this._hovered = false;
            this.redraw();
        });
    },

    _getCurrentScale() {
        if (!this.options.zoomScaling || !window.mapManager || !window.mapManager.iconZoomScaling || !this._map) {
            return 1;
        }

        const currentZoom = this._map.getZoom();
        const zoomDiff = currentZoom - this.options.baseZoom;
        const scaleMultiplier = Math.pow(1.2, zoomDiff);
        const rawScale = Math.max(this.options.minZoomScale, Math.min(this.options.maxZoomScale, scaleMultiplier));

        // Return raw scale for smooth zooming
        return rawScale;
    },

    _isComplete() {
        const completedMarkers = this._getCompletedMarkersObj('completedMarkers');
        this.options.completed = completedMarkers.includes(this.options.hash);
    },

    setComplete(completed) {
        const hash = this.options.hash;
        if (!hash) {
            console.warn('No hash found for marker');
            return this;
        }
        this.options.completed = !!completed;
        if (completed) {
            this._addCompletedMarker(hash);
        } else {
            this._removeCompletedMarker(hash);
        }
        this.redraw();
        this.fire('completechange', { completed: this.options.completed });
        return this;
    },

    _markComplete() {
        this.setComplete(!this.options.completed);
    },

    _setCompletedMarkersObj(key, obj) {
        try {
            localStorage.setItem(key, JSON.stringify(obj));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    },

    _getCompletedMarkersObj(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : [];
        } catch (error) {
            console.error('Failed to read from localStorage:', error);
            return [];
        }
    },

    _addCompletedMarker(hash) {
        const completedMarkers = this._getCompletedMarkersObj('completedMarkers');
        if (!completedMarkers.includes(hash)) {
            completedMarkers.push(hash);
            this._setCompletedMarkersObj('completedMarkers', completedMarkers);
        }
    },

    _removeCompletedMarker(hash) {
        const completedMarkers = this._getCompletedMarkersObj('completedMarkers');
        const filteredMarkers = completedMarkers.filter(marker => marker !== hash);
        this._setCompletedMarkersObj('completedMarkers', filteredMarkers);
    },

    setLatLng(latlng) {
        this._latlng = L.latLng(latlng);
        this.redraw();
        return this;
    },

    getLatLng() {
        return this._latlng;
    },

    _project() {
        this._point = this._map.latLngToLayerPoint(this._latlng);
        this._updateBounds();
    },

    _updateBounds() {
        const scale = this._getCurrentScale();
        const scaledWidth = Math.round(this._icon.width * scale);
        const scaledHeight = Math.round(this._icon.height * scale);
        const padding = 50;
        const topLeft = [scaledWidth + padding, scaledHeight + padding];
        const bottomRight = [scaledWidth + padding, padding];

        this._pxBounds = new L.Bounds(
            this._point.subtract(topLeft),
            this._point.add(bottomRight)
        );
    },

    _update() {
        if (this._map) {
            this._updatePath();
        }
    },

    _updatePath() {
        this._renderer._updateCanvasMarker(this);
    },

    _empty() {
        return this._icon.src && !this._renderer._bounds.intersects(this._pxBounds);
    },

    _containsPoint(point) {
        if (!this._icon || !this._icon.width) return false;
        const scale = this._getCurrentScale();
        const w = this._icon.width * scale;
        const h = this._icon.height * scale;
        const ax = this._icon.anchorWidth * scale;
        const ay = this._icon.anchorHeight * scale;

        // Visible icon box, then grow it to a comfortable minimum target size
        const pad = this.options.hitPadding;
        const minHalf = this.options.minHitSize / 2;
        const left = this._point.x - ax;
        const top = this._point.y - ay;
        const cx = left + w / 2;
        const cy = top + h / 2;
        const halfW = Math.max(w / 2 + pad, minHalf);
        const halfH = Math.max(h / 2 + pad, minHalf);

        return point.x >= cx - halfW && point.x <= cx + halfW &&
            point.y >= cy - halfH && point.y <= cy + halfH;
    },

});

// Factory function for creating canvas markers
L.canvasMarker = (latlng, options) => new L.CanvasMarker(latlng, options);

// Extend Canvas renderer with canvas marker support
L.Canvas.include({
    _updateCanvasMarker(layer) {
        if (layer._empty()) return;

        const { x, y } = layer._point;
        const ctx = this._ctx;

        ctx.save();

        // Get current scale for rendering
        const scale = layer._getCurrentScale();

        // Calculate scaled dimensions and positions for pixel-perfect rendering
        const scaledWidth = Math.round(layer._icon.width * scale);
        const scaledHeight = Math.round(layer._icon.height * scale);
        const scaledAnchorX = Math.round(layer._icon.anchorWidth * scale);
        const scaledAnchorY = Math.round(layer._icon.anchorHeight * scale);

        // Hover halo behind the icon
        if (layer._hovered) {
            const r = Math.max(scaledWidth, scaledHeight) / 2 + 5;
            const hx = x - scaledAnchorX + scaledWidth / 2;
            const hy = y - scaledAnchorY + scaledHeight / 2;
            ctx.beginPath();
            ctx.arc(hx, hy, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(245, 200, 75, 0.22)';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(245, 200, 75, 0.9)';
            ctx.stroke();
        }

        // Draw the main icon with pixel-aligned positioning
        if (layer.options.completed) ctx.globalAlpha = 0.55;
        ctx.drawImage(
            layer._icon,
            0, 0, layer._icon.width, layer._icon.height,
            Math.round(x - scaledAnchorX),
            Math.round(y - scaledAnchorY),
            scaledWidth,
            scaledHeight
        );

        // Draw completion checkmark if completed
        if (layer.options.completed) {
            ctx.globalAlpha = 1;
            const checkOffset = Math.round(7 * scale);
            const checkSize = Math.round(layer._check.width * scale);
            ctx.drawImage(
                layer._check,
                0, 0, layer._check.width, layer._check.height,
                Math.round(x - checkOffset),
                Math.round(y - checkOffset),
                checkSize,
                checkSize
            );
        }

        ctx.restore();
    }
});
