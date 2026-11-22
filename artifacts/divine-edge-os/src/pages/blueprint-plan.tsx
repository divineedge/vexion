import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { addSatelliteTileLayer, type SatelliteStatus } from '@/lib/satelliteTiles';
import 'leaflet/dist/leaflet.css';

type LatLng = { lat: number; lng: number };
type Feature = {
  id: string;
  kind: string;
  disposition: 'existing' | 'bid';
  label?: string;
  points: LatLng[];
  thicknessInches?: number | null;
  manualTruckLoads?: number | null;
  areaKind?: string | null;
};
type CustomerLine = {
  id: string;
  customerText: string;
  qty: number;
  unit: string | null;
  unitPrice: number;
  components: { roleKey: string; name: string; qty: number; unit: string; unitPrice: number; onHand: number | null; sourceKind: string; sourceId: number; internalCost: number | null }[];
};
type OrderRow = { key: string; name: string; roleKey: string; unit: string; required: number; onHand: number | null; toOrder: number | null; linked: boolean };
type Version = {
  id: number;
  name: string;
  status: string;
  total: number | null;
  lines: CustomerLine[];
  orderList: OrderRow[];
  plan: { heads?: { id: string; zone: number; name: string; lat: number; lng: number; headKey: string }[]; lines?: { id: string; kind: string; points: LatLng[]; zone: number | null }[]; curbFeet?: number | null; questions?: string[]; materials?: { label: string; yards: number | null; tons: number | null; truckLoads: number | null; question: string | null }[]; zoneCount?: number };
  inputs: { jobType?: string; features?: Feature[] };
  estimateId: number | null;
};
type Bundle = {
  blueprint: { id: number; name: string; planningInputs: { jobType?: string; features?: Feature[] }; planningLocked: boolean; planningLockedReason: string | null; chosenPlanVersionId: number | null };
  property: { id: number; address: string; lat: number | null; lng: number | null; customerId: number } | null;
  versions: Version[];
  archivedVersions: Version[];
};

const TOOLS = [
  ['pan', 'Move map'],
  ['outline', 'Property outline'],
  ['lawn', 'Lawn'],
  ['gravel', 'Gravel area'],
  ['bark', 'Bark area'],
  ['curb', 'Curb'],
  ['driveway', 'Driveway'],
  ['water_hookup', 'Water hookup'],
  ['house', 'House'],
  ['tree', 'Tree'],
  ['rock', 'Rock'],
] as const;

const POINT_TOOLS = new Set(['water_hookup', 'house', 'tree', 'rock']);
const LINE_TOOLS = new Set(['curb', 'driveway']);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}

function featureFromTool(tool: string, points: LatLng[], disposition: 'existing' | 'bid'): Feature {
  const id = `${tool}_${Date.now()}`;
  if (tool === 'outline') return { id, kind: 'outline', disposition, points };
  if (tool === 'lawn' || tool === 'gravel' || tool === 'bark') return { id, kind: 'work_area', areaKind: tool, disposition, points, label: tool };
  if (tool === 'curb' || tool === 'driveway') return { id, kind: tool, disposition, points };
  return { id, kind: tool, disposition, points };
}

export default function BlueprintPlanPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['blueprint-plan', id],
    enabled: Number.isFinite(id) && id > 0,
    queryFn: () => customFetch<Bundle>(`/api/blueprint-planning/blueprints/${id}`),
  });
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [jobType, setJobType] = useState('sprinkler');
  const [tool, setTool] = useState('outline');
  const [disposition, setDisposition] = useState<'existing' | 'bid'>('bid');
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [satelliteStatus, setSatelliteStatus] = useState<SatelliteStatus>('loading');
  const [missing, setMissing] = useState<string[]>([]);
  const [versionName, setVersionName] = useState('Full plan');
  const [lineEdits, setLineEdits] = useState<Record<number, CustomerLine[]>>({});
  const drawing = features ?? ((data?.blueprint.planningInputs?.features as Feature[] | undefined) ?? []);
  const locked = data?.blueprint.planningLocked === true;
  const versions = data?.versions ?? [];
  const archived = data?.archivedVersions ?? [];
  const selected = [...versions, ...archived].find(version => version.id === (selectedId ?? data?.blueprint.chosenPlanVersionId ?? versions[0]?.id)) ?? null;

  useEffect(() => {
    if (features || !data) return;
    setFeatures((data.blueprint.planningInputs?.features as Feature[] | undefined) ?? []);
    setJobType(data.blueprint.planningInputs?.jobType || 'sprinkler');
  }, [data, features]);

  const saveInputs = async (nextFeatures: Feature[], nextJob = jobType) => {
    setFeatures(nextFeatures);
    try {
      await customFetch(`/api/blueprint-planning/blueprints/${id}/inputs`, {
        method: 'PUT',
        body: JSON.stringify({ jobType: nextJob, features: nextFeatures }),
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const finishDraft = () => {
    const needed = POINT_TOOLS.has(tool) ? 1 : LINE_TOOLS.has(tool) ? 2 : 3;
    if (draft.length < needed) { toast.error(needed === 1 ? 'Click the map to place it' : `Add at least ${needed} points`); return; }
    const next = [...drawing, featureFromTool(tool, draft, disposition)];
    setDraft([]);
    void saveInputs(next);
  };

  const calculate = async () => {
    setMissing([]);
    try {
      const created = await customFetch<Version>(`/api/blueprint-planning/blueprints/${id}/calculate`, {
        method: 'POST',
        body: JSON.stringify({ name: versionName, inputs: { jobType, features: drawing } }),
      });
      setSelectedId(created.id);
      toast.success('Plan calculated');
      await refetch();
    } catch (error) {
      const data = (error as { data?: { missing?: string[] } }).data;
      if (data?.missing) setMissing(data.missing);
      toast.error(errorMessage(error));
    }
  };

  const linesFor = (version: Version) => lineEdits[version.id] ?? version.lines;

  const updateLine = (version: Version, lineId: string, patch: Partial<CustomerLine>) => {
    setLineEdits(current => {
      const base = current[version.id] ?? version.lines;
      return { ...current, [version.id]: base.map(line => line.id === lineId ? { ...line, ...patch } : line) };
    });
  };

  const saveLines = async (lines: CustomerLine[]) => {
    if (!selected) return;
    const versionId = selected.id;
    try {
      await customFetch(`/api/blueprint-planning/blueprints/${id}/versions/${versionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ lines }),
      });
      toast.success(locked ? 'Saved' : 'Prices saved without redrawing');
      setLineEdits(current => {
        const next = { ...current };
        delete next[versionId];
        return next;
      });
      await refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Button variant="ghost" onClick={() => setLocation('/blueprints')}>Back</Button>
          <h1 className="text-2xl font-bold">{data?.blueprint.name ?? 'Blueprint plan'}</h1>
          <p className="text-sm text-muted-foreground">{data?.property?.address || 'No property linked yet. The map still opens so you can mark the site.'}</p>
        </div>
        <Button variant="outline" onClick={() => setLocation('/blueprint-planning')}>Planning setup</Button>
      </div>

      {locked && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="blueprint-locked-banner">
          Locked — {data?.blueprint.planningLockedReason}. You can view where the lines were run. Saving changes is refused.
        </div>
      )}

      {isLoading ? <p>Loading plan…</p> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            <PlanMap
              lat={data?.property?.lat}
              lng={data?.property?.lng}
              features={selected && locked ? (selected.inputs?.features ?? drawing) : drawing}
              draft={draft}
              heads={selected?.plan.heads ?? []}
              lines={selected?.plan.lines ?? []}
              satelliteStatus={satelliteStatus}
              onSatelliteStatus={setSatelliteStatus}
              onClick={point => {
                if (locked || tool === 'pan') return;
                const next = [...draft, point];
                if (POINT_TOOLS.has(tool)) {
                  const feature = featureFromTool(tool, [point], disposition);
                  void saveInputs([...drawing, feature]);
                  return;
                }
                setDraft(next);
              }}
            />
            <div className="flex flex-wrap gap-2 items-center" data-testid="plan-edit-controls">
              <Select value={jobType} onValueChange={value => { setJobType(value); void saveInputs(drawing, value); }} disabled={locked}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sprinkler">Sprinkler system</SelectItem>
                  <SelectItem value="gravel">Gravel</SelectItem>
                  <SelectItem value="bark">Bark</SelectItem>
                  <SelectItem value="general">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tool} onValueChange={setTool} disabled={locked}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{TOOLS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={disposition} onValueChange={value => setDisposition(value as 'existing' | 'bid')} disabled={locked}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">Already there</SelectItem>
                  <SelectItem value="bid">Part of the bid</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" disabled={locked} onClick={finishDraft}>Finish shape ({draft.length})</Button>
              <Button variant="ghost" disabled={locked || draft.length === 0} onClick={() => setDraft([])}>Cancel points</Button>
            </div>
            <ul className="text-sm space-y-2" data-testid="plan-features">
              {drawing.map(feature => (
                <li key={feature.id} className="flex flex-wrap items-center gap-2 border rounded-md px-2 py-1" data-testid={feature.kind === 'outline' ? 'property-outline' : `feature-${feature.kind}`}>
                  <span className="font-medium">{feature.label || feature.areaKind || feature.kind}</span>
                  <Badge variant="outline">{feature.disposition === 'bid' ? 'Part of the bid' : 'Already there'}</Badge>
                  {(feature.areaKind === 'gravel' || feature.areaKind === 'bark' || feature.kind === 'gravel' || feature.kind === 'bark') && (
                    <>
                      <Input className="w-24 h-8" type="number" placeholder="Inches" disabled={locked} value={feature.thicknessInches ?? ''} onChange={event => {
                        const thicknessInches = event.target.value === '' ? null : Number(event.target.value);
                        void saveInputs(drawing.map(item => item.id === feature.id ? { ...item, thicknessInches } : item));
                      }} />
                      <Input className="w-28 h-8" type="number" placeholder="Truck loads" disabled={locked} value={feature.manualTruckLoads ?? ''} onChange={event => {
                        const manualTruckLoads = event.target.value === '' ? null : Number(event.target.value);
                        void saveInputs(drawing.map(item => item.id === feature.id ? { ...item, manualTruckLoads } : item));
                      }} />
                    </>
                  )}
                  <Button size="sm" variant="ghost" disabled={locked} onClick={() => void saveInputs(drawing.filter(item => item.id !== feature.id))}>Remove</Button>
                </li>
              ))}
            </ul>
            {drawing.length === 0 && <p className="text-sm text-muted-foreground">Mark the property outline, the lawn or gravel, and the main water hookup. Each mark is either already there or part of the bid.</p>}
          </div>

          <div className="space-y-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Plan</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Input value={versionName} onChange={event => setVersionName(event.target.value)} disabled={locked} placeholder="Version name" />
                <Button data-testid="plan-sprinkler" disabled={locked} onClick={() => void calculate()}>
                  {jobType === 'sprinkler' ? 'Plan sprinkler system' : 'Calculate plan'}
                </Button>
                {missing.length > 0 && (
                  <div data-testid="plan-missing" className="text-sm text-amber-800 space-y-1">
                    <p>This plan cannot calculate yet.</p>
                    <ul className="list-disc pl-4">{missing.map(item => <li key={item}>{item}</li>)}</ul>
                    <Button size="sm" variant="outline" onClick={() => setLocation('/blueprint-planning')}>Open setup</Button>
                  </div>
                )}
                {selected?.plan.curbFeet != null && <p data-testid="curb-feet">Curb: {selected.plan.curbFeet.toFixed(0)} ft</p>}
                {(selected?.plan.questions ?? []).map(question => <p key={question} className="text-sm text-amber-800">{question}</p>)}
                {(selected?.plan.materials ?? []).map(material => (
                  <p key={material.label} className="text-sm">{material.label}: {material.yards ?? '—'} yards{material.tons != null ? `, ${material.tons} tons` : ''}{material.truckLoads != null ? `, ${material.truckLoads} loads` : ''}</p>
                ))}
                {selected && <p data-testid="zone-count">Zones: {selected.plan.zoneCount ?? 0}. Heads: {selected.plan.heads?.length ?? 0}.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Order list</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">Required, on hand, and still to order. Fully stocked fittings stay on the list. Calculating does not deduct stock.</p>
                <table className="w-full text-sm" data-testid="order-list">
                  <thead><tr className="text-left text-muted-foreground"><th>Item</th><th>Need</th><th>On hand</th><th>Order</th></tr></thead>
                  <tbody>
                    {(selected?.orderList ?? []).map(row => (
                      <tr key={row.key} data-testid={`order-${row.roleKey}`}>
                        <td>{row.name}</td>
                        <td>{row.required} {row.unit}</td>
                        <td>{row.onHand == null ? '—' : row.onHand}</td>
                        <td>{row.toOrder == null ? '—' : row.toOrder}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(selected?.orderList ?? []).length === 0 && <p className="text-sm text-muted-foreground">Calculate a plan to see every fitting.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Estimate lines</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(selected ? linesFor(selected) : []).map(line => (
                  <div key={line.id} className="space-y-1 border-b pb-2">
                    <Input value={line.customerText} disabled={locked} onChange={event => selected && updateLine(selected, line.id, { customerText: event.target.value })} />
                    <div className="flex gap-2">
                      <Input className="w-20" type="number" value={line.qty} disabled={locked} onChange={event => selected && updateLine(selected, line.id, { qty: Number(event.target.value) })} />
                      <Input className="w-28" type="number" value={line.unitPrice} disabled={locked} onChange={event => selected && updateLine(selected, line.id, { unitPrice: Number(event.target.value) })} />
                      <Button size="sm" variant="ghost" disabled={locked} onClick={() => selected && void saveLines(linesFor(selected).filter(item => item.id !== line.id))}>Remove</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{line.components.map(part => `${part.name} ${part.qty} ${part.unit}`).join(' · ')}</p>
                  </div>
                ))}
                <Button data-testid="save-prices" onClick={() => selected && void saveLines(linesFor(selected))}>Save prices</Button>
                <Button variant="outline" disabled={locked || !selected} onClick={async () => {
                  if (!selected) return;
                  try {
                    const estimate = await customFetch<{ id: number }>(`/api/blueprint-planning/blueprints/${id}/versions/${selected.id}/estimate`, { method: 'POST' });
                    toast.success(`Estimate ${estimate.id} ready`);
                    await refetch();
                  } catch (error) { toast.error(errorMessage(error)); }
                }}>Create estimate</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Versions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {versions.map(version => (
                  <div key={version.id} className="flex items-center justify-between gap-2" data-testid={`version-${version.status}`}>
                    <button className="text-left" onClick={() => setSelectedId(version.id)}>
                      <span className="font-medium">{version.name}</span>
                      <span className="text-xs text-muted-foreground"> {version.status}{version.total != null ? ` · $${version.total.toFixed(2)}` : ''}</span>
                    </button>
                    <Button size="sm" variant="outline" disabled={locked} onClick={async () => {
                      try {
                        await customFetch(`/api/blueprint-planning/blueprints/${id}/versions/${version.id}/choose`, { method: 'POST' });
                        setSelectedId(version.id);
                        toast.success('This version is the plan. The others are archived.');
                        await refetch();
                      } catch (error) { toast.error(errorMessage(error)); }
                    }}>Choose</Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" disabled={locked || !selected} onClick={async () => {
                  if (!selected) return;
                  try {
                    const copy = await customFetch<Version>(`/api/blueprint-planning/blueprints/${id}/versions/${selected.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name: 'Cheaper' }) });
                    setSelectedId(copy.id);
                    await refetch();
                  } catch (error) { toast.error(errorMessage(error)); }
                }}>Save a cheaper copy</Button>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>
                {showArchived && archived.map(version => (
                  <p key={version.id} className="text-sm text-muted-foreground" data-testid="archived-version">{version.name} archived</p>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanMap({ lat, lng, features, draft, heads, lines, satelliteStatus, onSatelliteStatus, onClick }: {
  lat?: number | null;
  lng?: number | null;
  features: Feature[];
  draft: LatLng[];
  heads: { id: string; zone: number; lat: number; lng: number; name: string }[];
  lines: { id: string; kind: string; points: LatLng[] }[];
  satelliteStatus: SatelliteStatus;
  onSatelliteStatus: (status: SatelliteStatus) => void;
  onClick: (point: LatLng) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const [ready, setReady] = useState(false);
  const focus = useMemo(() => {
    const outline = features.find(feature => feature.kind === 'outline' && feature.points.length >= 3);
    return outline?.points ?? features.find(feature => feature.points.length >= 2)?.points ?? null;
  }, [features]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true }).setView([lat ?? 47.6, lng ?? -122.3], 17);
      addSatelliteTileLayer(L, map, onSatelliteStatus);
      map.on('click', (event: import('leaflet').LeafletMouseEvent) => {
        clickRef.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 50);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [lat, lng, onSatelliteStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void import('leaflet').then(L => {
      map.eachLayer(layer => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer); });
      const zoneColors = ['#38bdf8', '#f97316', '#a3e635', '#e879f9', '#facc15'];
      for (const feature of features) {
        const color = feature.kind === 'outline' ? '#2563eb' : feature.areaKind === 'lawn' ? '#16a34a' : feature.kind === 'curb' || feature.areaKind === 'gravel' ? '#d97706' : '#64748b';
        if (feature.points.length >= 3 && feature.kind !== 'curb' && feature.kind !== 'driveway') {
          L.polygon(feature.points.map(point => [point.lat, point.lng]), { color, weight: 2, fillOpacity: feature.disposition === 'bid' ? 0.25 : 0.08 }).addTo(map);
        } else if (feature.points.length >= 2) {
          L.polyline(feature.points.map(point => [point.lat, point.lng]), { color, weight: 3 }).addTo(map);
        } else if (feature.points[0]) {
          L.circleMarker([feature.points[0].lat, feature.points[0].lng], { radius: 6, color: '#0284c7' }).addTo(map).bindTooltip(feature.kind);
        }
      }
      if (draft.length > 0) L.polyline(draft.map(point => [point.lat, point.lng]), { color: '#f59e0b', dashArray: '4 4' }).addTo(map);
      for (const line of lines) {
        if (line.points.length < 2) continue;
        L.polyline(line.points.map(point => [point.lat, point.lng]), { color: line.kind === 'curb' ? '#64748b' : '#0284c7', weight: 3 }).addTo(map);
      }
      for (const head of heads) {
        L.circleMarker([head.lat, head.lng], { radius: 5, color: '#fff', weight: 2, fillColor: zoneColors[head.zone % zoneColors.length], fillOpacity: 1 })
          .addTo(map).bindTooltip(`${head.name} · zone ${head.zone + 1}`);
      }
      if (focus && focus.length >= 2) map.fitBounds(L.latLngBounds(focus.map(point => [point.lat, point.lng])), { padding: [24, 24] });
    });
  }, [features, draft, heads, lines, ready, focus]);

  return (
    <div className="relative h-[28rem] rounded-lg overflow-hidden border">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute bottom-2 left-2 z-[1000] bg-black/70 text-white text-xs px-2 py-1 rounded" data-testid="blueprint-satellite-status">
        {satelliteStatus === 'loaded' ? 'Satellite loaded' : satelliteStatus === 'failed' ? 'Satellite failed' : 'Satellite'}
      </div>
      <div className="absolute top-2 right-2 z-[1000] bg-white/90 text-xs px-2 py-1 rounded" data-testid="sprinkler-heads">{heads.length} sprinklers</div>
    </div>
  );
}
