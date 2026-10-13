import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, useListServices, getListServicesQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ListOrdered, Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { DepositType } from './PaymentPolicyCard';

export interface DepositRule {
  id: string;
  name: string;
  enabled: boolean;
  minTotal: number | null;
  maxTotal: number | null;
  serviceIds: number[];
  serviceMatch: 'any' | 'all';
  depositType: DepositType;
  depositValue: number | null;
}

interface DraftRule {
  id: string;
  name: string;
  enabled: boolean;
  min: string;
  max: string;
  serviceIds: number[];
  serviceMatch: 'any' | 'all';
  depositType: DepositType;
  value: string;
}

export const depositRulesQueryKey = ['billing', 'deposit-rules'] as const;
const URL = '/api/billing/deposit-rules';
const MAX_RULES = 50;

const toDraft = (r: DepositRule): DraftRule => ({
  id: r.id, name: r.name, enabled: r.enabled,
  min: r.minTotal != null ? String(r.minTotal) : '',
  max: r.maxTotal != null ? String(r.maxTotal) : '',
  serviceIds: [...(r.serviceIds ?? [])], serviceMatch: r.serviceMatch ?? 'any',
  depositType: r.depositType, value: r.depositValue != null ? String(r.depositValue) : '',
});

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

function validate(drafts: DraftRule[]): { rules?: DepositRule[]; error?: string } {
  const rules: DepositRule[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const label = `Rule ${i + 1}`;
    const name = d.name.trim();
    if (!name || name.length > 100) return { error: `${label}: name is required (up to 100 characters)` };
    const parse = (s: string) => (s.trim() === '' ? null : Number(s));
    const minTotal = parse(d.min);
    const maxTotal = parse(d.max);
    if (minTotal != null && (!Number.isFinite(minTotal) || minTotal < 0)) return { error: `${label}: minimum must be 0 or more` };
    if (maxTotal != null && (!Number.isFinite(maxTotal) || maxTotal < 0)) return { error: `${label}: maximum must be 0 or more` };
    if (maxTotal != null && maxTotal <= (minTotal ?? 0) && !(minTotal == null && maxTotal > 0)) return { error: `${label}: maximum must be greater than minimum` };
    let depositValue: number | null = null;
    if (d.depositType === 'fixed' || d.depositType === 'percent') {
      const n = Number(d.value);
      if (!d.value.trim() || !Number.isFinite(n) || n <= 0) return { error: `${label}: enter a deposit value greater than zero` };
      if (d.depositType === 'percent' && n > 100) return { error: `${label}: percent cannot exceed 100` };
      depositValue = n;
    }
    rules.push({ id: d.id, name, enabled: d.enabled, minTotal, maxTotal, serviceIds: d.serviceIds, serviceMatch: d.serviceMatch, depositType: d.depositType, depositValue });
  }
  return { rules };
}

const money = (s: string) => `$${Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
function summarize(d: DraftRule, serviceName: (id: number) => string) {
  const hasMin = d.min.trim() !== '' && Number.isFinite(Number(d.min));
  const hasMax = d.max.trim() !== '' && Number.isFinite(Number(d.max));
  const total = hasMin && hasMax ? `total ${money(d.min)} up to ${money(d.max)}` : hasMin ? `total ${money(d.min)} or more` : hasMax ? `total under ${money(d.max)}` : 'any total';
  const svc = d.serviceIds.length === 0 ? 'any service'
    : `${d.serviceMatch === 'all' ? 'all of' : 'any of'} ${d.serviceIds.map(serviceName).join(', ')}`;
  const dep = d.depositType === 'none' ? 'no deposit' : d.depositType === 'full' ? 'full amount'
    : d.depositType === 'fixed' ? `${d.value ? money(d.value) : '$?'} deposit` : `${d.value || '?'}% deposit`;
  return `When ${total} and ${svc}: ${dep}`;
}

export function CompanyDepositRules() {
  const { canManageOffice } = useAuth();
  if (!canManageOffice) return null;
  return <CompanyDepositRulesInner />;
}

function CompanyDepositRulesInner() {
  const qc = useQueryClient();
  const query = useQuery<DepositRule[]>({
    queryKey: depositRulesQueryKey,
    queryFn: async () => (await customFetch<{ rules: DepositRule[] }>(URL))?.rules ?? [],
  });
  const { data: servicesRaw, isLoading: servicesLoading } = useListServices(undefined, { query: { queryKey: getListServicesQueryKey() } });
  const services = Array.isArray(servicesRaw) ? servicesRaw : [];
  const serviceName = (id: number) => services.find(s => s.id === id)?.name ?? `Service #${id}`;

  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DraftRule | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Only hydrate from server when there are no unsaved local edits.
  useEffect(() => {
    if (query.data && !dirtyRef.current) setDrafts(query.data.map(toDraft));
  }, [query.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (rules: DepositRule[]) =>
      customFetch<{ rules: DepositRule[] }>(URL, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) }),
    onSuccess: r => {
      const rules = r?.rules ?? [];
      dirtyRef.current = false;
      setDirty(false);
      setSaveError(null);
      setJustSaved(true);
      setDrafts(rules.map(toDraft));
      qc.setQueryData(depositRulesQueryKey, rules);
      toast.success('Deposit rules saved');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to save deposit rules';
      setSaveError(msg);
      toast.error(msg);
    },
  });

  const mutate = (fn: (d: DraftRule[]) => DraftRule[]) => { setDrafts(fn); setDirty(true); setJustSaved(false); };
  const patch = (id: string, p: Partial<DraftRule>) => mutate(ds => ds.map(d => (d.id === id ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) => mutate(ds => {
    const j = i + dir; if (j < 0 || j >= ds.length) return ds;
    const n = [...ds]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const add = () => {
    if (drafts.length >= MAX_RULES) return;
    mutate(ds => [...ds, { id: newId(), name: `Deposit rule ${ds.length + 1}`, enabled: true, min: '', max: '', serviceIds: [], serviceMatch: 'any', depositType: 'percent', value: '' }]);
  };
  const handleSave = () => {
    const v = validate(drafts);
    if (v.error) { setSaveError(v.error); toast.error(v.error); return; }
    save.mutate(v.rules!);
  };
  const discard = () => {
    dirtyRef.current = false; setDirty(false); setSaveError(null);
    setDrafts((query.data ?? []).map(toDraft));
  };

  const busy = save.isPending;

  return (
    <Card data-testid="card-company-deposit-rules">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ListOrdered className="w-4 h-4 text-primary" />Deposit rules by estimate</CardTitle>
        <CardDescription>
          Rules are checked top to bottom and the first enabled match wins. Customer and service overrides still take priority; estimates that match no rule use the company default above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" />Could not load deposit rules.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => query.refetch()} data-testid="button-retry-deposit-rules"><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : (
          <>
            {drafts.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center" data-testid="empty-deposit-rules">
                <p className="text-sm font-medium">No deposit rules yet</p>
                <p className="text-xs text-muted-foreground mt-1">Every estimate uses the company default. Add a rule to require different deposits for large jobs or specific services.</p>
              </div>
            ) : (
              <ol className="space-y-3" data-testid="list-deposit-rules">
                {drafts.map((d, i) => {
                  const needsValue = d.depositType === 'fixed' || d.depositType === 'percent';
                  return (
                    <li key={d.id} className={`rounded-lg border bg-background p-3 space-y-3 ${d.enabled ? '' : 'opacity-60'}`} data-testid={`row-deposit-rule-${i}`} aria-label={`Deposit rule ${i + 1}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{i + 1}</span>
                        <Input className="h-8 flex-1 min-w-[10rem]" value={d.name} maxLength={100} onChange={e => patch(d.id, { name: e.target.value })} disabled={busy} aria-label={`Rule ${i + 1} name`} data-testid={`input-rule-name-${i}`} />
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Switch checked={d.enabled} onCheckedChange={v => patch(d.id, { enabled: v })} disabled={busy} aria-label={`Rule ${i + 1} enabled`} data-testid={`switch-rule-enabled-${i}`} />
                          {d.enabled ? 'On' : 'Off'}
                        </label>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move rule ${i + 1} up`} data-testid={`button-rule-up-${i}`}><ArrowUp className="w-4 h-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={busy || i === drafts.length - 1} aria-label={`Move rule ${i + 1} down`} data-testid={`button-rule-down-${i}`}><ArrowDown className="w-4 h-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setPendingDelete(d)} disabled={busy} aria-label={`Remove rule ${i + 1}`} data-testid={`button-rule-delete-${i}`}><Trash2 className="w-4 h-4" /></Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <span className="text-xs font-medium">Estimate total (incl. selected options)</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-muted-foreground">$</span>
                            <Input className="h-8" inputMode="decimal" placeholder="No min" value={d.min} onChange={e => patch(d.id, { min: e.target.value })} disabled={busy} aria-label={`Rule ${i + 1} minimum total, inclusive`} data-testid={`input-rule-min-${i}`} />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input className="h-8" inputMode="decimal" placeholder="No max" value={d.max} onChange={e => patch(d.id, { max: e.target.value })} disabled={busy} aria-label={`Rule ${i + 1} maximum total, exclusive`} data-testid={`input-rule-max-${i}`} />
                          </div>
                          <p className="text-[11px] text-muted-foreground">Minimum inclusive, maximum exclusive. Blank means unbounded.</p>
                        </div>
                        <div className="space-y-1">
                          <span className="text-xs font-medium">Deposit</span>
                          <div className="flex items-center gap-1.5">
                            <Select value={d.depositType} onValueChange={v => patch(d.id, { depositType: v as DepositType, value: v === 'fixed' || v === 'percent' ? d.value : '' })} disabled={busy}>
                              <SelectTrigger className="h-8 w-44" aria-label={`Rule ${i + 1} deposit type`} data-testid={`select-rule-type-${i}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No deposit</SelectItem>
                                <SelectItem value="fixed">Fixed amount</SelectItem>
                                <SelectItem value="percent">Percent of estimate</SelectItem>
                                <SelectItem value="full">Full amount</SelectItem>
                              </SelectContent>
                            </Select>
                            {needsValue && (
                              <>
                                {d.depositType === 'fixed' && <span className="text-sm text-muted-foreground">$</span>}
                                <Input className="h-8 w-24" inputMode="decimal" value={d.value} onChange={e => patch(d.id, { value: e.target.value })} disabled={busy} aria-label={`Rule ${i + 1} deposit value`} data-testid={`input-rule-amount-${i}`} />
                                {d.depositType === 'percent' && <span className="text-sm text-muted-foreground">%</span>}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium">Services</span>
                          <Select value={d.serviceMatch} onValueChange={v => patch(d.id, { serviceMatch: v as 'any' | 'all' })} disabled={busy || d.serviceIds.length === 0}>
                            <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Rule ${i + 1} service match`} data-testid={`select-rule-match-${i}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">At least one listed service</SelectItem>
                              <SelectItem value="all">All listed services present</SelectItem>
                            </SelectContent>
                          </Select>
                          {d.serviceIds.length === 0 && <span className="text-[11px] text-muted-foreground">None selected applies to any service.</span>}
                        </div>
                        {servicesLoading ? <Skeleton className="h-8 w-full" /> : services.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No services in your catalog yet.</p>
                        ) : (
                          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={`Rule ${i + 1} services`}>
                            {services.map(s => {
                              const checked = d.serviceIds.includes(s.id);
                              return (
                                <label key={s.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${checked ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
                                  <Checkbox className="h-3.5 w-3.5" checked={checked} disabled={busy}
                                    onCheckedChange={v => patch(d.id, { serviceIds: v ? [...d.serviceIds, s.id] : d.serviceIds.filter(x => x !== s.id) })}
                                    data-testid={`checkbox-rule-service-${i}-${s.id}`} />
                                  {s.name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground border-t pt-2" data-testid={`text-rule-summary-${i}`}>{summarize(d, serviceName)}</p>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Rules apply to unpaid, open estimates when they are accepted. Prepayment and saved-card defaults are not changed by these rules.</span>
            </div>

            {saveError && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive" role="alert" data-testid="text-deposit-rules-error">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{saveError}</span>
                <Button size="sm" variant="outline" onClick={handleSave} disabled={busy} data-testid="button-retry-save-deposit-rules">Retry</Button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={add} disabled={busy || drafts.length >= MAX_RULES} data-testid="button-add-deposit-rule">
                <Plus className="w-3.5 h-3.5" />Add rule {drafts.length >= MAX_RULES && `(limit ${MAX_RULES})`}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs" aria-live="polite" data-testid="status-deposit-rules">
                  {busy ? <span className="text-muted-foreground">Saving...</span>
                    : dirty ? <span className="text-amber-600 dark:text-amber-400">Unsaved changes</span>
                    : justSaved ? <span className="text-emerald-600 dark:text-emerald-400">All changes saved</span> : null}
                </span>
                {dirty && <Button type="button" size="sm" variant="ghost" onClick={discard} disabled={busy} data-testid="button-discard-deposit-rules">Discard</Button>}
                <Button type="button" size="sm" onClick={handleSave} disabled={busy || !dirty} data-testid="button-save-deposit-rules">
                  {busy ? 'Saving...' : 'Save rules'}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={!!pendingDelete} onOpenChange={o => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name || 'Untitled rule'}" will be removed from the list. The change takes effect when you save rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-rule">Keep rule</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-rule"
              onClick={() => { const id = pendingDelete?.id; if (id) mutate(ds => ds.filter(x => x.id !== id)); setPendingDelete(null); }}>
              Remove rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default CompanyDepositRules;
