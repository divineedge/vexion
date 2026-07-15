---
name: Blueprint canvas live map sync
description: How the satellite backdrop became a real Leaflet map without touching existing pan/zoom/drawing code
---

The blueprint canvas's satellite backdrop is a live Leaflet map (Esri World Imagery tiles), not a static
raster export — but the Leaflet map itself has ALL of its own interaction disabled (`dragging: false,
scrollWheelZoom: false`, etc.). It is a pure rendering slave: the existing SVG drag-to-pan / wheel-to-zoom
handlers (unchanged) still own `viewTransform`, and a separate effect converts `viewTransform` + a
georeference anchor `{lat, lng, localX, localY}` into a Leaflet `setView(center, zoom)` call on every change.

**Why:** Making Leaflet the interaction owner (letting the user drag its tiles directly) would require the
SVG drawing layer to stop capturing mouse events in select mode, which conflicts with clicking/dragging
existing points on top of the map. Driving Leaflet programmatically from the already-working transform
avoids any event-capture conflict and required zero changes to pan/zoom/drawing logic.

**How to apply:** The anchor is captured once (per blueprint/property) as the lat/lng of the local point
`(containerWidth/2, containerHeight/2)` at map-creation time. `scalePxPerFt` (already used for real-world
ft conversions elsewhere on the canvas) doubles as the feet-per-local-unit conversion for lat/lng math —
recalibrating scale is expected to also shift the perceived real-world position, which is correct since it
corrects the whole canvas's ft-per-pixel ratio uniformly. PDF Trace Mode is unrelated and still uses the
older static-raster-image backdrop slot (`satelliteImage` state) — the two backdrops are mutually exclusive
(`hasLiveMap` vs `traceMode`) and must stay that way.
