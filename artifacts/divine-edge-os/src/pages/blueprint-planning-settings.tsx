import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const ROLES = [
  ['pipe', 'Pipe'],
  ['sprinkler', 'Sprinklers'],
  ['labor', 'Labor'],
  ['valve_kit', 'Valve kits'],
  ['manifold_kit', 'Manifold kits'],
  ['box', 'Valve box'],
  ['timer', 'Sprinkler timer'],
  ['elbow', 'Elbow'],
  ['tee', 'Tee'],
  ['gravel', 'Gravel'],
  ['bark', 'Bark'],
  ['curb', 'Curb'],
] as const;

type CatalogItem = { id: number; name: string; available: boolean; detail?: string };
type HeadRule = { headType: 'sprinkler' | 'drip'; headKey: string | null; minSpacingFt: number | null; maxSpacingFt: number | null };
type LinkRow = { roleKey: string; sourceKind: string; sourceId: number; customerLabel: string | null; headKey: string; headType?: string | null; name?: string };
type Catalog = {
  settings: {
    sprinklerMinSpacingFt: number | null;
    sprinklerMaxSpacingFt: number | null;
    tonsPerYard: number | null;
    yardsPerTruckLoad: number | null;
    bufferPercent: number;
    zoneExclusions: { a: string; b: string }[];
    headRules?: HeadRule[];
  };
  requiredRoles: Record<string, string[]>;
  links: LinkRow[];
  inventory: (CatalogItem & { nozzle?: string | null; throwFt?: number | null; arcDegrees?: number | null; pattern?: string | null })[];
  kits: CatalogItem[];
  services: (CatalogItem & { category: string | null })[];
  passthroughs: (CatalogItem & { unit: string | null; unitPrice: number })[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not save';
}

function HeadSpecsRow({ link, item, links, onSaved }: {
  link: LinkRow;
  item?: Catalog['inventory'][number];
  links: LinkRow[];
  onSaved: () => void;
}) {
  const [nozzle, setNozzle] = useState(item?.nozzle ?? '');
  const [throwFt, setThrowFt] = useState(item?.throwFt == null ? '' : String(item.throwFt));
  const [arcDegrees, setArcDegrees] = useState(item?.arcDegrees == null ? '' : String(item.arcDegrees));
  const [pattern, setPattern] = useState(item?.pattern ?? '');
  return (
    <div className="grid gap-2 border-b pb-3 sm:grid-cols-[12rem_8rem_1fr]" data-testid={`head-specs-${link.sourceId}`}>
      <div>
        <p className="text-sm font-medium">{link.name || link.headKey}</p>
        <Select value={link.headType === 'drip' ? 'drip' : 'sprinkler'} onValueChange={value => {
          const next = links.map(row => row.sourceKind === link.sourceKind && row.sourceId === link.sourceId ? { ...row, headType: value } : row);
          void customFetch('/api/blueprint-planning/links', {
            method: 'PUT',
            body: JSON.stringify({ links: next.map(row => ({ roleKey: row.roleKey, sourceKind: row.sourceKind, sourceId: row.sourceId, customerLabel: row.customerLabel, headType: row.headType ?? null })) }),
          }).then(onSaved).catch(error => toast.error(errorMessage(error)));
        }}>
          <SelectTrigger className="w-36 h-8" data-testid={`head-type-${link.sourceId}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sprinkler">Sprinkler</SelectItem>
            <SelectItem value="drip">Drip emitter</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Input className="w-28 h-8" placeholder="Nozzle" aria-label="Nozzle" value={nozzle} onChange={event => setNozzle(event.target.value)} />
        <Input className="w-24 h-8" type="number" placeholder="Throw ft" aria-label="Throw" value={throwFt} onChange={event => setThrowFt(event.target.value)} />
        <Input className="w-24 h-8" type="number" placeholder="Arc" aria-label="Arc" value={arcDegrees} onChange={event => setArcDegrees(event.target.value)} />
        <Input className="w-28 h-8" placeholder="Pattern" aria-label="Pattern" value={pattern} onChange={event => setPattern(event.target.value)} />
        <Button type="button" size="sm" variant="outline" data-testid={`save-head-specs-${link.sourceId}`} onClick={() => {
          void customFetch(`/api/blueprint-planning/heads/${link.sourceId}/specs`, {
            method: 'PUT',
            body: JSON.stringify({
              nozzle,
              throwFt: throwFt === '' ? null : Number(throwFt),
              arcDegrees: arcDegrees === '' ? null : Number(arcDegrees),
              pattern,
            }),
          }).then(onSaved).catch(error => toast.error(errorMessage(error)));
        }}>Save nozzle</Button>
      </div>
    </div>
  );
}

export default function BlueprintPlanningSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['blueprint-planning-catalog'],
    queryFn: () => customFetch<Catalog>('/api/blueprint-planning/catalog'),
  });
  const [draft, setDraft] = useState<Catalog['settings'] | null>(null);
  const settings = draft ?? data?.settings ?? null;
  const [exclusionA, setExclusionA] = useState('');
  const [exclusionB, setExclusionB] = useState('');
  const [passName, setPassName] = useState('');
  const [passUnit, setPassUnit] = useState('load');
  const [passPrice, setPassPrice] = useState('');

  const sprinklerChoices = useMemo(() => (data?.links ?? []).filter(link => link.roleKey === 'sprinkler'), [data?.links]);

  const saveSettings = async (next: Catalog['settings']) => {
    const headRules = [
      ...(next.sprinklerMinSpacingFt != null && next.sprinklerMaxSpacingFt != null
        ? [{ headType: 'sprinkler' as const, headKey: null, minSpacingFt: next.sprinklerMinSpacingFt, maxSpacingFt: next.sprinklerMaxSpacingFt }]
        : []),
      ...((next.headRules ?? []).filter(rule => rule.headType === 'drip' || rule.headKey)),
    ];
    try {
      const saved = await customFetch<Catalog['settings']>('/api/blueprint-planning/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...next, headRules }),
      });
      setDraft(saved);
      toast.success('Planning settings saved');
      qc.invalidateQueries({ queryKey: ['blueprint-planning-catalog'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const setAvailable = async (sourceKind: string, sourceId: number, available: boolean) => {
    try {
      await customFetch('/api/blueprint-planning/availability', {
        method: 'PUT',
        body: JSON.stringify({ sourceKind, sourceId, available }),
      });
      qc.invalidateQueries({ queryKey: ['blueprint-planning-catalog'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const setRole = async (sourceKind: string, sourceId: number, roleKey: string) => {
    const links = (data?.links ?? []).filter(link => !(link.sourceKind === sourceKind && link.sourceId === sourceId));
    if (roleKey !== 'none') links.push({ roleKey, sourceKind, sourceId, customerLabel: null, headKey: `${sourceKind}:${sourceId}` });
    try {
      await customFetch('/api/blueprint-planning/links', {
        method: 'PUT',
        body: JSON.stringify({ links: links.map(link => ({ roleKey: link.roleKey, sourceKind: link.sourceKind, sourceId: link.sourceId, customerLabel: link.customerLabel, headType: link.headType ?? null })) }),
      });
      qc.invalidateQueries({ queryKey: ['blueprint-planning-catalog'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (isLoading || !data || !settings) return <p className="text-sm text-muted-foreground">Loading blueprint planning setup…</p>;

  const missingSprinkler = (data.requiredRoles.sprinkler ?? []).filter(role => !data.links.some(link => link.roleKey === role));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Blueprint planning</h1>
        <p className="text-muted-foreground mt-1">Choose what can be used on a blueprint, then link each one to the job it fills. A plan does not calculate until the links that job needs are set.</p>
      </div>

      {missingSprinkler.length > 0 && (
        <Card data-testid="planning-setup-empty">
          <CardHeader>
            <CardTitle className="text-base">Sprinkler plans are waiting on setup</CardTitle>
            <CardDescription>Link these before a sprinkler plan can calculate: {missingSprinkler.map(role => ROLES.find(item => item[0] === role)?.[1] ?? role).join(', ')}. Also set how close and how far apart the heads go.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spacing, buffer, and material conversion</CardTitle>
          <CardDescription>Leave tons per yard and yards per truck blank until you know them. The plan will not invent a density.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Closest sprinklers (ft)
            <Input type="number" min="0" value={settings.sprinklerMinSpacingFt ?? ''} onChange={event => setDraft({ ...settings, sprinklerMinSpacingFt: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
          <label className="text-sm">Farthest apart (ft)
            <Input type="number" min="0" value={settings.sprinklerMaxSpacingFt ?? ''} onChange={event => setDraft({ ...settings, sprinklerMaxSpacingFt: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
          <label className="text-sm">Closest drip emitters (ft)
            <Input type="number" min="0" data-testid="drip-min-spacing" value={(settings.headRules ?? []).find(rule => rule.headType === 'drip' && !rule.headKey)?.minSpacingFt ?? ''} onChange={event => {
              const minSpacingFt = event.target.value === '' ? null : Number(event.target.value);
              const current = (settings.headRules ?? []).find(rule => rule.headType === 'drip' && !rule.headKey);
              const rest = (settings.headRules ?? []).filter(rule => !(rule.headType === 'drip' && !rule.headKey));
              setDraft({ ...settings, headRules: [...rest, { headType: 'drip', headKey: null, minSpacingFt, maxSpacingFt: current?.maxSpacingFt ?? null }] });
            }} />
          </label>
          <label className="text-sm">Farthest drip emitters (ft)
            <Input type="number" min="0" data-testid="drip-max-spacing" value={(settings.headRules ?? []).find(rule => rule.headType === 'drip' && !rule.headKey)?.maxSpacingFt ?? ''} onChange={event => {
              const maxSpacingFt = event.target.value === '' ? null : Number(event.target.value);
              const current = (settings.headRules ?? []).find(rule => rule.headType === 'drip' && !rule.headKey);
              const rest = (settings.headRules ?? []).filter(rule => !(rule.headType === 'drip' && !rule.headKey));
              setDraft({ ...settings, headRules: [...rest, { headType: 'drip', headKey: null, minSpacingFt: current?.minSpacingFt ?? null, maxSpacingFt }] });
            }} />
          </label>
          <label className="text-sm">Order buffer %
            <Input type="number" min="0" value={settings.bufferPercent} onChange={event => setDraft({ ...settings, bufferPercent: Number(event.target.value) })} />
          </label>
          <label className="text-sm">Tons per yard
            <Input type="number" min="0" step="0.01" value={settings.tonsPerYard ?? ''} onChange={event => setDraft({ ...settings, tonsPerYard: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
          <label className="text-sm">Yards per truck load
            <Input type="number" min="0" step="0.1" value={settings.yardsPerTruckLoad ?? ''} onChange={event => setDraft({ ...settings, yardsPerTruckLoad: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
          <div className="flex items-end"><Button onClick={() => saveSettings(settings)}>Save measurements</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Heads that cannot share a zone</CardTitle>
          <CardDescription>Pick two sprinklers you already linked. The plan puts them on different zones.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sprinklerChoices.length < 2 ? <p className="text-sm text-muted-foreground">Link at least two sprinkler items before adding a zone rule.</p> : (
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={exclusionA} onValueChange={setExclusionA}>
                <SelectTrigger className="w-48"><SelectValue placeholder="First sprinkler" /></SelectTrigger>
                <SelectContent>{sprinklerChoices.map(link => <SelectItem key={link.headKey} value={link.headKey}>{link.name || link.headKey}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={exclusionB} onValueChange={setExclusionB}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Second sprinkler" /></SelectTrigger>
                <SelectContent>{sprinklerChoices.map(link => <SelectItem key={`b-${link.headKey}`} value={link.headKey}>{link.name || link.headKey}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" onClick={() => {
                if (!exclusionA || !exclusionB || exclusionA === exclusionB) return;
                const next = { ...settings, zoneExclusions: [...settings.zoneExclusions, { a: exclusionA, b: exclusionB }] };
                setDraft(next);
                void saveSettings(next);
              }}>Add rule</Button>
            </div>
          )}
          <ul className="text-sm space-y-1" data-testid="zone-rules">
            {settings.zoneExclusions.map((pair, index) => {
              const nameOf = (key: string) => sprinklerChoices.find(link => link.headKey === key)?.name || key;
              return (
              <li key={`${pair.a}-${pair.b}-${index}`} className="flex items-center justify-between gap-2">
                <span>{nameOf(pair.a)} cannot share a zone with {nameOf(pair.b)}</span>
                <Button size="sm" variant="ghost" onClick={() => {
                  const next = { ...settings, zoneExclusions: settings.zoneExclusions.filter((_, item) => item !== index) };
                  setDraft(next);
                  void saveSettings(next);
                }}>Remove</Button>
              </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Head type and nozzle</CardTitle>
          <CardDescription>These company rules apply to every blueprint. Sprinklers and drip emitters keep their own spacing. A nozzle suggestion uses only the nozzle, throw, arc, or pattern stored here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sprinklerChoices.length === 0 ? <p className="text-sm text-muted-foreground">Link a sprinkler first.</p> : sprinklerChoices.map(link => (
            <HeadSpecsRow key={link.headKey} link={link} item={data.inventory.find(row => row.id === link.sourceId)} links={data.links} onSaved={() => qc.invalidateQueries({ queryKey: ['blueprint-planning-catalog'] })} />
          ))}
        </CardContent>
      </Card>

      <CatalogBlock title="Inventory" kind="inventory" items={data.inventory} links={data.links} onAvailable={setAvailable} onRole={setRole} />
      <CatalogBlock title="Kits" kind="kit" items={data.kits} links={data.links} onAvailable={setAvailable} onRole={setRole} />
      <CatalogBlock title="Services and labor" kind="service" items={data.services.map(service => ({ ...service, detail: service.category ?? undefined }))} links={data.links} onAvailable={setAvailable} onRole={setRole} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pass-through charges</CardTitle>
          <CardDescription>Stored for blueprints. These are not the estimate line picker.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Charge name" value={passName} onChange={event => setPassName(event.target.value)} className="max-w-xs" />
            <Input placeholder="Unit" value={passUnit} onChange={event => setPassUnit(event.target.value)} className="w-28" />
            <Input placeholder="Price" type="number" value={passPrice} onChange={event => setPassPrice(event.target.value)} className="w-28" />
            <Button onClick={async () => {
              if (!passName.trim()) return;
              try {
                await customFetch('/api/blueprint-planning/passthroughs', { method: 'POST', body: JSON.stringify({ name: passName, unit: passUnit, unitPrice: Number(passPrice) || 0, available: true }) });
                setPassName('');
                setPassPrice('');
                qc.invalidateQueries({ queryKey: ['blueprint-planning-catalog'] });
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}>Add charge</Button>
          </div>
          <CatalogRows kind="passthrough" items={data.passthroughs.map(row => ({ id: row.id, name: row.name, available: row.available, detail: row.unit ?? undefined }))} links={data.links} onAvailable={setAvailable} onRole={setRole} />
        </CardContent>
      </Card>
    </div>
  );
}

function CatalogBlock({ title, kind, items, links, onAvailable, onRole }: {
  title: string;
  kind: string;
  items: CatalogItem[];
  links: LinkRow[];
  onAvailable: (kind: string, id: number, available: boolean) => Promise<void>;
  onRole: (kind: string, id: number, role: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const shown = items.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 40);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Turn on the ones a blueprint can use, then pick the role they fill.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder={`Search ${title.toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} />
        <CatalogRows kind={kind} items={shown} links={links} onAvailable={onAvailable} onRole={onRole} />
      </CardContent>
    </Card>
  );
}

function CatalogRows({ kind, items, links, onAvailable, onRole }: {
  kind: string;
  items: CatalogItem[];
  links: LinkRow[];
  onAvailable: (kind: string, id: number, available: boolean) => Promise<void>;
  onRole: (kind: string, id: number, role: string) => Promise<void>;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nothing in this list yet.</p>;
  return (
    <ul className="divide-y">
      {items.map(item => {
        const link = links.find(row => row.sourceKind === kind && row.sourceId === item.id);
        return (
          <li key={`${kind}-${item.id}`} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-40 flex-1">
              <p className="text-sm font-medium">{item.name}</p>
              {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>On blueprints</span>
              <Switch checked={item.available} onCheckedChange={checked => void onAvailable(kind, item.id, checked)} />
            </div>
            <Select value={link?.roleKey ?? 'none'} onValueChange={role => void onRole(kind, item.id, role)} disabled={!item.available}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No role yet</SelectItem>
                {ROLES.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </li>
        );
      })}
    </ul>
  );
}
