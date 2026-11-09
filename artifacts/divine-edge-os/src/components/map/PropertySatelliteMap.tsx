/**
 * PropertySatelliteMap
 * Interactive satellite map using react-leaflet with ESRI World Imagery tiles.
 * Features: draggable pin, polygon measurement zones, geofence circle, quick quote.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { geofenceRadiusForDisplay, geofenceRadiusToMeters } from '@/lib/geofenceUnits';
import { formatArea, formatLinearFeet, measureSection, type MeasurementCapture } from '@/lib/satelliteMeasurements';

export interface MeasurementZone {
  id: string;
  label: string;
  zoneTypeId?: string;
  /** Array of [lat, lng] pairs. Open polyline path when mode is 'linear', closed polygon ring otherwise. */
  vertices: [number, number][];
  /** Polygon area in sqft. 0 for linear zones. */
  areaSqft: number;
  /** Perimeter or path length in feet. */
  lengthFt?: number | null;
  /** Same area, stored under the measurement record name. */
  area_sqft?: number;
  /** Same perimeter, stored under the measurement record name. */
  perimeter_linear_feet?: number;
  /** What this section was captured for. Absent means 'area' on older zones. */
  mode?: MeasurementCapture;
  enabled: boolean;
  color: string;
}

export interface ZoneType {
  id: string;
  name: string;
  color: string;
  /** Default measurement mode when drawing a zone of this type. Defaults to 'area' when absent. */
  mode?: MeasurementCapture;
}

interface PropertySatelliteMapProps {
  lat?: number | null;
  lng?: number | null;
  address?: string;
  measurementPolygons?: MeasurementZone[];
  geofenceRadius?: number;
  geofenceLat?: number | null;
  geofenceLng?: number | null;
  /** Unit used to display and edit the geofence radius. The radius prop and all callbacks always use meters. */
  geofenceUnit?: 'm' | 'ft';
  preferredAreaUnit?: 'sqft' | 'acres';
  /** Structured zone types from tenant settings — preferred over defaultZoneLabels */
  zoneTypes?: ZoneType[];
  /** @deprecated use zoneTypes instead */
  defaultZoneLabels?: string[];
  onPinChange?: (lat: number, lng: number) => void;
  /** Company default for a new section: area, linear perimeter, or both. */
  defaultMeasurementMode?: MeasurementCapture;
  onMeasurementsChange?: (zones: MeasurementZone[], totalSqft: number, totalPerimeterFt?: number) => void;
  onGeofenceChange?: (lat: number, lng: number, radius: number) => void;
  readonly?: boolean;
}

const ZONE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1',
];

function formatZoneMeasurement(zone: MeasurementZone, areaUnit: 'sqft' | 'acres'): string {
  const area = zone.area_sqft ?? zone.areaSqft ?? 0;
  const perimeter = zone.perimeter_linear_feet ?? zone.lengthFt ?? 0;
  if (zone.mode === 'both' || (area > 0 && perimeter > 0)) {
    return `${formatArea(area, areaUnit)} · ${formatLinearFeet(perimeter)}`;
  }
  if (zone.mode === 'linear') return formatLinearFeet(perimeter);
  return formatArea(area, areaUnit);
}

function sectionTotals(zones: MeasurementZone[]) {
  return zones.filter(zone => zone.enabled).reduce((totals, zone) => ({
    area: totals.area + (zone.area_sqft ?? zone.areaSqft ?? 0),
    perimeter: totals.perimeter + (zone.perimeter_linear_feet ?? zone.lengthFt ?? 0),
  }), { area: 0, perimeter: 0 });
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const DEFAULT_ZONE_TYPES: ZoneType[] = [
  { id: '1', name: 'Front Lawn', color: '#3B82F6', mode: 'area' },
  { id: '2', name: 'Back Yard', color: '#10B981', mode: 'area' },
  { id: '3', name: 'Bed Areas', color: '#F59E0B', mode: 'area' },
  { id: '4', name: 'Side Yard', color: '#EF4444', mode: 'area' },
  { id: '5', name: 'Common Area', color: '#8B5CF6', mode: 'area' },
  { id: '6', name: 'Fence Line', color: '#06B6D4', mode: 'linear' },
];

export default function PropertySatelliteMap({
  lat,
  lng,
  address,
  measurementPolygons = [],
  geofenceRadius = 100,
  geofenceLat,
  geofenceLng,
  geofenceUnit = 'm',
  preferredAreaUnit = 'sqft',
  defaultMeasurementMode = 'both',
  zoneTypes,
  defaultZoneLabels,
  onPinChange,
  onMeasurementsChange,
  onGeofenceChange,
  readonly = false,
}: PropertySatelliteMapProps) {
  // Resolve effective zone types: prefer structured zoneTypes, fall back to legacy labels, then built-in defaults.
  // Legacy labels carry no mode info, so they always resolve to 'area'.
  const effectiveZoneTypes: ZoneType[] = React.useMemo(() => {
    if (zoneTypes && zoneTypes.length > 0) return zoneTypes.map(zt => ({ ...zt, mode: zt.mode ?? 'area' }));
    if (defaultZoneLabels && defaultZoneLabels.length > 0) {
      return defaultZoneLabels.map((name, i) => ({
        id: String(i + 1),
        name,
        color: ZONE_COLORS[i % ZONE_COLORS.length],
        mode: 'area' as const,
      }));
    }
    return DEFAULT_ZONE_TYPES;
  }, [zoneTypes, defaultZoneLabels]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<{
    pin?: import('leaflet').Marker;
    geofenceCircle?: import('leaflet').Circle;
    polygons: Array<{ id: string; layer: import('leaflet').Polygon | import('leaflet').Polyline }>;
    drawingLayer?: import('leaflet').Polygon;
    tempPoints?: import('leaflet').Polyline;
    tempDots?: import('leaflet').LayerGroup;
  }>({ polygons: [] });

  const [zones, setZones] = useState<MeasurementZone[]>(measurementPolygons);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const drawingPointsRef = useRef<[number, number][]>([]);
  const [selectedZoneTypeId, setSelectedZoneTypeId] = useState<string>('');
  const [captureMode, setCaptureMode] = useState<MeasurementCapture>(defaultMeasurementMode);
  const [editingGeofence, setEditingGeofence] = useState(false);
  const [currentLat, setCurrentLat] = useState(lat ?? 25.7617);
  const [currentLng, setCurrentLng] = useState(lng ?? -80.1918);
  // localGeofenceRadius is in the display unit (ft or m); geofenceRadius prop is always meters
  const [localGeofenceRadius, setLocalGeofenceRadius] = useState(() =>
    geofenceRadiusForDisplay(geofenceRadius, geofenceUnit)
  );
  const [mapReady, setMapReady] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  const onGeofenceChangeRef = useRef(onGeofenceChange);
  const geofenceRadiusMRef = useRef(geofenceRadius);

  // Leaflet event handlers are registered once when the map is initialized. Keep their
  // dependencies current so a pin drag never calls an old callback or sends display feet
  // to an API that always stores meters.
  useEffect(() => {
    onPinChangeRef.current = onPinChange;
    onGeofenceChangeRef.current = onGeofenceChange;
  }, [onPinChange, onGeofenceChange]);

  useEffect(() => {
    const displayRadius = geofenceRadiusForDisplay(geofenceRadius, geofenceUnit);
    setLocalGeofenceRadius(displayRadius);
    geofenceRadiusMRef.current = geofenceRadius;
  }, [geofenceRadius, geofenceUnit]);

  useEffect(() => {
    geofenceRadiusMRef.current = geofenceRadiusToMeters(localGeofenceRadius, geofenceUnit);
  }, [localGeofenceRadius, geofenceUnit]);

  // Sync zones from props when they change externally
  useEffect(() => {
    setZones(measurementPolygons);
  }, [measurementPolygons]);

  // The saved property pin is the source of truth. Keep both the marker and viewport
  // centered on it when coordinates load or change after a drag/save.
  useEffect(() => {
    if (
      !mapReady
      || !mapRef.current
      || !markersRef.current.pin
      || lat == null
      || lng == null
    ) return;

    const nextPosition: [number, number] = [lat, lng];
    markersRef.current.pin.setLatLng(nextPosition);
    mapRef.current.setView(nextPosition, Math.max(mapRef.current.getZoom(), 18), { animate: false });
    setCurrentLat(lat);
    setCurrentLng(lng);
  }, [lat, lng, mapReady]);

  // Keep selectedZoneTypeId in sync with effectiveZoneTypes (default to first)
  useEffect(() => {
    if (effectiveZoneTypes.length > 0) {
      setSelectedZoneTypeId(prev => {
        const stillExists = effectiveZoneTypes.some(z => z.id === prev);
        return stillExists ? prev : effectiveZoneTypes[0].id;
      });
    }
  }, [effectiveZoneTypes]);

  useEffect(() => {
    const selected = effectiveZoneTypes.find(zone => zone.id === selectedZoneTypeId);
    if (!selected) return;
    setCaptureMode(selected.mode ?? defaultMeasurementMode);
    // Only follow the zone type when the user picks a different section type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZoneTypeId]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let isMounted = true;
    import('leaflet').then(async (L) => {
      if (!isMounted || !mapContainerRef.current || mapRef.current) return;

      // Fix default marker icons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const initLat = lat ?? 25.7617;
      const initLng = lng ?? -80.1918;

      const map = L.map(mapContainerRef.current!, { zoomControl: true }).setView([initLat, initLng], 18);
      mapRef.current = map;

      // Satellite tile layer.
      // Google tile server provides ~1–2 yr imagery (same source as Google Maps).
      // Works directly as a Leaflet tile layer — no plugin or API call needed.
      // Falls back to ESRI World Imagery when no Google key is configured.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GMAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
      if (GMAPS_KEY) {
        L.tileLayer(
          'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          {
            subdomains: ['0', '1', '2', '3'],
            attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
            maxZoom: 22,
            tileSize: 256,
          }
        ).addTo(map);
      } else {
        // ESRI World Imagery fallback (no API key required)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
            maxZoom: 22,
          }
        ).addTo(map);
      }

      // Property pin
      const pin = L.marker([initLat, initLng], { draggable: !readonly })
        .addTo(map)
        .bindPopup(address ?? 'Property');
      markersRef.current.pin = pin;

      if (!readonly) {
        pin.on('drag', () => {
          const pos = pin.getLatLng();
          // Geofence is locked to the pin — follow it live while dragging.
          markersRef.current.geofenceCircle?.setLatLng(pos);
        });
        pin.on('dragend', () => {
          const pos = pin.getLatLng();
          setCurrentLat(pos.lat);
          setCurrentLng(pos.lng);
          markersRef.current.geofenceCircle?.setLatLng(pos);
          onPinChangeRef.current?.(pos.lat, pos.lng);
          onGeofenceChangeRef.current?.(pos.lat, pos.lng, geofenceRadiusMRef.current);
        });
      }

      // Geofence circle
      const gLat = geofenceLat ?? initLat;
      const gLng = geofenceLng ?? initLng;
      const circle = L.circle([gLat, gLng], {
        radius: geofenceRadius,
        color: '#3B82F6',
        fillColor: '#3B82F6',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '6 4',
        interactive: false,
      }).addTo(map);
      markersRef.current.geofenceCircle = circle;

      setMapReady(true);
    });

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = { polygons: [] };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep Leaflet's circle aligned with the persisted geofence after a save, refetch, or
  // tenant display-unit change. Its radius is always meters, independent of the editor.
  useEffect(() => {
    const circle = markersRef.current.geofenceCircle;
    if (!mapReady || !circle) return;
    circle.setLatLng([
      geofenceLat ?? lat ?? 25.7617,
      geofenceLng ?? lng ?? -80.1918,
    ]).setRadius(geofenceRadius);
  }, [mapReady, geofenceLat, geofenceLng, geofenceRadius, lat, lng]);

  // Draw stored zones (polygons or open polylines) whenever map is ready or zones change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    import('leaflet').then((L) => {
      const map = mapRef.current;
      if (!map) return;

      // Remove old zone layers
      markersRef.current.polygons.forEach(({ layer }) => map.removeLayer(layer));
      markersRef.current.polygons = [];

      zones.forEach((zone, i) => {
        const color = zone.color || ZONE_COLORS[i % ZONE_COLORS.length];
        const popup = `<b>${zone.label}</b><br/>${formatZoneMeasurement(zone, preferredAreaUnit)}`;
        if (zone.mode === 'linear') {
          if (zone.vertices.length < 2) return;
          const line = L.polyline(zone.vertices, {
            interactive: !drawingMode,
            color,
            weight: zone.enabled ? 4 : 2,
            opacity: zone.enabled ? 1 : 0.4,
            dashArray: zone.enabled ? undefined : '4 4',
          })
            .addTo(map)
            .bindPopup(popup);
          markersRef.current.polygons.push({ id: zone.id, layer: line });
        } else {
          if (zone.vertices.length < 3) return;
          const poly = L.polygon(zone.vertices, {
            interactive: !drawingMode,
            color,
            fillColor: color,
            fillOpacity: zone.enabled ? 0.25 : 0.05,
            weight: 2,
            opacity: zone.enabled ? 1 : 0.4,
          })
            .addTo(map)
            .bindPopup(popup);
          markersRef.current.polygons.push({ id: zone.id, layer: poly });
        }
      });
    });
  }, [mapReady, zones, preferredAreaUnit, drawingMode]);

  // Distance (in screen pixels) between two lat/lng points, using the current map projection.
  const pixelDistance = useCallback(
    (a: [number, number], b: import('leaflet').LatLng) => {
      const map = mapRef.current;
      if (!map) return Infinity;
      const pa = map.latLngToContainerPoint(a);
      const pb = map.latLngToContainerPoint(b);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    },
    []
  );

  const FIRST_POINT_HIT_RADIUS_PX = 16;

  // Measurement mode for the zone type currently selected in the toolbar. This is what
  // decides whether the next drawing session produces a closed polygon (area) or an open
  // polyline (linear) — it's locked in once drawing starts, since the zone-type picker is
  // hidden while drawingMode is true.
  const drawMode: MeasurementCapture = captureMode;
  const drawModeRef = useRef(drawMode);
  useEffect(() => {
    drawModeRef.current = drawMode;
  });

  // Handle map clicks for drawing
  const handleMapClick = useCallback((e: import('leaflet').LeafletMouseEvent) => {
    const points = drawingPointsRef.current;
    // Save outside a state updater: React may replay updaters, but a closing click
    // must persist exactly one zone.
    if (drawModeRef.current !== 'linear' && points.length >= 3 && pixelDistance(points[0], e.latlng) <= FIRST_POINT_HIT_RADIUS_PX) {
      finishZoneRef.current(points);
      return;
    }
    const next = [...points, [e.latlng.lat, e.latlng.lng] as [number, number]];
    drawingPointsRef.current = next;
    setDrawingPoints(next);
  }, [pixelDistance]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const pin = markersRef.current.pin;
    const pinElement = pin?.getElement();
    if (pinElement) pinElement.style.pointerEvents = drawingMode ? 'none' : '';
    if (drawingMode || readonly) pin?.dragging?.disable();
    else pin?.dragging?.enable();
    if (drawingMode) {
      map.closePopup();
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', handleMapClick);
    } else {
      map.getContainer().style.cursor = '';
      map.off('click', handleMapClick);
      // Clear temporary drawing visuals
      import('leaflet').then((L) => {
        if (markersRef.current.tempPoints) {
          map.removeLayer(markersRef.current.tempPoints);
          markersRef.current.tempPoints = undefined;
        }
        if (markersRef.current.tempDots) {
          map.removeLayer(markersRef.current.tempDots);
          markersRef.current.tempDots = undefined;
        }
      });
    }
    return () => {
      map.off('click', handleMapClick);
    };
  }, [drawingMode, handleMapClick, mapReady, readonly]);

  // Draw temporary polyline while drawing
  useEffect(() => {
    if (!mapReady || !mapRef.current || !drawingMode) return;
    import('leaflet').then((L) => {
      const map = mapRef.current;
      if (!map) return;
      if (markersRef.current.tempPoints) map.removeLayer(markersRef.current.tempPoints);
      if (markersRef.current.tempDots) map.removeLayer(markersRef.current.tempDots);
      if (drawingPoints.length === 0) return;
      const line = L.polyline(drawingPoints, { color: '#F59E0B', weight: 2, dashArray: '6 3', interactive: false }).addTo(map);
      markersRef.current.tempPoints = line;
      const dots = L.layerGroup(
        drawingPoints.map(pt =>
          L.circleMarker(pt, { radius: 5, color: '#F59E0B', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false })
        )
      ).addTo(map);
      markersRef.current.tempDots = dots;
    });
  }, [drawingPoints, drawingMode, mapReady]);

  const finishZone = (pointsOverride?: [number, number][]) => {
    const points = pointsOverride ?? drawingPoints;
    const mode = drawModeRef.current;
    if (mode === 'linear' ? points.length < 2 : points.length < 3) return;
    // Resolve the selected zone type (fall back to index-based color if not found)
    const selectedType = effectiveZoneTypes.find(z => z.id === selectedZoneTypeId) ?? effectiveZoneTypes[zones.length % effectiveZoneTypes.length];
    const measured = measureSection(points, mode);
    const newZone: MeasurementZone = {
      id: generateId(),
      label: selectedType?.name ?? 'Zone',
      zoneTypeId: selectedType?.id,
      vertices: points,
      ...measured,
      mode,
      enabled: true,
      color: selectedType?.color ?? ZONE_COLORS[zones.length % ZONE_COLORS.length],
    };
    const next = [...zones, newZone];
    setZones(next);
    setDrawingMode(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    const totals = sectionTotals(next);
    onMeasurementsChange?.(next, totals.area, totals.perimeter);
  };

  // Kept in sync so handleMapClick (defined earlier, with a stable identity) can always call
  // the latest finishZone without needing it as a dependency.
  const finishZoneRef = useRef(finishZone);
  useEffect(() => {
    finishZoneRef.current = finishZone;
  });

  const cancelDrawing = () => {
    setDrawingMode(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
  };

  const startDrawing = (typeId = selectedZoneTypeId) => {
    if (readonly || !mapReady) return;
    setSelectedZoneTypeId(typeId);
    const nextMode = effectiveZoneTypes.find(type => type.id === typeId)?.mode ?? defaultMeasurementMode;
    drawModeRef.current = nextMode;
    setCaptureMode(nextMode);
    setEditingGeofence(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setDrawingMode(true);
  };

  const removeZone = (id: string) => {
    const next = zones.filter(z => z.id !== id);
    setZones(next);
    const totals = sectionTotals(next);
    onMeasurementsChange?.(next, totals.area, totals.perimeter);
  };

  const toggleZone = (id: string) => {
    const next = zones.map(z => z.id === id ? { ...z, enabled: !z.enabled } : z);
    setZones(next);
    const totals = sectionTotals(next);
    onMeasurementsChange?.(next, totals.area, totals.perimeter);
  };

  const renameZone = (id: string, label: string) => {
    if (!label.trim()) return;
    const next = zones.map(z => z.id === id ? { ...z, label: label.trim() } : z);
    setZones(next);
    const totals = sectionTotals(next);
    onMeasurementsChange?.(next, totals.area, totals.perimeter);
  };

  const clearAll = () => {
    setZones([]);
    onMeasurementsChange?.([], 0, 0);
  };

  const startOver = () => {
    clearAll();
    cancelDrawing();
  };

  const saveGeofence = () => {
    if (!mapRef.current) return;
    const pin = markersRef.current.pin;
    const pos = pin?.getLatLng();
    const cLat = pos?.lat ?? currentLat;
    const cLng = pos?.lng ?? currentLng;
    // Always store/callback in meters regardless of display unit
    const radiusM = geofenceRadiusToMeters(localGeofenceRadius, geofenceUnit);
    import('leaflet').then((_L) => {
      markersRef.current.geofenceCircle?.setLatLng([cLat, cLng]).setRadius(radiusM);
    });
    onGeofenceChange?.(cLat, cLng, radiusM);
    setEditingGeofence(false);
  };

  const enabledTotals = sectionTotals(zones);
  const totalEnabledSqft = enabledTotals.area;
  const totalEnabledLengthFt = enabledTotals.perimeter;
  const liveMeasurement = drawingPoints.length > 0 ? measureSection(drawingPoints, drawMode) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Map container */}
      <div className="relative rounded-lg overflow-hidden border" style={{ height: 380 }}>
        <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

        {/* Drawing overlay controls */}
        {drawingMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-amber-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-3 text-sm font-medium">
            <span>
              {drawMode === 'linear'
                ? `Click map to add points along the line (${drawingPoints.length} points)`
                : `Click map to add vertices (${drawingPoints.length} points)`}
            </span>
            {drawMode === 'linear' && drawingPoints.length >= 2 && (
              <button
                className="bg-white text-amber-700 px-3 py-0.5 rounded-full font-semibold hover:bg-amber-50 transition"
                onClick={() => finishZone()}
              >
                Finish Line
              </button>
            )}
            {drawMode !== 'linear' && drawingPoints.length >= 3 && (
              <button
                className="bg-white text-amber-700 px-3 py-0.5 rounded-full font-semibold hover:bg-amber-50 transition"
                onClick={() => finishZone()}
              >
                Close Polygon
              </button>
            )}
            <button
              className="text-white/80 hover:text-white underline"
              onClick={cancelDrawing}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Satellite label */}
        <div className="absolute bottom-2 left-2 z-[1000] bg-black/60 text-white text-[10px] px-2 py-0.5 rounded font-mono pointer-events-none">
          SATELLITE
        </div>
      </div>

      {/* Toolbar */}
      {!readonly && (
        <div className="flex flex-wrap gap-2 items-center">
          {!drawingMode ? (
            <>
              <div className="flex items-center gap-2 flex-1">
                {/* Zone type selector with color swatch */}
                <div className="flex items-center gap-1.5 flex-1 max-w-[220px]">
                  {(() => {
                    const sel = effectiveZoneTypes.find(z => z.id === selectedZoneTypeId);
                    return sel ? (
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sel.color }} />
                    ) : null;
                  })()}
                  <select
                    aria-label="Measurement type"
                    title="Zone type to assign when drawing a new zone — its mode (area or linear) determines how the zone is drawn"
                    className="text-sm border rounded px-2 py-1.5 bg-background flex-1"
                    value={selectedZoneTypeId}
                    onChange={e => {
                      startDrawing(e.target.value);
                    }}
                  >
                    {effectiveZoneTypes.map(zt => (
                      <option key={zt.id} value={zt.id}>{zt.name}{zt.mode === 'linear' ? ' (linear)' : zt.mode === 'both' ? ' (both)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center rounded-md border overflow-hidden" title="Capture area, linear perimeter, or both for this section">
                  {(['area', 'linear', 'both'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      className={`px-2 py-1.5 text-xs font-medium ${drawMode === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      onClick={() => setCaptureMode(mode)}
                    >
                      {mode === 'area' ? 'Area' : mode === 'linear' ? 'Linear' : 'Both'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!mapReady || !selectedZoneTypeId}
                  className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  onClick={() => startDrawing()}
                >
                  {drawMode === 'linear' ? 'Measure Line' : 'Measure Area'}
                </button>
              </div>
              {zones.length > 0 && (
                <button
                  className="text-sm px-3 py-1.5 border rounded hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition"
                  title="Clear all drawn zones and start fresh"
                  onClick={startOver}
                >
                  Start Over
                </button>
              )}
              <button
                className="text-sm px-3 py-1.5 border rounded hover:bg-muted transition"
                title={editingGeofence ? 'Cancel geofence editing' : 'Edit the property geofence radius'}
                onClick={() => { cancelDrawing(); setEditingGeofence(v => !v); }}
              >
                {editingGeofence ? 'Cancel Geofence' : 'Edit Geofence'}
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {drawMode === 'linear'
                ? 'Click on the map to place points along the line, then finish it.'
                : 'Click on the map to place vertices, then close the polygon. Area and perimeter update together.'}
            </p>
          )}
        </div>
      )}

      {/* Geofence editor */}
      {editingGeofence && !readonly && (
        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
          <label className="text-sm font-medium whitespace-nowrap">Geofence radius:</label>
          <input
            type="number"
            min={geofenceUnit === 'ft' ? 33 : 10}
            max={geofenceUnit === 'ft' ? 16404 : 5000}
            title={`Geofence radius in ${geofenceUnit === 'ft' ? 'feet' : 'meters'} — technicians inside this circle are considered on-site`}
            className="text-sm border rounded px-2 py-1 w-24 bg-background"
            value={localGeofenceRadius}
            onChange={e => setLocalGeofenceRadius(parseInt(e.target.value, 10) || (geofenceUnit === 'ft' ? 328 : 100))}
          />
          <span className="text-sm text-muted-foreground">{geofenceUnit === 'ft' ? 'feet' : 'meters'}</span>
          <button
            className="text-sm px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition"
            title="Save the geofence radius for this property"
            onClick={saveGeofence}
          >
            Save Geofence
          </button>
        </div>
      )}

      {(liveMeasurement || zones.length > 0) && (
        <div className="rounded-lg border bg-muted/30 p-3" data-testid="measurement-summary">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Measurement summary</p>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Area: <span className="font-semibold">{formatArea(liveMeasurement?.areaSqft ?? totalEnabledSqft, preferredAreaUnit)}</span></span>
            <span>Linear footage: <span className="font-semibold">{formatLinearFeet(liveMeasurement?.perimeter_linear_feet ?? totalEnabledLengthFt)}</span></span>
          </div>
        </div>
      )}

      {/* Zone list */}
      {zones.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Measurement Zones</p>
            <p className="text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{formatArea(totalEnabledSqft, preferredAreaUnit)}</span>
              {totalEnabledLengthFt > 0 && (
                <> · <span className="font-semibold text-foreground">{formatLinearFeet(totalEnabledLengthFt)}</span></>
              )}
            </p>
          </div>
          {zones.map((zone) => (
            <div
              key={zone.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition-opacity ${!zone.enabled ? 'opacity-50' : ''}`}
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
              {!readonly && editingZoneId === zone.id ? (
                <input
                  autoFocus
                  title="Zone label — press Enter to save, Escape to cancel"
                  className="flex-1 font-medium text-sm border-b border-primary bg-transparent outline-none"
                  defaultValue={zone.label}
                  onBlur={e => { renameZone(zone.id, e.target.value); setEditingZoneId(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingZoneId(null); }}
                />
              ) : (
                <span
                  className={`flex-1 font-medium ${!readonly ? 'cursor-pointer hover:text-primary' : ''}`}
                  title={!readonly ? 'Click to rename' : undefined}
                  onClick={() => { if (!readonly) setEditingZoneId(zone.id); }}
                >{zone.label}</span>
              )}
              <span className="text-muted-foreground">{formatZoneMeasurement(zone, preferredAreaUnit)}</span>
              {!readonly && (
                <>
                  <button
                    title={zone.enabled ? 'Exclude this zone from estimates and billing calculations' : 'Include this zone in estimates and billing calculations'}
                    className="text-muted-foreground hover:text-foreground text-xs underline"
                    onClick={() => toggleZone(zone.id)}
                  >
                    {zone.enabled ? 'Exclude' : 'Include'}
                  </button>
                  <button
                    title="Remove this zone permanently"
                    className="text-muted-foreground hover:text-destructive text-xs"
                    onClick={() => removeZone(zone.id)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
