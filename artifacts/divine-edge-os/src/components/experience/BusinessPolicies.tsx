import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { errorMessage, useExperienceAction, type AdminBusiness, type BusinessPolicy } from '@/lib/experience';
import { policyTrialInput,policyTrialUntil } from '@/lib/experience-policy';

function PolicyRow({ b }: { b: AdminBusiness }) {
  const { run, isPending } = useExperienceAction();
  // Local draft initialised once; background refetches don't clobber edits.
  const [p, setP] = useState<BusinessPolicy>(() => ({ ...b.policy }));
  const draftKey=(v:BusinessPolicy)=>JSON.stringify([v.subscriptionRequired,policyTrialInput(v.trialUntil),Number(v.graceDays),v.enforceLimits]);
  const dirty = draftKey(p) !== draftKey(b.policy);

  async function save() {
    try {
      const graceDays=Number(p.graceDays);
      if(!Number.isInteger(graceDays)||graceDays<0||graceDays>60)throw new Error('Grace period must be 0 to 60 whole days.');
      await run('saveCompanyPolicy', { tenantId: b.id, subscriptionRequired: p.subscriptionRequired, trialUntil: policyTrialUntil(p.trialUntil), graceDays, enforceLimits: p.enforceLimits });
      toast.success(`${b.name} policy saved`);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  const over = (n: number, max: number | null) => max != null && n > max;
  return (
    <tr className="border-t align-middle" data-testid={`row-business-${b.id}`}>
      <td className="p-3">
        <p className="font-medium">{b.name}</p>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">{b.subscriptionStatus ?? 'no subscription'}{b.planId != null ? ` · plan ${b.planId}` : ''}</p>
      </td>
      <td className={`p-3 tabular-nums text-sm ${over(b.userCount, b.maxUsers) ? 'text-destructive font-semibold' : ''}`}>{b.userCount}{b.maxUsers != null ? ` / ${b.maxUsers}` : ''}</td>
      <td className={`p-3 tabular-nums text-sm ${over(b.propertyCount, b.maxProperties) ? 'text-destructive font-semibold' : ''}`}>{b.propertyCount}{b.maxProperties != null ? ` / ${b.maxProperties}` : ''}</td>
      <td className="p-3"><Switch checked={p.subscriptionRequired} onCheckedChange={v => setP(s => ({ ...s, subscriptionRequired: v }))} data-testid={`switch-sub-required-${b.id}`} /></td>
      <td className="p-3"><Input type="date" className="h-8 w-36" title="Trial runs through this date, in UTC" value={policyTrialInput(p.trialUntil)} onChange={e => setP(s => ({ ...s, trialUntil: e.target.value || null }))} data-testid={`input-trial-${b.id}`} /></td>
      <td className="p-3"><Input type="number" min={0} max={60} step={1} className="h-8 w-20" value={p.graceDays} onChange={e => setP(s => ({ ...s, graceDays: Number(e.target.value) }))} data-testid={`input-grace-${b.id}`} /></td>
      <td className="p-3"><Switch checked={p.enforceLimits} onCheckedChange={v => setP(s => ({ ...s, enforceLimits: v }))} data-testid={`switch-enforce-${b.id}`} /></td>
      <td className="p-3"><Button size="sm" disabled={!dirty || isPending} onClick={() => void save()} data-testid={`button-save-policy-${b.id}`}>Save</Button></td>
    </tr>
  );
}

export function BusinessPolicies({ businesses }: { businesses: AdminBusiness[] }) {
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Every policy is opt-in per business. Saving never deletes records or starts charges. After trial and grace periods, these rules restrict adding users or properties—not historical access or completion of existing work.
      </p>
      <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left">
          <thead className="bg-muted/50 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr><th className="p-3">Business</th><th className="p-3">Users</th><th className="p-3">Properties</th><th className="p-3">Require sub</th><th className="p-3">Trial through (UTC)</th><th className="p-3">Grace days</th><th className="p-3">Enforce limits</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {businesses.map(b => <PolicyRow key={b.id} b={b} />)}
            {businesses.length === 0 && <tr><td colSpan={8} className="p-6 text-sm text-muted-foreground">No businesses.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
