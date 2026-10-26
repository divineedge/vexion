import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetPlatformBillingAdmin, getGetPlatformBillingAdminQueryKey,
  useUpdatePlatformBillingSettings, useCreatePlatformSoftwarePlan, useUpdatePlatformSoftwarePlan,
  usePublishPlatformSoftwarePlan, useRetryPlatformPayout,
} from '@workspace/api-client-react';
import type { PlatformAdminOverview, PlatformBillingSettingsInput, SoftwarePlan, SoftwarePlanInput } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { PayoutTable, earnedPlatformFees } from '@/components/billing/PayoutTable';
import { cents, feeLabel, errorMessage, REVERSED } from '@/lib/softwareBilling';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, Plus, Pencil, Rocket, AlertTriangle, PauseCircle, RefreshCw, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const TABS = ['overview', 'plans', 'fees', 'payouts', 'audit'] as const;
type Tab = typeof TABS[number];

export default function SoftwareAdminPage() {
  const { isSuperAdmin, user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const initial = new URLSearchParams(search).get('tab') as Tab | null;
  const tab: Tab = initial && TABS.includes(initial) ? initial : 'overview';
  const qc = useQueryClient();
  const adminKey = [...getGetPlatformBillingAdminQueryKey(), user?.id ?? null, user?.tenantId ?? null];
  const admin = useGetPlatformBillingAdmin({ query: { enabled: isSuperAdmin, queryKey: adminKey } });
  const refresh = () => qc.invalidateQueries({ queryKey: getGetPlatformBillingAdminQueryKey() });

  if (!isSuperAdmin) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-3" data-testid="state-no-access">
        <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center"><Lock className="w-5 h-5 text-muted-foreground" /></div>
        <h1 className="text-xl font-semibold">Software Admin is restricted</h1>
        <p className="text-sm text-muted-foreground">This area is only available to accounts with an explicit software-owner grant. Business owners can manage their own subscription under Settings → Payments.</p>
        <Button variant="outline" onClick={() => setLocation('/dashboard')}>Back to dashboard</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><ShieldCheck className="w-4 h-4" />Software owner</div>
          <h1 className="text-3xl font-bold tracking-tight">Software Admin</h1>
          <p className="text-muted-foreground text-sm">Divine Edge OS subscriptions, platform fees, and business payouts.</p>
        </div>
        {admin.data && (
          <Badge variant="outline" className={admin.data.settings.enabled ? 'bg-primary/10 text-primary border-primary/30' : 'bg-amber-50 text-amber-800 border-amber-200'} data-testid="status-activation">
            {admin.data.settings.enabled ? 'Monetization active' : 'Setup paused — not live'}
          </Badge>
        )}
      </div>

      {admin.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-10 w-80" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : admin.isError || !admin.data ? (
        <Card><CardContent className="py-10 text-center space-y-3">
          <AlertTriangle className="w-6 h-6 mx-auto text-destructive" />
          <p className="text-sm">Could not load software admin data. {errorMessage(admin.error, '')}</p>
          <Button variant="outline" onClick={() => admin.refetch()} data-testid="button-retry-admin"><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>
        </CardContent></Card>
      ) : (
        <Tabs value={tab} onValueChange={v => setLocation(`/software-admin?tab=${v}`)}>
          <TabsList className="flex-wrap h-auto">
            {TABS.map(t => <TabsTrigger key={t} value={t} className="capitalize" data-testid={`tab-${t}`}>{t}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="overview" className="mt-6"><Overview data={admin.data} /></TabsContent>
          <TabsContent value="plans" className="mt-6"><PlansTab plans={admin.data.plans} enabled={admin.data.settings.enabled} onChanged={refresh} /></TabsContent>
          <TabsContent value="fees" forceMount className="mt-6 data-[state=inactive]:hidden"><FeesTab settings={admin.data.settings} onChanged={refresh} /></TabsContent>
          <TabsContent value="payouts" className="mt-6"><PayoutsTab data={admin.data} onChanged={refresh} /></TabsContent>
          <TabsContent value="audit" className="mt-6"><AuditTab audit={admin.data.audit} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

type Admin = PlatformAdminOverview;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card><CardContent className="pt-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </CardContent></Card>
  );
}

function Overview({ data }: { data: Admin }) {
  const active = data.businesses.filter(b => b.status === 'active' || b.status === 'trialing').length;
  const connected = data.businesses.filter(b => b.connectReady).length;
  const pending = data.payouts.filter(p => p.platformFeeCents == null && !REVERSED(p.status)).length;
  const planName = (id: number | null) => data.plans.find(p => p.id === id)?.name ?? '—';
  return (
    <div className="space-y-6">
      {!data.settings.enabled && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="banner-paused">
          <PauseCircle className="w-5 h-5 shrink-0" />
          <div>Monetization is paused. No plan can be published and no platform fees are charged until you activate it under <b>Fees</b>.</div>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Businesses" value={String(data.businesses.length)} hint={`${active} with confirmed subscription`} />
        <Stat label="Payments connected" value={String(connected)} hint="Stripe Connect ready" />
        <Stat label="Platform fees earned" value={cents(earnedPlatformFees(data.payouts)) ?? '$0.00'} hint="Excludes reversed & pending" />
        <Stat label="Fees pending" value={String(pending)} hint="Awaiting Stripe fee data" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Businesses</CardTitle><CardDescription>Status is shown as confirmed by Stripe.</CardDescription></CardHeader>
        <CardContent>
          {data.businesses.length === 0 ? <p className="text-sm text-muted-foreground">No businesses yet.</p> : (
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Period end</TableHead><TableHead>Payments</TableHead></TableRow></TableHeader>
              <TableBody>{data.businesses.map(b => (
                <TableRow key={b.tenantId} data-testid={`row-business-${b.tenantId}`}>
                  <TableCell className="font-medium">{b.companyName}</TableCell>
                  <TableCell>{planName(b.planId)}</TableCell>
                  <TableCell><Badge variant="outline">{b.status.replace(/_/g, ' ')}{b.cancelAtPeriodEnd ? ' · cancels' : ''}</Badge></TableCell>
                  <TableCell className="text-xs">{b.currentPeriodEnd ? format(new Date(b.currentPeriodEnd), 'MMM d, yyyy') : '—'}</TableCell>
                  <TableCell className="text-xs">{b.connectReady ? 'Ready' : b.hasConnectAccount ? 'Onboarding' : 'Not connected'}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Plans ────────────────────────────────────────────────────────────────
type Draft = { name: string; tier: string; price: string; billingInterval: 'month' | 'year'; active: boolean; features: string; maxUsers: string; maxProperties: string; cardPct: string; cardFixed: string; achPct: string; achFixed: string };
const emptyDraft: Draft = { name: '', tier: '', price: '', billingInterval: 'month', active: true, features: '', maxUsers: '', maxProperties: '', cardPct: '', cardFixed: '', achPct: '', achFixed: '' };

function toDraft(p: SoftwarePlan): Draft {
  const s = (n: number | null) => (n == null ? '' : String(n));
  return {
    name: p.name, tier: p.tier, price: p.price.toFixed(2), billingInterval: p.billingInterval, active: p.active,
    features: p.features.join('\n'), maxUsers: s(p.maxUsers), maxProperties: s(p.maxProperties),
    cardPct: p.cardFeeBps == null ? '' : String(p.cardFeeBps / 100), cardFixed: p.cardFeeFixedCents == null ? '' : (p.cardFeeFixedCents / 100).toFixed(2),
    achPct: p.achFeeBps == null ? '' : String(p.achFeeBps / 100), achFixed: p.achFeeFixedCents == null ? '' : (p.achFeeFixedCents / 100).toFixed(2),
  };
}

function parseDraft(d: Draft): { ok: true; value: SoftwarePlanInput } | { ok: false; error: string } {
  if (!d.name.trim()) return { ok: false, error: 'Name is required' };
  if (!d.tier.trim()) return { ok: false, error: 'Tier is required' };
  const price = Number(d.price);
  if (!/^\d+(\.\d{1,2})?$/.test(d.price.trim()) || !(price > 0)) return { ok: false, error: 'Price must be a positive dollar amount (2 decimals max)' };
  const optInt = (v: string, label: string): number | null | string => {
    if (v.trim() === '') return null; const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : `${label} must be a whole number`;
  };
  const optBps = (v: string, label: string): number | null | string => {
    if (v.trim() === '') return null; const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : `${label} must be 0–100%`;
  };
  const optCents = (v: string, label: string): number | null | string => {
    if (v.trim() === '') return null; const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : `${label} must be $0–$1,000`;
  };
  const vals = [optInt(d.maxUsers, 'Max users'), optInt(d.maxProperties, 'Max properties'), optBps(d.cardPct, 'Card %'), optCents(d.cardFixed, 'Card fixed'), optBps(d.achPct, 'ACH %'), optCents(d.achFixed, 'ACH fixed')];
  const err = vals.find(v => typeof v === 'string');
  if (typeof err === 'string') return { ok: false, error: err };
  const [maxUsers, maxProperties, cardFeeBps, cardFeeFixedCents, achFeeBps, achFeeFixedCents] = vals as (number | null)[];
  return { ok: true, value: {
    name: d.name.trim(), tier: d.tier.trim(), price: Math.round(price * 100) / 100, billingInterval: d.billingInterval, active: d.active,
    features: d.features.split('\n').map(s => s.trim()).filter(Boolean), maxUsers, maxProperties, cardFeeBps, cardFeeFixedCents, achFeeBps, achFeeFixedCents,
  } };
}

function PlansTab({ plans, enabled, onChanged }: { plans: SoftwarePlan[]; enabled: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<SoftwarePlan | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [publishTarget, setPublishTarget] = useState<SoftwarePlan | null>(null);
  const create = useCreatePlatformSoftwarePlan();
  const update = useUpdatePlatformSoftwarePlan();
  const publish = usePublishPlatformSoftwarePlan();
  const sorted = useMemo(() => [...plans].sort((a, b) => Number(b.active) - Number(a.active) || a.price - b.price), [plans]);

  const open = (p: SoftwarePlan | 'new') => { setEditing(p); setDraft(p === 'new' ? emptyDraft : toDraft(p)); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const save = () => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) { toast.error(parsed.error); return; }
    const opts = {
      onSuccess: () => { toast.success(editing === 'new' ? 'Draft plan saved' : 'Plan saved as a new revision'); setEditing(null); onChanged(); },
      onError: (e: unknown) => toast.error(errorMessage(e, 'Could not save plan')),
    };
    if (editing === 'new') create.mutate({ data: parsed.value }, opts);
    else if (editing) update.mutate({ id: editing.id, data: parsed.value }, opts);
  };

  const doPublish = () => {
    if (!publishTarget) return;
    publish.mutate({ id: publishTarget.id }, {
      onSuccess: () => { toast.success('Plan published to Stripe'); setPublishTarget(null); onChanged(); },
      onError: e => { toast.error(errorMessage(e, 'Publishing failed')); setPublishTarget(null); },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">Saving keeps a draft. Publishing creates the Stripe product and recurring price. Editing a plan creates a new revision — existing subscriptions are never repriced automatically.</p>
        <Button onClick={() => open('new')} data-testid="button-new-plan"><Plus className="w-4 h-4 mr-2" />New plan</Button>
      </div>
      {!enabled && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">Publishing is disabled until monetization is activated under Fees.</p>}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground" data-testid="empty-plans">No software plans yet. Create a draft to get started.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map(p => (
            <Card key={p.id} className={p.active ? '' : 'opacity-60'} data-testid={`card-plan-${p.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription className="uppercase text-[11px] tracking-wider">{p.tier} · rev {p.revision}</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className={p.published ? 'bg-primary/10 text-primary border-primary/30' : ''}>{p.published ? 'Published' : 'Draft'}</Badge>
                    {!p.active && <Badge variant="secondary">Archived</Badge>}
                  </div>
                </div>
                <p className="text-2xl font-bold tabular-nums">{cents(Math.round(p.price * 100))}<span className="text-sm font-normal text-muted-foreground">/{p.billingInterval}</span></p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ul className="space-y-1 text-muted-foreground">{p.features.slice(0, 5).map((f, i) => <li key={i}>• {f}</li>)}</ul>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Users: {p.maxUsers ?? 'Unlimited'} · Properties: {p.maxProperties ?? 'Unlimited'}</div>
                  <div>Card: {feeLabel(p.cardFeeBps, p.cardFeeFixedCents)}</div>
                  <div>ACH: {feeLabel(p.achFeeBps, p.achFeeFixedCents)}</div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => open(p)} data-testid={`button-edit-plan-${p.id}`}><Pencil className="w-3.5 h-3.5 mr-1.5" />Edit</Button>
                  <Button size="sm" disabled={!enabled || !p.active || publish.isPending} onClick={() => setPublishTarget(p)} data-testid={`button-publish-plan-${p.id}`}>
                    <Rocket className="w-3.5 h-3.5 mr-1.5" />{p.published ? 'Republish' : 'Publish'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New software plan' : 'Edit software plan'}</DialogTitle>
            <DialogDescription>{editing === 'new' ? 'Saved as a draft. Publish separately.' : 'Saving creates a new revision. Current subscribers keep their existing price.'}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1 space-y-1"><Label>Name</Label><Input value={draft.name} onChange={e => set('name', e.target.value)} data-testid="input-plan-name" /></div>
            <div className="col-span-2 sm:col-span-1 space-y-1"><Label>Tier key</Label><Input value={draft.tier} onChange={e => set('tier', e.target.value)} data-testid="input-plan-tier" /></div>
            <div className="space-y-1"><Label>Price (USD)</Label><Input inputMode="decimal" value={draft.price} onChange={e => set('price', e.target.value)} data-testid="input-plan-price" /></div>
            <div className="space-y-1"><Label>Interval</Label>
              <Select value={draft.billingInterval} onValueChange={v => set('billingInterval', v as 'month' | 'year')}>
                <SelectTrigger data-testid="select-plan-interval"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="month">Monthly</SelectItem><SelectItem value="year">Yearly</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Max users</Label><Input placeholder="Unlimited" value={draft.maxUsers} onChange={e => set('maxUsers', e.target.value)} /></div>
            <div className="space-y-1"><Label>Max properties</Label><Input placeholder="Unlimited" value={draft.maxProperties} onChange={e => set('maxProperties', e.target.value)} /></div>
            <div className="col-span-2 space-y-1"><Label>Features (one per line)</Label><Textarea rows={4} value={draft.features} onChange={e => set('features', e.target.value)} data-testid="input-plan-features" /></div>
            <div className="col-span-2 pt-1"><p className="text-xs font-medium">Platform fee override — leave blank to inherit the company-wide fee</p></div>
            <div className="space-y-1"><Label>Card %</Label><Input placeholder="Inherit" value={draft.cardPct} onChange={e => set('cardPct', e.target.value)} /></div>
            <div className="space-y-1"><Label>Card fixed ($)</Label><Input placeholder="Inherit" value={draft.cardFixed} onChange={e => set('cardFixed', e.target.value)} /></div>
            <div className="space-y-1"><Label>ACH %</Label><Input placeholder="Inherit" value={draft.achPct} onChange={e => set('achPct', e.target.value)} /></div>
            <div className="space-y-1"><Label>ACH fixed ($)</Label><Input placeholder="Inherit" value={draft.achFixed} onChange={e => set('achFixed', e.target.value)} /></div>
            <div className="col-span-2 flex items-center justify-between rounded-md border p-3">
              <div><p className="text-sm font-medium">Active</p><p className="text-xs text-muted-foreground">Turn off to archive. Archived plans stay on record and aren't offered.</p></div>
              <Switch checked={draft.active} onCheckedChange={v => set('active', v)} data-testid="switch-plan-active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={create.isPending || update.isPending} data-testid="button-save-plan">{create.isPending || update.isPending ? 'Saving…' : 'Save draft'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={publishTarget != null} onOpenChange={o => !o && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish “{publishTarget?.name}” to Stripe?</AlertDialogTitle>
            <AlertDialogDescription>This creates a real Stripe product and recurring {publishTarget?.billingInterval}ly price, and offers it to business owners. Existing subscribers are not repriced.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doPublish} data-testid="button-confirm-publish">Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Fees ─────────────────────────────────────────────────────────────────
function FeesTab({ settings, onChanged }: { settings: PlatformBillingSettingsInput; onChanged: () => void }) {
  const mutation = useUpdatePlatformBillingSettings();
  const mutateRef = useRef(mutation.mutateAsync); mutateRef.current = mutation.mutateAsync;
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const autosave = useSettingsAutosave(
    patch => mutateRef.current({ data: patch.settings as PlatformBillingSettingsInput }),
    { onSaved: () => onChangedRef.current() },
  );
  const [f, setF] = useState({
    cardPct: String(settings.cardFeeBps / 100), cardFixed: (settings.cardFeeFixedCents / 100).toFixed(2),
    achPct: String(settings.achFeeBps / 100), achFixed: (settings.achFeeFixedCents / 100).toFixed(2),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const enabledRef = useRef(settings.enabled); enabledRef.current = settings.enabled;
  const lastJson = useRef<string | null>(null);

  const parsed = useMemo(() => {
    const pct = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null; };
    const fixed = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : null; };
    const r = { cardFeeBps: pct(f.cardPct), cardFeeFixedCents: fixed(f.cardFixed), achFeeBps: pct(f.achPct), achFeeFixedCents: fixed(f.achFixed) };
    return Object.values(r).every(v => v != null) ? (r as { cardFeeBps: number; cardFeeFixedCents: number; achFeeBps: number; achFeeFixedCents: number }) : null;
  }, [f]);

  useEffect(() => {
    if (!parsed) return;
    const json = JSON.stringify(parsed);
    if (lastJson.current === null) { lastJson.current = json; return; }
    if (json === lastJson.current) return;
    lastJson.current = json;
    // Full validated snapshot; activation state always mirrors the server.
    autosave.queue({ settings: { enabled: enabledRef.current, ...parsed } });
  }, [parsed, autosave.queue]);

  const setActivation = async (enabled: boolean) => {
    if (!parsed) { toast.error('Fix fee values before changing activation'); return; }
    setToggling(true);
    try {
      await autosave.flush();
      await mutation.mutateAsync({ data: { enabled, ...parsed, ...(enabled ? { confirmActivation: true } : {}) } });
      toast.success(enabled ? 'Monetization activated' : 'Monetization paused');
      onChanged();
    } catch (e) { toast.error(errorMessage(e, 'Could not change activation')); }
    finally { setToggling(false); setConfirmOpen(false); }
  };

  const field = (k: keyof typeof f, label: string, suffix: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input inputMode="decimal" value={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.value }))} data-testid={`input-fee-${k}`} className="pr-8" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <Card className={settings.enabled ? 'border-primary/40' : 'border-amber-200'}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Activation</CardTitle>
            <CardDescription>{settings.enabled ? 'Live: published plans are offered and platform fees apply to online payments.' : 'Off by default. Nothing is charged and plans cannot be published.'}</CardDescription>
          </div>
          <Switch checked={settings.enabled} disabled={toggling}
            onCheckedChange={v => (v ? setConfirmOpen(true) : void setActivation(false))} data-testid="switch-activation" />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Company-wide platform fee</CardTitle>
            <CardDescription>Deducted from each business's online payment alongside the actual Stripe fee. Never added to the customer's invoice. Plans may override.</CardDescription>
          </div>
          <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => void autosave.retry()} />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          {field('cardPct', 'Card percentage', '%')}
          {field('cardFixed', 'Card fixed per payment', '$')}
          {field('achPct', 'ACH percentage', '%')}
          {field('achFixed', 'ACH fixed per payment', '$')}
          {!parsed && <p className="col-span-2 text-xs text-destructive">Enter 0–100% and $0–$1,000. Invalid values are not saved.</p>}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate software monetization?</AlertDialogTitle>
            <AlertDialogDescription>
              Once active, businesses that have not completed Stripe Connect onboarding will not be able to accept future online payments. Platform fees will be deducted from connected businesses' payouts, and plans can be published to Stripe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep paused</AlertDialogCancel>
            <AlertDialogAction onClick={() => void setActivation(true)} disabled={toggling} data-testid="button-confirm-activation">I understand, activate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PayoutsTab({ data, onChanged }: { data: Admin; onChanged: () => void }) {
  const retry = useRetryPlatformPayout();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const onRetry = (id: string) => {
    setRetryingId(id);
    retry.mutate({ id }, {
      onSuccess: () => { toast.success('Retry submitted'); onChanged(); },
      onError: e => toast.error(errorMessage(e, 'Retry failed')),
      onSettled: () => setRetryingId(null),
    });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Only pending and reversal-pending payouts can be retried. Unknown fees show as pending until Stripe reports them.</p>
      <PayoutTable payouts={data.payouts} showTenant onRetry={onRetry} retryingId={retryingId} />
    </div>
  );
}

function AuditTab({ audit }: { audit: Admin['audit'] }) {
  if (audit.length === 0) return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No audit events yet.</div>;
  return (
    <Card><CardContent className="pt-4">
      <ol className="relative border-l border-border ml-2 space-y-4">
        {audit.map((a, i) => (
          <li key={i} className="pl-4" data-testid={`row-audit-${i}`}>
            <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
            <p className="text-sm font-medium">{a.action.replace(/[_.]/g, ' ')}</p>
            <p className="text-xs text-muted-foreground">{format(new Date(a.createdAt), 'MMM d, yyyy h:mm a')}</p>
          </li>
        ))}
      </ol>
    </CardContent></Card>
  );
}
