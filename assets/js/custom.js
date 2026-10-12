// ExploreZelda — Tears of the Kingdom interactive map

const CONFIG = {
  TILE_SIZE: 256,
  IMAGE_HEIGHT: 30000,
  IMAGE_WIDTH: 36000,
  TILE_URL: 'https://raw.githubusercontent.com/designgears/totk-map-assets/main/tiles/',
  DATA_URL: '/data.json',
  DEFAULT_VIEW: { lat: -1432, lng: 395, zoom: 5 },
  STATE_KEY: 'totk.ui.v2',
  DESKTOP_QUERY: '(min-width: 900px)',
  REALMS: {
    Sky: { label: 'Sky', path: 'sky_complete' },
    Surface: { label: 'Surface', path: 'ground' },
    Depths: { label: 'Depths', path: 'underground' }
  },
  CATEGORY_ORDER: ['Locations', 'Points of Interest', 'Collectable', 'Items', 'Enemy', 'Fruit'],
  DEFAULT_ENABLED: ['Locations']
};

const factor = 1 / (CONFIG.TILE_SIZE / 3); // 3 image pixels per game unit

L.CRS.Zelda = L.extend({}, L.CRS.Simple, {
  projection: L.Projection.LonLat,
  transformation: new L.Transformation(factor, 70.31, -factor, 58.59)
});

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const layerKey = (category, subcat) => `${category}/${subcat}`;

class TotkMapManager {
  constructor() {
    // realm -> category -> subcat -> L.LayerGroup
    this.overlays = {};
    this.rows = new Map(); // layerKey -> { input, meta, group }
    this.realm = 'Sky';
    this.iconZoomScaling = true;
    this.isDesktop = window.matchMedia(CONFIG.DESKTOP_QUERY);
    this.canHover = window.matchMedia('(hover: hover)').matches;

    this.state = this.loadState();
    this.iconZoomScaling = this.state.iconZoomScaling;
    this.init();
  }

  async init() {
    try {
      this.initMap();
      this.initTiles();
      this.bindUI();
      await this.loadData();
      this.setRealm(this.state.realm, { initial: true });
      this.applyDefaultView();
      this.setPanelOpen(this.isDesktop.matches ? this.state.panelOpen : false, { silent: true });
    } catch (err) {
      console.error('Failed to initialise map:', err);
    } finally {
      $('#loading').classList.add('hide');
    }
  }

  /* ---------- state ---------- */

  loadState() {
    const defaults = {
      realm: 'Sky',
      enabled: {},
      collapsed: [],
      panelOpen: true,
      iconZoomScaling: true
    };
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.STATE_KEY) || 'null');
      if (saved && typeof saved === 'object') return { ...defaults, ...saved };
    } catch (_) { /* ignore */ }
    return defaults;
  }

  saveState() {
    try {
      localStorage.setItem(CONFIG.STATE_KEY, JSON.stringify(this.state));
    } catch (_) { /* ignore */ }
  }

  enabledFor(realm) {
    if (!this.state.enabled[realm]) {
      const defaults = [];
      Object.entries(this.overlays[realm] || {}).forEach(([category, subcats]) => {
        if (CONFIG.DEFAULT_ENABLED.includes(category)) {
          Object.keys(subcats).forEach((subcat) => defaults.push(layerKey(category, subcat)));
        }
      });
      this.state.enabled[realm] = defaults;
    }
    return this.state.enabled[realm];
  }

  /* ---------- map ---------- */

  initMap() {
    this.map = L.map('map', {
      minZoom: 0,
      maxZoom: 10,
      zoomControl: false,
      attributionControl: false,
      crs: L.CRS.Zelda,
      renderer: L.canvas(),
      scrollWheelZoom: false,
      smoothWheelZoom: true,
      smoothSensitivity: 1
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    const southWest = this.map.unproject([0, CONFIG.IMAGE_HEIGHT], 8);
    const northEast = this.map.unproject([CONFIG.IMAGE_WIDTH, 0], 8);
    this.bounds = L.latLngBounds(southWest, northEast);

    this.map.on('zoomend', () => {
      if (this.iconZoomScaling) this.redrawMarkers();
    });
    this.map.on('popupopen', (e) => this.onPopupOpen(e));
  }

  applyDefaultView() {
    const hash = window.location.hash;
    if (!(hash && hash.length > 1)) {
      this.map.setView(L.latLng(CONFIG.DEFAULT_VIEW.lat, CONFIG.DEFAULT_VIEW.lng), CONFIG.DEFAULT_VIEW.zoom);
    }
    new L.Hash(this.map);
  }

  initTiles() {
    this.tiles = {};
    Object.entries(CONFIG.REALMS).forEach(([realm, { path }]) => {
      this.tiles[realm] = L.tileLayer(`${CONFIG.TILE_URL}${path}/{z}/{x}/{y}.png`, {
        maxNativeZoom: 8,
        bounds: this.bounds
      });
    });
  }

  /* ---------- data ---------- */

  async loadData() {
    const res = await fetch(CONFIG.DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading data`);
    const geojson = await res.json();

    L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        const { icon, hash } = feature.properties;
        return L.canvasMarker(latlng, { icon, hash, bringToFront: 'mouseover' });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        if (p.category === 'Labels') return;
        layer.feature = feature;
        if (p.title) {
          layer.bindPopup(() => this.popupHtml(layer), { closeButton: true, maxWidth: 320, autoPanPadding: [24, 72] });
          if (this.canHover) layer.bindTooltip(p.title, { direction: 'top', offset: [0, -12], opacity: 1 });
        }
        layer.on('completechange', () => this.onCompleteChange(layer));
        this.groupFor(p.map, p.category, p.subcat).addLayer(layer);
      }
    });
  }

  groupFor(realm, category, subcat) {
    const r = (this.overlays[realm] ||= {});
    const c = (r[category] ||= {});
    return (c[subcat] ||= L.layerGroup());
  }

  /* ---------- realm switching ---------- */

  setRealm(realm, { initial = false } = {}) {
    if (!CONFIG.REALMS[realm]) realm = 'Sky';
    if (!initial && realm === this.realm) return;

    const prev = this.realm;
    if (!initial) {
      Object.values(this.overlays[prev] || {}).forEach((subcats) => {
        Object.values(subcats).forEach((group) => this.map.removeLayer(group));
      });
      this.map.removeLayer(this.tiles[prev]);
      this.map.closePopup();
    }

    this.realm = realm;
    this.state.realm = realm;
    this.tiles[realm].addTo(this.map);

    const enabled = new Set(this.enabledFor(realm));
    Object.entries(this.overlays[realm] || {}).forEach(([category, subcats]) => {
      Object.entries(subcats).forEach(([subcat, group]) => {
        if (enabled.has(layerKey(category, subcat))) group.addTo(this.map);
      });
    });

    document.querySelectorAll('.realm-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.realm === realm));
    });

    this.renderPanel();
    this.saveState();
  }

  /* ---------- panel ---------- */

  bindUI() {
    this.panel = $('#panel');
    this.body = $('#panel-body');
    this.scrim = $('#scrim');
    this.layersBtn = $('#btn-layers');

    this.layersBtn.addEventListener('click', () => this.setPanelOpen(!this.panelOpen));
    $('#btn-close').addEventListener('click', () => this.setPanelOpen(false));
    this.scrim.addEventListener('click', () => this.setPanelOpen(false));
    $('#btn-all').addEventListener('click', () => this.setAll(true));
    $('#btn-none').addEventListener('click', () => this.setAll(false));
    $('#layer-filter').addEventListener('input', (e) => this.filterRows(e.target.value));

    document.querySelectorAll('.realm-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setRealm(btn.dataset.realm));
    });

    const zoomToggle = $('#zoom-scaling');
    zoomToggle.checked = this.iconZoomScaling;
    zoomToggle.addEventListener('change', (e) => {
      this.iconZoomScaling = e.target.checked;
      this.state.iconZoomScaling = e.target.checked;
      this.saveState();
      this.redrawMarkers();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panelOpen && !this.isDesktop.matches) this.setPanelOpen(false);
    });

    // Keep map gestures from firing through the floating UI.
    [this.panel, $('.topbar'), $('.realm-switch')].forEach((node) => {
      L.DomEvent.disableClickPropagation(node);
      L.DomEvent.disableScrollPropagation(node);
    });

    // Swipe-down to dismiss on mobile.
    this.bindSheetDrag();

    this.isDesktop.addEventListener('change', (e) => {
      this.setPanelOpen(e.matches ? this.state.panelOpen : false, { silent: true });
    });
  }

  bindSheetDrag() {
    const head = $('.panel-head');
    const grip = $('.panel-grip');
    let startY = 0;
    let dragging = false;

    const onStart = (e) => {
      if (this.isDesktop.matches) return;
      startY = e.touches[0].clientY;
      dragging = true;
      this.panel.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.touches[0].clientY - startY);
      this.panel.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = Math.max(0, e.changedTouches[0].clientY - startY);
      this.panel.style.transition = '';
      this.panel.style.transform = '';
      if (dy > 90) this.setPanelOpen(false);
    };

    [head, grip].forEach((node) => {
      node.addEventListener('touchstart', onStart, { passive: true });
      node.addEventListener('touchmove', onMove, { passive: true });
      node.addEventListener('touchend', onEnd);
    });
  }

  setPanelOpen(open, { silent = false } = {}) {
    this.panelOpen = open;
    this.panel.classList.toggle('open', open);
    this.panel.setAttribute('aria-hidden', String(!open));
    this.layersBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('panel-open', open);

    const mobile = !this.isDesktop.matches;
    this.scrim.hidden = !(open && mobile);
    requestAnimationFrame(() => this.scrim.classList.toggle('show', open && mobile));

    if (!silent && this.isDesktop.matches) {
      this.state.panelOpen = open;
      this.saveState();
    }
  }

  renderPanel() {
    this.body.innerHTML = '';
    this.rows.clear();
    const categories = this.overlays[this.realm] || {};
    const enabled = new Set(this.enabledFor(this.realm));
    const order = (name) => {
      const i = CONFIG.CATEGORY_ORDER.indexOf(name);
      return i === -1 ? 99 : i;
    };

    Object.keys(categories)
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .forEach((category) => {
        const subcats = categories[category];
        const group = el('section', 'group');
        group.dataset.category = category;
        group.dataset.open = String(!this.state.collapsed.includes(category));

        const head = el('div', 'group-head');
        const toggle = el('button', 'group-toggle');
        toggle.type = 'button';
        toggle.innerHTML = `<svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
        toggle.appendChild(el('span', 'group-name', category));
        toggle.appendChild(el('span', 'group-count', String(Object.keys(subcats).length)));
        toggle.addEventListener('click', () => {
          const open = group.dataset.open !== 'true';
          group.dataset.open = String(open);
          toggle.setAttribute('aria-expanded', String(open));
          this.state.collapsed = open
            ? this.state.collapsed.filter((c) => c !== category)
            : [...new Set([...this.state.collapsed, category])];
          this.saveState();
        });
        toggle.setAttribute('aria-expanded', group.dataset.open);

        const groupCheck = el('input', 'check');
        groupCheck.type = 'checkbox';
        groupCheck.setAttribute('aria-label', `Toggle all ${category}`);
        groupCheck.addEventListener('change', () => {
          Object.keys(subcats).forEach((subcat) => this.setLayer(category, subcat, groupCheck.checked, { quiet: true }));
          this.afterLayerChange();
        });

        head.append(toggle, groupCheck);
        group.appendChild(head);

        const list = el('ul', 'group-list');
        Object.keys(subcats)
          .sort((a, b) => a.localeCompare(b))
          .forEach((subcat) => {
            const layerGroup = subcats[subcat];
            const key = layerKey(category, subcat);
            const li = el('li');
            const row = el('label', 'layer-row');
            row.dataset.name = `${category} ${subcat}`.toLowerCase();

            const iconWrap = el('span', 'layer-icon');
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = this.iconFor(layerGroup);
            iconWrap.appendChild(img);

            const name = el('span', 'layer-name', subcat);
            const meta = el('span', 'layer-meta');

            const input = el('input', 'check');
            input.type = 'checkbox';
            input.checked = enabled.has(key);
            input.addEventListener('change', () => {
              this.setLayer(category, subcat, input.checked, { quiet: true });
              this.afterLayerChange();
            });

            row.append(iconWrap, name, meta, input);
            li.appendChild(row);
            list.appendChild(li);

            this.rows.set(key, { input, meta, groupCheck, layerGroup });
            this.updateMeta(key);
          });

        group.appendChild(list);
        this.body.appendChild(group);
      });

    this.filterRows($('#layer-filter').value);
    this.afterLayerChange();
  }

  iconFor(layerGroup) {
    const first = layerGroup.getLayers()[0];
    return first ? first.options.icon : '';
  }

  setLayer(category, subcat, on, { quiet = false } = {}) {
    const key = layerKey(category, subcat);
    const group = this.overlays[this.realm]?.[category]?.[subcat];
    if (!group) return;
    const list = this.enabledFor(this.realm);
    const idx = list.indexOf(key);
    if (on) {
      if (!this.map.hasLayer(group)) group.addTo(this.map);
      if (idx === -1) list.push(key);
    } else {
      if (this.map.hasLayer(group)) this.map.removeLayer(group);
      if (idx !== -1) list.splice(idx, 1);
    }
    const row = this.rows.get(key);
    if (row) row.input.checked = on;
    if (!quiet) this.afterLayerChange();
  }

  setAll(on) {
    const categories = this.overlays[this.realm] || {};
    Object.entries(categories).forEach(([category, subcats]) => {
      Object.keys(subcats).forEach((subcat) => this.setLayer(category, subcat, on, { quiet: true }));
    });
    this.afterLayerChange();
  }

  afterLayerChange() {
    // Group tri-state
    this.body.querySelectorAll('.group').forEach((group) => {
      const inputs = [...group.querySelectorAll('.layer-row .check')];
      const on = inputs.filter((i) => i.checked).length;
      const gc = group.querySelector('.group-head .check');
      gc.checked = on === inputs.length && inputs.length > 0;
      gc.indeterminate = on > 0 && on < inputs.length;
    });

    const count = this.enabledFor(this.realm).length;
    const badge = $('#layers-badge');
    badge.textContent = String(count);
    badge.hidden = count === 0;
    this.saveState();
  }

  filterRows(query) {
    const q = (query || '').trim().toLowerCase();
    let visible = 0;
    this.body.querySelectorAll('.group').forEach((group) => {
      let groupVisible = 0;
      group.querySelectorAll('li').forEach((li) => {
        const match = !q || li.firstElementChild.dataset.name.includes(q);
        li.hidden = !match;
        if (match) groupVisible++;
      });
      group.hidden = groupVisible === 0;
      if (q) group.dataset.open = 'true';
      else group.dataset.open = String(!this.state.collapsed.includes(group.dataset.category));
      visible += groupVisible;
    });

    let empty = $('.empty', this.body);
    if (visible === 0) {
      if (!empty) this.body.appendChild(el('p', 'empty', 'No layers match that filter.'));
    } else if (empty) {
      empty.remove();
    }
  }

  updateMeta(key) {
    const row = this.rows.get(key);
    if (!row) return;
    const layers = row.layerGroup.getLayers();
    const done = layers.reduce((n, l) => n + (l.options.completed ? 1 : 0), 0);
    row.meta.textContent = done ? `${done} / ${layers.length}` : String(layers.length);
    row.meta.classList.toggle('done', done > 0 && done === layers.length);
  }

  /* ---------- markers & popups ---------- */

  popupHtml(layer) {
    const p = layer.feature.properties;
    const done = !!layer.options.completed;
    const pos = String(p.position || '').replace(/(&nbsp;)+/g, ' ').trim().split(/\s+/).join(', ');
    return `
      <div class="popup">
        <div class="popup-top">
          <span class="popup-icon"><img src="${escapeHtml(p.icon)}" alt=""></span>
          <div>
            <div class="popup-kicker">${escapeHtml(p.category)} · ${escapeHtml(p.subcat)}</div>
            <h3 class="popup-title">${escapeHtml(p.title)}</h3>
          </div>
        </div>
        ${p.description ? `<p class="popup-desc">${p.description}</p>` : ''}
        <div class="popup-meta"><span>Position</span><code>${escapeHtml(pos)}</code></div>
        <button type="button" class="popup-btn${done ? ' is-done' : ''}" data-complete>
          ${done
            ? '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>Completed'
            : 'Mark complete'}
        </button>
      </div>`;
  }

  onPopupOpen(e) {
    const btn = e.popup.getElement()?.querySelector('[data-complete]');
    const layer = e.popup._source;
    if (!btn || !layer) return;
    btn.addEventListener('click', () => {
      layer.setComplete(!layer.options.completed);
      e.popup.setContent(this.popupHtml(layer));
      this.onPopupOpen(e);
    });
  }

  onCompleteChange(layer) {
    const p = layer.feature?.properties;
    if (p) this.updateMeta(layerKey(p.category, p.subcat));
  }

  redrawMarkers() {
    Object.values(this.overlays[this.realm] || {}).forEach((subcats) => {
      Object.values(subcats).forEach((group) => {
        if (!this.map.hasLayer(group)) return;
        group.eachLayer((layer) => layer.redraw && layer.redraw());
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.mapManager = new TotkMapManager();
});
