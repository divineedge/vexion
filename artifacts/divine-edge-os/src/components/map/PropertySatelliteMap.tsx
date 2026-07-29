/**
 * PropertySatelliteMap
 * Interactive satellite map using react-leaflet with ESRI World Imagery tiles.
 * Features: draggable pin, polygon measurement zones, geofence circle, quick quote.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MeasurementZone {
  id: string;
  label: string;
  /** Array of [lat, lng] pairs */
  vertices: [number, number][];
  areaSqft: number;
  enabled: boolean;
  color: string;
}

export interface ZoneType {
  id: string;
  name: string;
  color: string;
}

interface PropertySatelliteMapProps {
  lat?: number | null;
  lng?: number | null;
  address?: string;
  measurementPolygons?: MeasurementZone[];
  geofenceRadius?: number;
  geofenceLat?: number | null;
  geofenceLng?: number | null;
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

function formatArea(sqft: number, unit: 'sqft' | 'acres'): string {
  if (unit === 'acres') {
    return `${(sqft / 43560).toFixed(3)} ac`;
  }
  return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft`;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const DEFAULT_ZONE_TYPES: ZoneType[] = [
  { id: '1', name: 'Front Lawn', color: '#3B82F6' },
  { id: '2', name: 'Back Yard', color: '#10B981' },
  { id: '3', name: 'Bed Areas', color: '#F59E0B' },
  { id: '4', name: 'Side Yard', color: '#EF4444' },
  { id: '5', name: 'Common Area', color: '#8B5CF6' },
];

export default function PropertySatelliteMap({
  lat,
  lng,
  address,
  measurementPolygons = [],
  geofenceRadius = 100,
  geofenceLat,
  geofenceLng,
  preferredAreaUnit = 'sqft',
  zoneTypes,
  defaultZoneLabels,
  onPinChange,
  onMeasurementsChange,
  onGeofenceChange,
  readonly = false,
}: PropertySatelliteMapProps) {
  // Resolve effective zone types: prefer structured zoneTypes, fall back to legacy labels, then built-in defaults
  const effectiveZoneTypes: ZoneType[] = React.useMemo(() => {
    if (zoneTypes && zoneTypes.length > 0) return zoneTypes;
    if (defaultZoneLabels && defaultZoneLabels.length > 0) {
      return defaultZoneLabels.map((name, i) => ({
        id: String(i + 1),
        name,
        color: ZONE_COLORS[i % ZONE_COLORS.length],
      }));
    }
    return DEFAULT_ZONE_TYPES;
  }, [zoneTypes, defaultZoneLabels]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<{
    pin?: import('leaflet').Marker;
    geofenceCircle?: import('leaflet').Circle;
    polygons: Array<{ id: string; layer: import('leaflet').Polygon }>;
    drawingLayer?: import('leaflet').Polygon;
    tempPoints?: import('leaflet').Polyline;
    tempDots?: import('leaflet').LayerGroup;
  }>({ polygons: [] });

  const [zones, setZones] = useState<MeasurementZone[]>(measurementPolygons);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [selectedZoneTypeId, setSelectedZoneTypeId] = useState<string>('');
  const [editingGeofence, setEditingGeofence] = useState(false);
  const [currentLat, setCurrentLat] = useState(lat ?? 25.7617);
  const [currentLng, setCurrentLng] = useState(lng ?? -80.1918);
  const [localGeofenceRadius, setLocalGeofenceRadius] = useState(geofenceRadius);
  const [mapReady, setMapReady] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  // Sync zones from props when they change externally
  useEffect(() => {
    setZones(measurementPolygons);
  }, [measurementPolygons]);

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

      // Satellite tile layer — Google Maps (~1–2 yr imagery) when key set, ESRI fallback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GMAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
      if (GMAPS_KEY) {
        // Ensure Google Maps JS API is ready (may already be loaded by address autocomplete)
        await new Promise<void>((resolve) => {
          if ((window as any).google?.maps) { resolve(); return; }
          if (document.querySelector('#gmaps-script')) {
            const iv = setInterval(() => {
              if ((window as any).google?.maps) { clearInterval(iv); resolve(); }
            }, 100);
            return;
          }
          const s = document.createElement('script');
          s.id = 'gmaps-script';
          s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places&loading=async`;
          s.async = true;
          s.defer = true;
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
        if (!isMounted) return; // guard: component may have unmounted while waiting
        await import('leaflet.gridlayer.googlemutant');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (L as any).gridLayer.googleMutant({ type: 'satellite', maxZoom: 22 }).addTo(map);
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

      if (!readonly && onPinChange) {
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
          onPinChange(pos.lat, pos.lng);
          onGeofenceChange?.(pos.lat, pos.lng, localGeofenceRadius);
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

  // Draw stored polygons whenever map is ready or zones change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    import('leaflet').then((L) => {
      const map = mapRef.current;
      if (!map) return;

      // Remove old polygon layers
      markersRef.current.polygons.forEach(({ layer }) => map.removeLayer(layer));
      markersRef.current.polygons = [];

      zones.forEach((zone, i) => {
        if (zone.vertices.length < 3) return;
        const color = zone.color || ZONE_COLORS[i % ZONE_COLORS.length];
        const poly = L.polygon(zone.vertices, {
          color,
          fillColor: color,
          fillOpacity: zone.enabled ? 0.25 : 0.05,
          weight: 2,
          opacity: zone.enabled ? 1 : 0.4,
        })
          .addTo(map)
          .bindPopup(`<b>${zone.label}</b><br/>${formatArea(zone.areaSqft, preferredAreaUnit)}`);
        markersRef.current.polygons.push({ id: zone.id, layer: poly });
      });
    });
  }, [mapReady, zones, preferredAreaUnit]);

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

  // Handle map clicks for drawing
  const handleMapClick = useCallback((e: import('leaflet').LeafletMouseEvent) => {
    setDrawingPoints(prev => {
      // Clicking on/near the first placed point closes the polygon, once enough points exist.
      if (prev.length >= 3 && pixelDistance(prev[0], e.latlng) <= FIRST_POINT_HIT_RADIUS_PX) {
        finishPolygonRef.current(prev);
        return prev;
      }
      const next = [...prev, [e.latlng.lat, e.latlng.lng] as [number, number]];
      return next;
    });
  }, [pixelDistance]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (drawingMode) {
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
  }, [drawingMode, handleMapClick, mapReady]);

  // Draw temporary polyline while drawing
  useEffect(() => {
    if (!mapReady || !mapRef.current || !drawingMode) return;
    import('leaflet').then((L) => {
      const map = mapRef.current;
      if (!map) return;
      if (markersRef.current.tempPoints) map.removeLayer(markersRef.current.tempPoints);
      if (markersRef.current.tempDots) map.removeLayer(markersRef.current.tempDots);
      if (drawingPoints.length === 0) return;
      const line = L.polyline(drawingPoints, { color: '#F59E0B', weight: 2, dashArray: '6 3' }).addTo(map);
      markersRef.current.tempPoints = line;
      const dots = L.layerGroup(
        drawingPoints.map(pt =>
          L.circleMarker(pt, { radius: 5, color: '#F59E0B', fillColor: '#fff', fillOpacity: 1, weight: 2 })
        )
      ).addTo(map);
      markersRef.current.tempDots = dots;
    });
  }, [drawingPoints, drawingMode, mapReady]);

  const finishPolygon = (pointsOverride?: [number, number][]) => {
    const points = pointsOverride ?? drawingPoints;
    if (points.length < 3) return;
    const areaSqft = polygonAreaSqft(points);
    // Resolve the selected zone type (fall back to index-based color if not found)
    const selectedType = effectiveZoneTypes.find(z => z.id === selectedZoneTypeId) ?? effectiveZoneTypes[zones.length % effectiveZoneTypes.length];
    const newZone: MeasurementZone = {
      id: generateId(),
      label: selectedType?.name ?? 'Zone',
      vertices: points,
      areaSqft,
      enabled: true,
      color: selectedType?.color ?? ZONE_COLORS[zones.length % ZONE_COLORS.length],
    };
    const next = [...zones, newZone];
    setZones(next);
    setDrawingMode(false);
    setDrawingPoints([]);
    const total = next.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);
    onMeasurementsChange?.(next, total);
  };

  // Kept in sync so handleMapClick (defined earlier, with a stable identity) can always call
  // the latest finishPolygon without needing it as a dependency.
  const finishPolygonRef = useRef(finishPolygon);
  useEffect(() => {
    finishPolygonRef.current = finishPolygon;
  });

  const cancelDrawing = () => {
    setDrawingMode(false);
    setDrawingPoints([]);
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
    setDrawingMode(false);
    setDrawingPoints([]);
  };

  const saveGeofence = () => {
    if (!mapRef.current) return;
    const pin = markersRef.current.pin;
    const pos = pin?.getLatLng();
    const cLat = pos?.lat ?? currentLat;
    const cLng = pos?.lng ?? currentLng;
    import('leaflet').then((_L) => {
      markersRef.current.geofenceCircle?.setLatLng([cLat, cLng]).setRadius(localGeofenceRadius);
    });
    onGeofenceChange?.(cLat, cLng, localGeofenceRadius);
    setEditingGeofence(false);
  };

  const totalEnabledSqft = zones.filter(z => z.enabled).reduce((s, z) => s + z.areaSqft, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Map container */}
      <div className="relative rounded-lg overflow-hidden border" style={{ height: 380 }}>
        <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

        {/* Drawing overlay controls */}
        {drawingMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-amber-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-3 text-sm font-medium">
            <span>Click map to add vertices ({drawingPoints.length} points)</span>
            {drawingPoints.length >= 3 && (
              <button
                className="bg-white text-amber-700 px-3 py-0.5 rounded-full font-semibold hover:bg-amber-50 transition"
                onClick={() => finishPolygon()}
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
                    title="Zone type to assign when drawing a new zone"
                    className="text-sm border rounded px-2 py-1.5 bg-background flex-1"
                    value={selectedZoneTypeId}
                    onChange={e => setSelectedZoneTypeId(e.target.value)}
                  >
                    {effectiveZoneTypes.map(zt => (
                      <option key={zt.id} value={zt.id}>{zt.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition font-medium"
                  title="Click points on the map to draw a new service zone polygon"
                  onClick={() => { setDrawingMode(true); setDrawingPoints([]); }}
                >
                  ＋ Draw Zone
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
                onClick={() => setEditingGeofence(v => !v)}
              >
                {editingGeofence ? 'Cancel Geofence' : 'Edit Geofence'}
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Click on the map to place vertices, then close the polygon.</p>
          )}
        </div>
      )}

      {/* Geofence editor */}
      {editingGeofence && !readonly && (
        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
          <label className="text-sm font-medium whitespace-nowrap">Geofence radius:</label>
          <input
            type="number"
            min={10}
            max={5000}
            title="Geofence radius in meters — technicians inside this circle are considered on-site"
            className="text-sm border rounded px-2 py-1 w-24 bg-background"
            value={localGeofenceRadius}
            onChange={e => setLocalGeofenceRadius(parseInt(e.target.value, 10) || 100)}
          />
          <span className="text-sm text-muted-foreground">meters</span>
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
              <span className="text-muted-foreground">{formatArea(zone.areaSqft, preferredAreaUnit)}</span>
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
