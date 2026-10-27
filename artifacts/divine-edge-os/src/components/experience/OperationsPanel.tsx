import { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, useExperienceAction, type ExperienceAdmin } from '@/lib/experience';

export function OperationsPanel({ admin }: { admin: ExperienceAdmin }) {
  const { run, isPending } = useExperienceAction();
  const [env, setEnv] = useState<'development' | 'staging'>('staging');
  const [evidence, setEvidence] = useState('');
  const [passed, setPassed] = useState(false);
  const biz = new Map(admin.businesses.map(b => [b.id, b.name]));
  const open = admin.alerts.filter(a => !a.resolved);

  async function act(action: 'runChecks' | 'resolveAlert' | 'recordRecoveryDrill', payload: Record<string, unknown>, ok: string) {
    try { await run(action, payload); toast.success(ok); return true; } catch (e) { toast.error(errorMessage(e)); return false; }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Operations alerts <span className="text-muted-foreground">({open.length})</span></h3>
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => void act('runChecks', {}, 'Checks finished')} data-testid="button-admin-run-checks"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Run all checks</Button>
        </div>
        {open.length === 0 && <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No open alerts.</div>}
        {open.map(a => (
          <div key={a.id} className="flex items-start gap-3 rounded-lg border bg-card p-3" data-testid={`admin-alert-${a.id}`}>
            <AlertTriangle className={`mt-0.5 h-4 w-4 ${a.severity === 'critical' || a.severity === 'high' ? 'text-destructive' : 'text-amber-600'}`} />
            <div className="flex-1 text-sm">
              <p>{a.message}</p>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">{a.tenantId == null ? 'Platform' : biz.get(a.tenantId) ?? `Business ${a.tenantId}`} · {a.source} · {format(new Date(a.updatedAt), 'MMM d, h:mm a')}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => void act('resolveAlert', { id: a.id }, 'Resolved')} data-testid={`button-admin-resolve-${a.id}`}>Resolve</Button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Recovery drill evidence</h3>
        <p className="text-xs text-muted-foreground">Record what you actually did. Entries are your evidence, not an automatic restore claim.</p>
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
            {(['staging', 'development'] as const).map(e => (
              <button key={e} onClick={() => setEnv(e)} className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${env === e ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid={`button-env-${e}`}>{e}</button>
            ))}
          </div>
          <Textarea rows={3} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Backup used, steps taken, rows verified, time to restore" data-testid="input-drill-evidence" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Switch checked={passed} onCheckedChange={setPassed} data-testid="switch-drill-passed" /> Passed</label>
            <Button size="sm" className="ml-auto" disabled={isPending || !evidence.trim()} data-testid="button-record-drill"
              onClick={() => void act('recordRecoveryDrill', { environment: env, evidence: evidence.trim(), passed }, 'Drill recorded').then(ok => { if (ok) { setEvidence(''); setPassed(false); } })}>
              Record drill
            </Button>
          </div>
        </div>
        <ul className="space-y-2">
          {admin.recoveryDrills.map(d => (
            <li key={d.id} className="flex gap-3 rounded-lg border bg-card p-3 text-sm" data-testid={`drill-${d.id}`}>
              {d.passed ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
              <div className="flex-1"><p className="whitespace-pre-wrap">{d.evidence}</p><p className="font-mono text-[10px] uppercase text-muted-foreground">{d.environment} · {format(new Date(d.createdAt), 'MMM d, yyyy')}</p></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
