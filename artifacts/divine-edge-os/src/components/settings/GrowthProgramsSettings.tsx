import { useEffect, useRef, useState } from 'react';
import { useSettingsAutosave, useAutosaveFields } from '@/hooks/use-settings-autosave';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAcquisitionSettings, useUpdateAcquisitionSettings, type AcquisitionSettings, type RewardType } from '@/lib/acquisition';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>{children}</div>;
}

export default function GrowthProgramsSettings() {
  const { data, isLoading, isError, refetch } = useAcquisitionSettings();
  const update = useUpdateAcquisitionSettings();
  const [s, setS] = useState<AcquisitionSettings | null>(null);
  const [empVal, setEmpVal] = useState('0');
  const [refVal, setRefVal] = useState('0');
  const initialized = useRef(false);
  // Baseline from the server once; refetches/mutation responses never reset local edits.
  useEffect(() => { if (data && !initialized.current) { initialized.current = true; setS(data); setEmpVal(String(data.employeeRewardValue ?? 0)); setRefVal(String(data.referralRewardValue ?? 0)); } }, [data]);
  const mutateAsyncRef = useRef(update.mutateAsync); mutateAsyncRef.current = update.mutateAsync;
  const autosave = useSettingsAutosave(patch => mutateAsyncRef.current(patch as Partial<AcquisitionSettings>));
  const ev = Number(empVal), rv = Number(refVal);
  const empInvalid = empVal.trim() === '' || !Number.isFinite(ev) || ev < 0 || (s?.employeeRewardType === 'percent' && ev > 100);
  const refInvalid = refVal.trim() === '' || !Number.isFinite(rv) || rv < 0 || (s?.referralRewardType === 'percent' && rv > 100);
  const fields: Record<string, unknown> = s ? Object.fromEntries(Object.entries({
    doorHangersEnabled: s.doorHangersEnabled, employeeRewardsEnabled: s.employeeRewardsEnabled, employeeRewardType: s.employeeRewardType,
    employeeRewardValue: empInvalid ? undefined : ev, customerReferralsEnabled: s.customerReferralsEnabled, referralRewardType: s.referralRewardType,
    referralRewardValue: refInvalid ? undefined : rv, quoteWidgetEnabled: s.quoteWidgetEnabled, trigger: 'first_paid_invoice',
  }).filter(([, v]) => v !== undefined)) : {};
  useAutosaveFields(fields, !!s, autosave.queue);

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !s) return <Card><CardContent className="p-6 text-sm space-y-2"><p className="text-destructive">Could not load growth program settings.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>;
  const set = (p: Partial<AcquisitionSettings>) => setS(cur => (cur ? { ...cur, ...p } : cur));

  const typeSel = (v: RewardType, on: (t: RewardType) => void, id: string) => (
    <Select value={v} onValueChange={x => on(x as RewardType)}><SelectTrigger className="w-40" data-testid={id}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="fixed">Fixed amount ($)</SelectItem><SelectItem value="percent">Percent of invoice (%)</SelectItem></SelectContent></Select>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Growth Programs</CardTitle>
        <CardDescription>Door hangers, employee acquisition bonuses, and customer referral credits. All programs start disabled at $0 until you enable them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 divide-y">
        <Row label="Door hanger tracking" hint="Staff can record houses around jobs."><Switch data-testid="switch-doorhangers" checked={s.doorHangersEnabled} onCheckedChange={v => set({ doorHangersEnabled: v })} /></Row>
        <div className="pt-2">
          <Row label="Employee acquisition bonus" hint="Paid through payroll as a separate line, not part of P4P."><Switch data-testid="switch-employee-rewards" checked={s.employeeRewardsEnabled} onCheckedChange={v => set({ employeeRewardsEnabled: v })} /></Row>
          <div className="flex gap-3 items-center">{typeSel(s.employeeRewardType, t => set({ employeeRewardType: t }), 'select-employee-reward-type')}<Input data-testid="input-employee-reward-value" className="w-32" type="number" min={0} step="0.01" value={empVal} onChange={e => setEmpVal(e.target.value)} /><span className="text-sm text-muted-foreground">{s.employeeRewardType === 'percent' ? '% of first paid invoice' : 'per new customer'}</span></div>
        </div>
        <div className="pt-2">
          <Row label="Customer referral credit" hint="Credit for the referring customer."><Switch data-testid="switch-referral-rewards" checked={s.customerReferralsEnabled} onCheckedChange={v => set({ customerReferralsEnabled: v })} /></Row>
          <div className="flex gap-3 items-center">{typeSel(s.referralRewardType, t => set({ referralRewardType: t }), 'select-referral-reward-type')}<Input data-testid="input-referral-reward-value" className="w-32" type="number" min={0} step="0.01" value={refVal} onChange={e => setRefVal(e.target.value)} /><span className="text-sm text-muted-foreground">{s.referralRewardType === 'percent' ? '% of first paid invoice' : 'per referral'}</span></div>
        </div>
        <Row label="Reward trigger" hint="Rewards are earned once, when the new customer's first invoice is paid.">
          <Select value="first_paid_invoice" onValueChange={() => set({ trigger: 'first_paid_invoice' })}><SelectTrigger className="w-48" data-testid="select-reward-trigger"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="first_paid_invoice">First paid invoice</SelectItem></SelectContent></Select>
        </Row>
        <Row label="Website quote widget" hint="Allow the public quote widget for this company."><Switch data-testid="switch-quote-widget" checked={s.quoteWidgetEnabled} onCheckedChange={v => set({ quoteWidgetEnabled: v })} /></Row>
        <div className="pt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-destructive">{empInvalid && <p>Employee reward must be 0 or more{s.employeeRewardType === 'percent' ? ' and at most 100%' : ''} — not saved yet.</p>}{refInvalid && <p>Referral credit must be 0 or more{s.referralRewardType === 'percent' ? ' and at most 100%' : ''} — not saved yet.</p>}</div>
          <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />
        </div>
      </CardContent>
    </Card>
  );
}
