import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'required' | 'optional' | 'hidden';
type CustomType = 'text' | 'number' | 'dropdown' | 'checkbox';
type CustomField = { id: string; label: string; type: CustomType; status: 'required' | 'optional'; options: string[] };
type Config = { fields: Record<string, Status>; customFields: CustomField[] };

const STANDARD: Array<{ key: string; label: string }> = [
  { key: 'applicatorName', label: 'Applicator name' },
  { key: 'applicatorLicenseNumber', label: 'License / certification number' },
  { key: 'targetPest', label: 'Target pest, weed, or disease' },
  { key: 'productName', label: 'Product trade name' },
  { key: 'epaRegNumber', label: 'EPA registration number' },
  { key: 'activeIngredients', label: 'Active ingredient(s)' },
  { key: 'concentration', label: 'Concentration (%)' },
  { key: 'applicationMethod', label: 'Application method / equipment' },
  { key: 'volumeApplied', label: 'Total product quantity' },
  { key: 'dilutionRate', label: 'Dilution / mix rate' },
  { key: 'treatedArea', label: 'Total treated area (satellite measurement)' },
  { key: 'treatedZoneName', label: 'Treated zone' },
  { key: 'appliedAt', label: 'Application date' },
  { key: 'clockTimes', label: 'Clock-in and clock-out' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'windSpeed', label: 'Wind speed' },
  { key: 'windDirection', label: 'Wind direction' },
  { key: 'humidity', label: 'Relative humidity' },
  { key: 'precipitation', label: 'Precipitation / rain chance' },
  { key: 'notes', label: 'Notes' },
];
const LOCKED = new Set(['productName', 'volumeApplied', 'appliedAt']);
const KEY = ['chemical-record-config'] as const;

export function ChemicalComplianceSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => customFetch<Config>('/api/settings/chemical-record-config'),
  });
  const [draft, setDraft] = useState<Config | null>(null);
  useEffect(() => { if (query.data) setDraft(query.data); }, [query.data]);
  const save = useMutation({
    mutationFn: (config: Config) => customFetch<Config>('/api/settings/chemical-record-config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    }),
    onSuccess: (config) => { setDraft(config); qc.setQueryData(KEY, config); toast.success('Chemical recordkeeping saved'); },
    onError: () => toast.error('Chemical recordkeeping could not be saved'),
  });

  if (query.isLoading || !draft) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading chemical recordkeeping…</CardContent></Card>;
  if (query.isError && !draft.fields) return <Card><CardContent className="p-6 text-sm">Chemical recordkeeping could not be loaded. Existing settings were left unchanged.</CardContent></Card>;

  const setStatus = (key: string, status: Status) => setDraft(current => current ? { ...current, fields: { ...current.fields, [key]: status } } : current);
  const updateCustom = (id: string, patch: Partial<CustomField>) => setDraft(current => current ? { ...current, customFields: current.customFields.map(field => field.id === id ? { ...field, ...patch } : field) } : current);

  return (
    <Card data-testid="section-chemical-compliance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="w-4 h-4" />Chemical Recordkeeping Configuration</CardTitle>
        <CardDescription>Choose which compliance details a technician must record. Hidden fields stay off the job form. Product, quantity, and application time stay required.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          {STANDARD.map(field => (
            <div key={field.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <p className="text-sm">{field.label}</p>
              <Select value={LOCKED.has(field.key) ? 'required' : draft.fields[field.key] ?? 'optional'} onValueChange={value => setStatus(field.key, value as Status)} disabled={!canEdit || LOCKED.has(field.key)}>
                <SelectTrigger className="w-36" data-testid={`select-chemical-field-${field.key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="required">Required</SelectItem>
                  <SelectItem value="optional">Optional</SelectItem>
                  <SelectItem value="hidden">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Custom fields</p>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={!canEdit || draft.customFields.length >= 50} onClick={() => setDraft(current => current ? { ...current, customFields: [...current.customFields, { id: `field-${Date.now()}`, label: 'New field', type: 'text', status: 'optional', options: [] }] } : current)}>
              <Plus className="w-3.5 h-3.5" /> Add Custom Field
            </Button>
          </div>
          {draft.customFields.length === 0 && <p className="text-sm text-muted-foreground">No custom fields yet. Add one for details such as nozzle type, soil temperature, or water pH.</p>}
          {draft.customFields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_140px_140px_auto]">
              <Input value={field.label} disabled={!canEdit} onChange={event => updateCustom(field.id, { label: event.target.value })} aria-label="Field label" />
              <Select value={field.type} disabled={!canEdit} onValueChange={value => updateCustom(field.id, { type: value as CustomType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="dropdown">Dropdown Options</SelectItem>
                  <SelectItem value="checkbox">Checkbox / Boolean</SelectItem>
                </SelectContent>
              </Select>
              <Select value={field.status} disabled={!canEdit} onValueChange={value => updateCustom(field.id, { status: value as 'required' | 'optional' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="optional">Optional</SelectItem>
                  <SelectItem value="required">Required</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="ghost" disabled={!canEdit || index === 0} onClick={() => setDraft(current => {
                  if (!current) return current;
                  const next = [...current.customFields];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  return { ...current, customFields: next };
                })} aria-label="Move up">↑</Button>
                <Button type="button" size="icon" variant="ghost" disabled={!canEdit} onClick={() => setDraft(current => current ? { ...current, customFields: current.customFields.filter(item => item.id !== field.id) } : current)} aria-label="Remove field"><Trash2 className="w-4 h-4" /></Button>
              </div>
              {field.type === 'dropdown' && (
                <Input className="md:col-span-4" placeholder="Options, separated by commas" disabled={!canEdit} value={field.options.join(', ')} onChange={event => updateCustom(field.id, { options: event.target.value.split(',').map(option => option.trim()).filter(Boolean) })} />
              )}
            </div>
          ))}
        </div>
        {canEdit && <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-save-chemical-config">{save.isPending ? 'Saving…' : 'Save chemical recordkeeping'}</Button>}
      </CardContent>
    </Card>
  );
}
