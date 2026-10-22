/** Read-only Esri World Imagery slippy-tile view with measurement overlay (Web Mercator, no dependencies). */
import type { MeasurementZone } from "@workspace/api-client-react";

const TILE = 256;
const W = 640;
const H = 400;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function project(lat: number, lng: number, z: number): [number, number] {
  const scale = TILE * 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

function quantity(z: MeasurementZone) {
  return z.mode === "linear"
    ? `${Math.round(z.lengthFt ?? 0).toLocaleString()} ft`
    : `${Math.round(z.areaSqft).toLocaleString()} sq ft`;
}

export function usableZones(zones: MeasurementZone[]) {
  return zones.filter(z => z.enabled !== false && Array.isArray(z.vertices) && z.vertices.length >= 2);
}

export function SatelliteMeasurementMap({
  lat, lng, zones, address,
}: { lat: number; lng: number; zones: MeasurementZone[]; address: string }) {
  const pts = [[lat, lng], ...zones.flatMap(z => z.vertices)];
  // Pick the highest zoom (max 20) at which everything fits with padding.
  let zoom = 20;
  for (; zoom > 3; zoom--) {
    const p = pts.map(v => project(v[0], v[1], zoom));
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    if (Math.max(...xs) - Math.min(...xs) <= W - 80 && Math.max(...ys) - Math.min(...ys) <= H - 80) break;
  }
  if (zones.length === 0) zoom = Math.min(zoom, 19);
  const proj = pts.map(v => project(v[0], v[1], zoom));
  const xs = proj.map(q => q[0]), ys = proj.map(q => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const x0 = cx - W / 2, y0 = cy - H / 2;
  const n = 2 ** zoom;

  const tiles: { x: number; y: number; key: string }[] = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++) {
      tiles.push({ x: tx, y: ty, key: `${tx}:${ty}` });
    }
  }
  const local = (la: number, ln: number) => {
    const [px, py] = project(la, ln, zoom);
    return [px - x0, py - y0] as const;
  };
  const pin = local(lat, lng);

  return (
    <figure className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-xl border bg-[hsl(160_30%_15%)]"
        style={{ aspectRatio: `${W} / ${H}` }}
        role="img"
        aria-label={`Satellite view of ${address} with ${zones.length} measured area${zones.length === 1 ? "" : "s"}`}
        data-testid="map-satellite"
      >
        {tiles.map(t => (
          <img
            key={t.key}
            src={TILE_URL(zoom, ((t.x % n) + n) % n, t.y)}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            draggable={false}
            className="absolute select-none max-w-none"
            style={{
              left: `${((t.x * TILE - x0) / W) * 100}%`,
              top: `${((t.y * TILE - y0) / H) * 100}%`,
              width: `${(TILE / W) * 100 + 0.1}%`,
              height: `${(TILE / H) * 100 + 0.1}%`,
            }}
          />
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          {zones.map(z => {
            const p = z.vertices.map(v => local(v[0], v[1]).join(",")).join(" ");
            const color = z.color || "#f5d76e";
            return z.mode === "linear"
              ? <polyline key={z.id} points={p} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              : <polygon key={z.id} points={p} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={2.5} />;
          })}
          {zones.map(z => {
            const c = z.vertices.map(v => local(v[0], v[1]));
            const mx = c.reduce((s, q) => s + q[0], 0) / c.length;
            const my = c.reduce((s, q) => s + q[1], 0) / c.length;
            const text = `${z.label || "Measured area"} · ${quantity(z)}`;
            const w = text.length * 6.6 + 14;
            return (
              <g key={`l-${z.id}`} transform={`translate(${mx},${my})`}>
                <rect x={-w / 2} y={-11} width={w} height={22} rx={6} fill="rgba(14,32,26,0.82)" />
                <text textAnchor="middle" y={4} fontSize={12} fontWeight={600} fill="#f4f8f2" fontFamily="Outfit, sans-serif">{text}</text>
              </g>
            );
          })}
          <g transform={`translate(${pin[0]},${pin[1]})`}>
            <path d="M0 0 C -9 -12 -11 -16 -11 -21 A 11 11 0 1 1 11 -21 C 11 -16 9 -12 0 0 Z" fill="hsl(158 58% 32%)" stroke="#f4f8f2" strokeWidth={2} />
            <circle cy={-21} r={4} fill="#f4f8f2" />
          </g>
        </svg>
        <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90">
          Imagery: Esri, Maxar, Earthstar Geographics, GIS User Community
        </span>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Saved map pin and approximate measured outlines from your service company. Not a survey.
      </figcaption>
    </figure>
  );
}
