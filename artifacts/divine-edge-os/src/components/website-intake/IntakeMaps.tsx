/** Leaflet + ESRI imagery maps for website intake (no API keys, iframe-safe). */
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export type LatLng = { lat: number; lng: number };
const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;

export function geodesicAreaSqft(pts: LatLng[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    a += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((a * R * R) / 2) * 10.7639;
}
export function pathLengthFt(pts: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(h));
  }
  return d * 3.28084;
}

function useLeaflet(center: LatLng, zoom: number) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(L => {
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current).setView([center.lat, center.lng], zoom);
      L.tileLayer(TILE, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri' }).addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 60);
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { el, mapRef, LRef, ready, failed };
}

export function PinMap({ center, draggable, onMove }: { center: LatLng; draggable: boolean; onMove: (p: LatLng) => void }) {
  const { el, mapRef, LRef, ready, failed } = useLeaflet(center, 19);
  const markerRef = useRef<import('leaflet').CircleMarker | import('leaflet').Marker | null>(null);
  const cb = useRef(onMove); cb.current = onMove;
  const dragRef = useRef(draggable); dragRef.current = draggable;
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map) return;
    markerRef.current?.remove();
    const icon = L.divIcon({ className: '', html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:hsl(var(--primary));border:3px solid hsl(var(--background));box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
    const m = L.marker([center.lat, center.lng], { draggable, icon }).addTo(map);
    m.on('dragend', () => { const p = m.getLatLng(); cb.current({ lat: p.lat, lng: p.lng }); });
    markerRef.current = m;
    map.setView([center.lat, center.lng]);
    const click = (e: import('leaflet').LeafletMouseEvent) => { if (dragRef.current) cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }); };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [ready, center.lat, center.lng, draggable, LRef, mapRef]);
  if (failed) return <div className="h-56 rounded-lg border grid place-items-center text-sm text-muted-foreground">Map unavailable.</div>;
  return <div ref={el} className="h-56 sm:h-72 w-full rounded-lg overflow-hidden border" data-testid="map-pin" />;
}

export function DrawMap({ center, mode, points, onChange, readOnly }: {
  center: LatLng; mode: 'area' | 'linear'; points: LatLng[]; onChange?: (p: LatLng[]) => void; readOnly?: boolean;
}) {
  const { el, mapRef, LRef, ready, failed } = useLeaflet(center, 20);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const ptsRef = useRef(points); ptsRef.current = points;
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map) return;
    layerRef.current = L.layerGroup().addTo(map);
    if (readOnly) return;
    const click = (e: import('leaflet').LeafletMouseEvent) => cb.current?.([...ptsRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [ready, readOnly, LRef, mapRef]);
  useEffect(() => {
    const L = LRef.current, g = layerRef.current, map = mapRef.current;
    if (!L || !g || !map) return;
    g.clearLayers();
    const ll = points.map(p => [p.lat, p.lng] as [number, number]);
    const style = { color: 'hsl(48 100% 60%)', weight: 3, fillOpacity: 0.25 };
    if (mode === 'area' && ll.length >= 3) L.polygon(ll, style).addTo(g);
    else if (ll.length >= 2) L.polyline(ll, style).addTo(g);
    ll.forEach(p => L.circleMarker(p, { radius: 5, color: '#fafafa', weight: 2, fillColor: 'hsl(48 100% 50%)', fillOpacity: 1 }).addTo(g));
    if (readOnly && ll.length) map.fitBounds(L.latLngBounds(ll), { maxZoom: 20, padding: [20, 20] });
  }, [points, mode, ready, readOnly, LRef, mapRef]);
  if (failed) return <div className="h-56 rounded-lg border grid place-items-center text-sm text-muted-foreground">Map unavailable. Enter a measurement manually.</div>;
  return <div ref={el} className={`h-56 sm:h-72 w-full rounded-lg overflow-hidden border ${readOnly ? '' : 'cursor-crosshair'}`} data-testid="map-draw" />;
}
