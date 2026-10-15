/** Read-only drawing of the company's measured zones (no map tiles; pure SVG projection). */
import type { MeasurementZone } from "@workspace/api-client-react";

const toXY = (lat: number, lng: number, lat0: number) => [lng * Math.cos((lat0 * Math.PI) / 180), -lat] as const;

export function MeasurementZonesView({ zones }: { zones: MeasurementZone[] }) {
  const usable = zones.filter(z => z.enabled !== false && Array.isArray(z.vertices) && z.vertices.length >= 2);
  if (!usable.length) return <p className="text-sm text-muted-foreground">No measurements have been recorded for this property yet.</p>;
  const all = usable.flatMap(z => z.vertices);
  const lat0 = all.reduce((s, v) => s + v[0], 0) / all.length;
  const pts = usable.map(z => z.vertices.map(v => toXY(v[0], v[1], lat0)));
  const xs = pts.flat().map(p => p[0]), ys = pts.flat().map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const W = 400, pad = 16, s = (W - pad * 2) / span;
  const H = Math.max(160, Math.min(400, (maxY - minY) * s + pad * 2));
  const proj = (p: readonly [number, number]) => `${(p[0] - minX) * s + pad},${(p[1] - minY) * s + pad}`;
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border bg-muted/30" role="img" aria-label="Measured areas outline" data-testid="svg-measurements">
        {usable.map((z, i) => z.mode === "linear"
          ? <polyline key={z.id} points={pts[i].map(proj).join(" ")} fill="none" stroke={z.color || "currentColor"} strokeWidth={3} />
          : <polygon key={z.id} points={pts[i].map(proj).join(" ")} fill={z.color || "currentColor"} fillOpacity={0.25} stroke={z.color || "currentColor"} strokeWidth={2} />)}
      </svg>
      <ul className="divide-y rounded-xl border" data-testid="list-measurements">
        {usable.map(z => (
          <li key={z.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: z.color || "currentColor" }} aria-hidden />
            <span className="flex-1">{z.label || "Measured area"}</span>
            <span className="font-medium tabular-nums">{z.mode === "linear" ? `${Math.round(z.lengthFt ?? 0).toLocaleString()} ft` : `${Math.round(z.areaSqft).toLocaleString()} sq ft`}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Shapes are approximate outlines from your service company's measurements, not a survey.</p>
    </div>
  );
}
