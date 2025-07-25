/* global L */

// A layer control which provides for layer groupings.
// Author: Ishmael Smyrnow
L.Control.GroupedLayers = L.Control.extend({

  options: {
    sortLayers: true,
    sortGroups: true,
    sortBaseLayers: false,
    collapsed: true,
    position: 'topright',
    autoZIndex: true,
    exclusiveGroups: [],
    groupCheckboxes: false,
    groupsCollapsable: false,
    groupsExpandedClass: 'leaflet-control-layers-group-collapse-default',
    groupsCollapsedClass: 'leaflet-control-layers-group-expand-default',
    statePersistence: true,
    stateKey: 'leafletGroupedLayersState',
    sortFunction: (nameA, nameB) => {
      if (nameA < nameB) return -1;
      if (nameB < nameA) return 1;
      return 0;
    }
  },

  initialize(baseLayers, groupedOverlays, options) {
    L.Util.setOptions(this, options);

    this._layers = [];
    this._lastZIndex = 0;
    this._handlingClick = false;
    this._groupList = [];
    this._domGroups = [];
    this._baseLayerGroups = [];

    // Add base layers (support both flat and grouped structure)
    if (baseLayers) {
      Object.entries(baseLayers).forEach(([key, value]) => {
        if (value && typeof value === 'object' && value.addTo) {
          // Flat base layer structure
          this._addLayer(value, key);
        } else if (value && typeof value === 'object') {
          // Grouped base layer structure
          Object.entries(value).forEach(([layerName, layer]) => {
            this._addLayer(layer, layerName, key, false);
          });
        }
      });
    }

    // Add grouped overlays
    Object.entries(groupedOverlays || {}).forEach(([groupName, group]) => {
      Object.entries(group).forEach(([layerName, layer]) => {
        this._addLayer(layer, layerName, groupName, true);
      });
    });
  },

  onAdd(map) {
    this._initLayout();
    this._update();

    map
      .on('layeradd', this._onLayerChange, this)
      .on('layerremove', this._onLayerChange, this);

    if (this.options.statePersistence) {
      this._setupStatePersistence();
      this._restoreLayerState();
    }

    return this._container;
  },

  addTo(map) {
    L.Control.prototype.addTo.call(this, map);
    // Trigger expand after Layers Control has been inserted into DOM so that it now has an actual height.
    return this._expandIfNotCollapsed();
  },

  onRemove(map) {
    map
      .off('layeradd', this._onLayerChange, this)
      .off('layerremove', this._onLayerChange, this);
  },

  addBaseLayer(layer, name, group) {
    this._addLayer(layer, name, group, false);
    this._update();
    return this;
  },

  addOverlay(layer, name, group) {
    this._addLayer(layer, name, group, true);
    this._update();
    return this;
  },

  removeLayer(layer) {
    const id = L.Util.stamp(layer);
    const layerObj = this._getLayer(id);
    if (layerObj) {
      const index = this._layers.indexOf(layerObj);
      if (index > -1) {
        this._layers.splice(index, 1);
      }
    }
    this._update();
    return this;
  },

  _getLayer(id) {
    return this._layers.find(layer => 
      layer && L.Util.stamp(layer.layer) === id
    );
  },

  _initLayout() {
    const className = 'leaflet-control-layers';
    const container = this._container = L.DomUtil.create('div', className);
    const collapsed = this.options.collapsed;
    
    // Makes this work on IE10 Touch devices by stopping it from firing a mouseout event when the touch is released
    container.setAttribute('aria-haspopup', true);

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const form = this._form = L.DomUtil.create('form', className + '-list');

    if (collapsed) {
      this._map.on('click', this._collapse, this);  

      if (!L.Browser.android) {
        L.DomEvent.on(container, {
          mouseenter: this._expand,
          mouseleave: this._collapse
        }, this);
      }
    }

    const link = this._layersLink = L.DomUtil.create('a', className + '-toggle', container);
    link.href = '#';
    link.title = 'Layers';

    if (L.Browser.touch) {
      L.DomEvent.on(link, 'click', L.DomEvent.stop);
      L.DomEvent.on(link, 'click', this._expand, this);
    } else {
      L.DomEvent.on(link, 'focus', this._expand, this);
    }

    if (!collapsed) {
      this._expand();
    }

    this._baseLayersList = L.DomUtil.create('div', className + '-base', form);
    this._separator = L.DomUtil.create('div', className + '-separator', form);
    this._overlaysList = L.DomUtil.create('div', className + '-overlays', form);

    container.appendChild(form);
  },

  _addLayer(layer, name, group, overlay) {
    const layerObj = {
      layer,
      name,
      overlay
    };
    this._layers.push(layerObj);

    group = group || '';
    let groupId = this._indexOf(this._groupList, group);

    if (groupId === -1) {
      groupId = this._groupList.push(group) - 1;
    }

    const exclusive = (this._indexOf(this.options.exclusiveGroups, group) !== -1);

    layerObj.group = {
      name: group,
      id: groupId,
      exclusive: exclusive
    };

    if (this.options.autoZIndex && layer.setZIndex) {
      this._lastZIndex++;
      layer.setZIndex(this._lastZIndex);
    }

    if (this.options.sortLayers) {
      this._layers.sort((a, b) => {
        if (a.overlay === true && b.overlay === true) {
          return this.options.sortFunction(a.name, b.name);
        }
      });
    }

    if (this.options.sortBaseLayers) {
      this._layers.sort((a, b) => {
        if (a.overlay === undefined && b.overlay === undefined) {
          return this.options.sortFunction(a.name, b.name);
        }
      });
    }

    if (this.options.sortGroups) {
      this._layers.sort((a, b) => {
        return this.options.sortFunction(a.group.name, b.group.name);
      });
    }

    this._expandIfNotCollapsed();
  },

  _update() {
    if (!this._container) {
      return;
    }

    this._baseLayersList.innerHTML = '';
    this._overlaysList.innerHTML = '';
    this._domGroups.length = 0;

    let baseLayersPresent = false;
    let overlaysPresent = false;
    let baseLayersCount = 0;

    this._layers.forEach(obj => {
      this._addItem(obj);
      overlaysPresent = overlaysPresent || obj.overlay;
      baseLayersPresent = baseLayersPresent || !obj.overlay;
      baseLayersCount += !obj.overlay ? 1 : 0;
    });

    // Hide base layers section if there's only one layer.
    if (this.options.hideSingleBase) {
      if (baseLayersCount === 1) {
        baseLayersPresent = false;
        this._baseLayersList.style.display = 'none';
      } else {
        this._baseLayersList.style.display = 'block';
      }
    }

    if (this.options.groupCheckboxes) {
      this._refreshGroupsCheckStates();
    }

    this._separator.style.display = overlaysPresent && baseLayersPresent ? '' : 'none';
  },

  _onLayerChange(e) {
    const obj = this._getLayer(L.Util.stamp(e.layer));

    if (!obj) {
      return;
    }

    if (!this._handlingClick) {
      this._update();
    }

    let type;
    if (obj.overlay) {
      type = e.type === 'layeradd' ? 'overlayadd' : 'overlayremove';
    } else {
      type = e.type === 'layeradd' ? 'baselayerchange' : null;
    }

    if (type) {
      this._map.fire(type, obj);
    }
  },

  _createRadioElement(name, checked) {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.className = 'leaflet-control-layers-selector';
    radio.checked = checked;

    return radio;
  },

  _addItem(obj) {
    const label = document.createElement('label');
    let input;
    const checked = this._map.hasLayer(obj.layer);
    let container;
    let groupRadioName;

    if (obj.overlay) {
      if (obj.group.exclusive) {
        groupRadioName = `leaflet-exclusive-group-layer-${obj.group.id}`;
        input = this._createRadioElement(groupRadioName, checked);
      } else {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'leaflet-control-layers-selector';
        input.defaultChecked = checked;
      }
    } else {
      // Base layers are always radio buttons
      if (obj.group.name && obj.group.name !== '') {
        // Grouped base layer - use group-specific radio name
        groupRadioName = `leaflet-base-group-${obj.group.id}`;
      } else {
        // Ungrouped base layer - use global radio name
        groupRadioName = 'leaflet-base-layers';
      }
      input = this._createRadioElement(groupRadioName, checked);
    }

    input.layerId = L.Util.stamp(obj.layer);
    input.groupID = obj.group.id;
    L.DomEvent.on(input, 'click', this._onInputClick, this);

    const name = document.createElement('span');
    name.innerHTML = ` ${obj.name}`;

    label.appendChild(input);
    label.appendChild(name);

    if (obj.overlay || (obj.group.name && obj.group.name !== '')) {
      // Handle both overlays and grouped base layers
      container = obj.overlay ? this._overlaysList : this._baseLayersList;

      let groupContainer = this._domGroups[obj.group.id];

      // Create the group container if it doesn't exist
      if (!groupContainer) {
        groupContainer = document.createElement('div');
        groupContainer.className = 'leaflet-control-layers-group';
        groupContainer.id = `leaflet-control-layers-group-${obj.group.id}`;

        const groupLabel = document.createElement('label');
        groupLabel.className = 'leaflet-control-layers-group-label';

        if (obj.group.name !== '' && !obj.group.exclusive && obj.overlay) {
          // Only add group checkbox for overlays, not base layers
          if (this.options.groupCheckboxes) {
            const groupInput = document.createElement('input');
            groupInput.type = 'checkbox';
            groupInput.className = 'leaflet-control-layers-group-selector';
            groupInput.groupID = obj.group.id;
            groupInput.legend = this;
            L.DomEvent.on(groupInput, 'click', this._onGroupInputClick, groupInput);
            groupLabel.appendChild(groupInput);
          }
        }

        if (this.options.groupsCollapsable) {
          groupContainer.classList.add('group-collapsable');
          // Base layer groups default to open, overlay groups default to collapsed
          if (obj.overlay) {
            groupContainer.classList.add('collapsed');
          }

          const groupMin = document.createElement('span');
          groupMin.className = `leaflet-control-layers-group-collapse ${this.options.groupsExpandedClass}`;
          groupLabel.appendChild(groupMin);

          const groupMax = document.createElement('span');
          groupMax.className = `leaflet-control-layers-group-expand ${this.options.groupsCollapsedClass}`;
          groupLabel.appendChild(groupMax);

          L.DomEvent.on(groupLabel, 'click', this._onGroupCollapseToggle, groupContainer);
        }

        const groupName = document.createElement('span');
        groupName.className = 'leaflet-control-layers-group-name';
        groupName.innerHTML = obj.group.name;
        groupLabel.appendChild(groupName);

        groupContainer.appendChild(groupLabel);
        container.appendChild(groupContainer);

        this._domGroups[obj.group.id] = groupContainer;
      }

      container = groupContainer;
    } else {
      // Ungrouped base layer
      container = this._baseLayersList;
    }

    container.appendChild(label);

    return label;
  },

  _onGroupCollapseToggle(event) {
    L.DomEvent.stopPropagation(event);
    L.DomEvent.preventDefault(event);
    if (this.classList.contains('group-collapsable') && this.classList.contains('collapsed')) {
      this.classList.remove('collapsed');
    } else if (this.classList.contains('group-collapsable') && !this.classList.contains('collapsed')) {
      this.classList.add('collapsed');
    }
  },

  _onGroupInputClick(event) {
    L.DomEvent.stopPropagation(event);
    let obj;

    const this_legend = this.legend;
    this_legend._handlingClick = true;

    const inputs = this_legend._form.getElementsByTagName('input');

    for (const input of inputs) {
      if (input.groupID === this.groupID && input.className === 'leaflet-control-layers-selector') {
        input.checked = this.checked;
        obj = this_legend._getLayer(input.layerId);
        if (input.checked && !this_legend._map.hasLayer(obj.layer)) {
          this_legend._map.addLayer(obj.layer);
        } else if (!input.checked && this_legend._map.hasLayer(obj.layer)) {
          this_legend._map.removeLayer(obj.layer);
        }
      }
    }

    this_legend._handlingClick = false;
  },

  _onInputClick() {
    let obj;
    const inputs = this._form.getElementsByClassName('leaflet-control-layers-selector');
    let toBeRemoved;
    let toBeAdded;

    this._handlingClick = true;

    for (const input of inputs) {
      obj = this._getLayer(input.layerId);
      if (input.checked && !this._map.hasLayer(obj.layer)) {
        toBeAdded = obj.layer;
      } else if (!input.checked && this._map.hasLayer(obj.layer)) {
        toBeRemoved = obj.layer;
      }
    }

    if (toBeRemoved !== undefined) {
      this._map.removeLayer(toBeRemoved);
    }
    if (toBeAdded !== undefined) {
      this._map.addLayer(toBeAdded);
    }

    if (this.options.groupCheckboxes) {
      this._refreshGroupsCheckStates();
    }

    this._handlingClick = false;
  },

  _refreshGroupsCheckStates() {
    for (let i = 0; i < this._domGroups.length; i++) {
      const groupContainer = this._domGroups[i];
      if (groupContainer) {

        const groupInput = groupContainer.getElementsByClassName('leaflet-control-layers-group-selector')[0];
        const groupItemInputs = groupContainer.querySelectorAll('input.leaflet-control-layers-selector');
        const checkedGroupItemInputs = groupContainer.querySelectorAll('input.leaflet-control-layers-selector:checked');

        if (groupInput) {
          groupInput.indeterminate = false;
          if (checkedGroupItemInputs.length === groupItemInputs.length) {
            groupInput.checked = true;
          } else if (checkedGroupItemInputs.length === 0) {
            groupInput.checked = false;
          } else {
            groupInput.indeterminate = true;
          }
        }
      }
    }
  },

  _expand() {
    L.DomUtil.addClass(this._container, 'leaflet-control-layers-expanded');
    this._form.style.height = null;
    const acceptableHeight = this._map.getSize().y - (this._container.offsetTop + 50);
    if (acceptableHeight < this._form.clientHeight) {
      L.DomUtil.addClass(this._form, 'leaflet-control-layers-scrollbar');
      this._form.style.height = acceptableHeight + 'px';
    } else {
      L.DomUtil.removeClass(this._form, 'leaflet-control-layers-scrollbar');
    }

    return this;
  },

  _expandIfNotCollapsed() {
    if (this._map && !this.options.collapsed) {
      this._expand();
    }
    return this;
  },

  _collapse() {
    this._container.className = this._container.className.replace(' leaflet-control-layers-expanded', '');
  },

  _indexOf(arr, obj) {
    return arr.indexOf(obj);
  },

  // State persistence methods
  _saveLayerState() {
    if (!this.options.statePersistence) return;

    const state = {
      selectedLayers: [],
      collapsedGroups: [],
      baseLayer: null
    };

    // Get selected overlays
    const checkboxes = this._form.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
      const label = checkbox.closest('label');
      if (label && !label.classList.contains('leaflet-control-layers-group-label')) {
        state.selectedLayers.push(label.textContent.trim());
      }
    });

    // Get selected base layer
    const selectedRadio = this._form.querySelector('input[type="radio"]:checked');
    if (selectedRadio) {
      const label = selectedRadio.closest('label');
      if (label) {
        state.baseLayer = label.textContent.trim();
      }
    }

    // Get collapsed groups
    const collapsedGroups = this._form.querySelectorAll('.leaflet-control-layers-group.collapsed');
    collapsedGroups.forEach(group => {
      const groupNameSpan = group.querySelector('.leaflet-control-layers-group-name');
      if (groupNameSpan) {
        state.collapsedGroups.push(groupNameSpan.textContent.trim());
      }
    });

    try {
      localStorage.setItem(this.options.stateKey, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to save layer state:', error);
    }
  },

  _restoreLayerState() {
    if (!this.options.statePersistence) return;

    try {
      const savedState = localStorage.getItem(this.options.stateKey);
      if (!savedState) return;

      const state = JSON.parse(savedState);
      
      // Restore with delay to ensure DOM is ready
      setTimeout(() => {
        // Restore base layer
        if (state.baseLayer) {
          const baseLayerRadio = Array.from(this._form.querySelectorAll('input[type="radio"]'))
            .find(radio => {
              const label = radio.closest('label');
              return label && label.textContent.trim() === state.baseLayer;
            });
          if (baseLayerRadio && !baseLayerRadio.checked) {
            baseLayerRadio.click();
          }
        }

        // Set group states directly without clicking
        const allGroups = this._form.querySelectorAll('.leaflet-control-layers-group.group-collapsable');
        allGroups.forEach(group => {
          const groupNameSpan = group.querySelector('.leaflet-control-layers-group-name');
          if (groupNameSpan) {
            const groupName = groupNameSpan.textContent.trim();
            const shouldBeCollapsed = state.collapsedGroups && state.collapsedGroups.includes(groupName);
            
            if (shouldBeCollapsed) {
              group.classList.add('collapsed');
            } else {
              group.classList.remove('collapsed');
            }
          }
        });

        // Restore selected overlays
        if (state.selectedLayers) {
          state.selectedLayers.forEach(layerName => {
            const checkbox = Array.from(this._form.querySelectorAll('input[type="checkbox"]'))
              .find(cb => {
                const label = cb.closest('label');
                return label && label.textContent.trim() === layerName;
              });
            if (checkbox && !checkbox.checked) {
              checkbox.click();
            }
          });
        }
      }, 100);
    } catch (error) {
      console.warn('Failed to restore layer state:', error);
    }
  },

  _setupStatePersistence() {
    if (!this.options.statePersistence) return;

    // Save state when layers change
    this._map.on('overlayadd overlayremove baselayerchange', () => {
      setTimeout(() => this._saveLayerState(), 50);
    });

    // Save state when groups are collapsed/expanded
    L.DomEvent.on(this._form, 'click', (e) => {
      const groupLabel = e.target.closest('.leaflet-control-layers-group-label');
      if (groupLabel) {
        setTimeout(() => this._saveLayerState(), 50);
      }
    });

    // Save state before page unload
    window.addEventListener('beforeunload', () => {
      this._saveLayerState();
    });
  }
});

/**
 * Factory function for creating grouped layers control
 * @param {Object} baseLayers - Base layers object
 * @param {Object} groupedOverlays - Grouped overlays object
 * @param {Object} options - Control options
 * @returns {L.Control.GroupedLayers} New grouped layers control instance
 */
L.control.groupedLayers = (baseLayers, groupedOverlays, options) => {
  return new L.Control.GroupedLayers(baseLayers, groupedOverlays, options);
};
