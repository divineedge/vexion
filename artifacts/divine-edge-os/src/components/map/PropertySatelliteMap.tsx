/**
 * PropertySatelliteMap
 * Interactive satellite map using react-leaflet with ESRI World Imagery tiles.
 * Features: draggable pin, polygon measurement zones, geofence circle, quick quote.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { geofenceRadiusForDisplay, geofenceRadiusToMeters } from '@/lib/geofenceUnits';

export interface MeasurementZone {
  id: string;
  label: string;
  /** Array of [lat, lng] pairs. Open polyline path when mode is 'linear', closed polygon ring otherwise. */
  vertices: [number, number][];
  /** Polygon area in sqft. 0 for linear zones. */
  areaSqft: number;
  /** Polyline length in feet. Only set when mode is 'linear'. */
  lengthFt?: number | null;
  /** Measurement mode this zone was drawn in. Absent/undefined means 'area' (pre-existing zones). */
  mode?: 'area' | 'linear';
  enabled: boolean;
  color: string;
}

export interface ZoneType {
  id: string;
  name: string;
  color: string;
  /** Default measurement mode when drawing a zone of this type. Defaults to 'area' when absent. */
  mode?: 'area' | 'linear';
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
  onMeasurementsChange?: (zones: MeasurementZone[], totalSqft: number) => void;
  onGeofenceChange?: (lat: number, lng: number, radius: number) => void;
  readonly?: boolean;
}

const ZONE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1',
];

/** Shoelace formula for polygon area in sqft given [lat, lng] vertices */
function polygonAreaSqft(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0;
  // Convert lat/lng to approximate meters using equirectangular projection
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const centerLat = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const cosLat = Math.cos(toRad(centerLat));

  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const xi = vertices[i][1] * cosLat * R * (Math.PI / 180);
    const yi = vertices[i][0] * R * (Math.PI / 180);
    const xj = vertices[j][1] * cosLat * R * (Math.PI / 180);
    const yj = vertices[j][0] * R * (Math.PI / 180);
    area += xi * yj - xj * yi;
  }
  const areaSqm = Math.abs(area) / 2;
  return areaSqm * 10.7639; // m² to sqft
}

/** Sum of haversine distances between consecutive [lat, lng] points, in feet. Open path (not closed). */
function lineLengthFt(vertices: [number, number][]): number {
  if (vertices.length < 2) return 0;
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  let totalM = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const [lat1, lng1] = vertices[i];
    const [lat2, lng2] = vertices[i + 1];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalM += R * c;
  }
  return totalM * 3.28084; // meters to feet
}

function formatArea(sqft: number, unit: 'sqft' | 'acres'): string {
  if (unit === 'acres') {
    return `${(sqft / 43560).toFixed(3)} ac`;
  }
  return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft`;
}

function formatLength(ft: number): string {
  return `${ft.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft`;
}

/** Displays a zone's measurement using the right unit for its mode: length in feet for linear zones, area otherwise. */
function formatZoneMeasurement(zone: MeasurementZone, areaUnit: 'sqft' | 'acres'): string {
  if (zone.mode === 'linear') return formatLength(zone.lengthFt ?? 0);
  return formatArea(zone.areaSqft, areaUnit);
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
  const drawMode: 'area' | 'linear' = effectiveZoneTypes.find(z => z.id === selectedZoneTypeId)?.mode ?? 'area';
  // Kept in sync so handleMapClick (stable identity below) always sees the current mode
  // without needing it as a dependency.
  const drawModeRef = useRef(drawMode);
  useEffect(() => {
    drawModeRef.current = drawMode;
  });

  // Handle map clicks for drawing
  const handleMapClick = useCallback((e: import('leaflet').LeafletMouseEvent) => {
    const points = drawingPointsRef.current;
    // Save outside a state updater: React may replay updaters, but a closing click
    // must persist exactly one zone.
    if (drawModeRef.current === 'area' && points.length >= 3 && pixelDistance(points[0], e.latlng) <= FIRST_POINT_HIT_RADIUS_PX) {
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
    const newZone: MeasurementZone = {
      id: generateId(),
      label: selectedType?.name ?? 'Zone',
      vertices: points,
      areaSqft: mode === 'linear' ? 0 : polygonAreaSqft(points),
      lengthFt: mode === 'linear' ? lineLengthFt(points) : undefined,
      mode,
      enabled: true,
      color: selectedType?.color ?? ZONE_COLORS[zones.length % ZONE_COLORS.length],
    };
    const next = [...zones, newZone];
    setZones(next);
    setDrawingMode(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    const total = next.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);
    onMeasurementsChange?.(next, total);
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
    drawModeRef.current = effectiveZoneTypes.find(type => type.id === typeId)?.mode ?? 'area';
    setEditingGeofence(false);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setDrawingMode(true);
  };

  const removeZone = (id: string) => {
    const next = zones.filter(z => z.id !== id);
    setZones(next);
    const total = next.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);
    onMeasurementsChange?.(next, total);
  };

  const toggleZone = (id: string) => {
    const next = zones.map(z => z.id === id ? { ...z, enabled: !z.enabled } : z);
    setZones(next);
    const total = next.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);
    onMeasurementsChange?.(next, total);
  };

  const renameZone = (id: string, label: string) => {
    if (!label.trim()) return;
    const next = zones.map(z => z.id === id ? { ...z, label: label.trim() } : z);
    setZones(next);
    const total = next.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);
    onMeasurementsChange?.(next, total);
  };

  const clearAll = () => {
    setZones([]);
    onMeasurementsChange?.([], 0);
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

  const totalEnabledSqft = zones.filter(z => z.enabled && z.mode !== 'linear').reduce((s, z) => s + z.areaSqft, 0);
  const totalEnabledLengthFt = zones.filter(z => z.enabled && z.mode === 'linear').reduce((s, z) => s + (z.lengthFt ?? 0), 0);

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
            {drawMode === 'area' && drawingPoints.length >= 3 && (
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
                      <option key={zt.id} value={zt.id}>{zt.name}{zt.mode === 'linear' ? ' (linear)' : ''}</option>
                    ))}
                  </select>
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
                : 'Click on the map to place vertices, then close the polygon.'}
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

      {/* Zone list */}
      {zones.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Measurement Zones</p>
            <p className="text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{formatArea(totalEnabledSqft, preferredAreaUnit)}</span>
              {totalEnabledLengthFt > 0 && (
                <> · <span className="font-semibold text-foreground">{formatLength(totalEnabledLengthFt)}</span> linear</>
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
