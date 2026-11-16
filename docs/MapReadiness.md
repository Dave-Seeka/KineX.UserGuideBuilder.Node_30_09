# ArcGIS map readiness

The Orchard Workbench route renders its shell before the ArcGIS MapView has completed portal authentication, WebMap loading, layer loading, initial navigation and toolbar binding. Capturing as soon as the shell appears can therefore produce a blank map.

Version 1.3.3 waits automatically after every Workbench `goto` action. The map is considered ready when:

1. `[data-guide='map-tool-home']` exists and is enabled;
2. `.arcgis-map-view-container .esri-view-surface` is visible and has a usable size;
3. the ArcGIS surface contains a visible non-zero canvas;
4. the map remains ready after the configured settle delay.

## Configuration

```json
"map": {
  "autoWaitOnWorkbenchNavigation": true,
  "workbenchPath": "/arcgis/orchard-workbench",
  "timeoutMs": 120000,
  "settleMs": 8000,
  "pollIntervalMs": 250,
  "readySelector": "[data-guide='map-tool-home']",
  "surfaceSelector": ".arcgis-map-view-container .esri-view-surface",
  "canvasSelector": ".arcgis-map-view-container .esri-view-surface canvas",
  "errorSelector": ".arcgis-map-view-error",
  "requireCanvas": true,
  "minimumWidth": 320,
  "minimumHeight": 200
}
```

For particularly slow test environments, increase `timeoutMs` to `180000` and `settleMs` to `12000`.

## Per-flow controls

Disable automatic waiting for a single navigation:

```json
{
  "type": "goto",
  "path": "/arcgis/orchard-workbench",
  "waitForMapReady": false
}
```

Wait explicitly after a map-changing action:

```json
{
  "type": "waitForMapReady",
  "timeoutMs": 120000,
  "settleMs": 8000
}
```

When readiness times out, the error reports the number of ready controls, enabled controls, valid ArcGIS surfaces, valid canvases and visible ArcGIS error text.
