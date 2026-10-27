import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { downloadBlob, errorMessage, useExperienceAction, useExperienceHub } from '@/lib/experience';

export default function GettingStartedPage() {
  const { isOwner } = useAuth();
  const { hub, isLoading, isError, refetch } = useExperienceHub();
  const { run, isPending } = useExperienceAction();
  const [steps, setSteps] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const hydrated = useRef(false);
  const [exporting, setExporting] = useState(false);

  // Hydrate once; refetches never overwrite unsaved manual checks.
  useEffect(() => {
    if (hub && (!hydrated.current || !dirty)) {
      hydrated.current = true;
      setSteps(hub.onboarding.completedSteps);
    }
  }, [hub, dirty]);

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-64" />{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>;
  if (isError || !hub) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">Could not load setup. <button className="underline" onClick={() => void refetch()} data-testid="button-retry-onboarding">Retry</button></div>
  );
  if (!hub.isManager) return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Owners and managers only</h1>
      <p className="mt-1 text-sm text-muted-foreground">Business setup and health checks are managed by your company owner or office manager.</p>
      <Link href="/help" className="mt-4 inline-block text-sm text-primary underline">Go to Help &amp; Feedback</Link>
    </div>
  );

  const checks = hub.onboarding.checks;
  const done = checks.filter(c => c.complete || steps.includes(c.key)).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
  const alerts = hub.alerts.filter(a => !a.resolved);

  async function save() {
    try { await run('saveOnboarding', { completedSteps: steps }); setDirty(false); toast.success('Progress saved'); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  async function runChecks() {
    try { await run('runChecks', {}); toast.success('Health checks finished'); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  async function resolve(id: string) {
    try { await run('resolveAlert', { id }); toast.success('Alert resolved'); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  async function exportData() {
    setExporting(true);
    try { await downloadBlob('/api/experience/export', `business-export-${format(new Date(), 'yyyy-MM-dd')}.json`); }
    catch (e) { toast.error(errorMessage(e, 'Export failed. Try again.')); }
    finally { setExporting(false); }
  }

  return (
    <div className="space-y-10">
      <header className="grid gap-6 border-b pb-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Business setup</p>
          <h1 className="text-3xl font-bold tracking-tight">Getting started</h1>
          <p className="mt-1 max-w-xl text-muted-foreground">Automatic checks look at your real records. You can also tick steps you have handled outside the app.</p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-6xl font-bold tabular-nums tracking-tighter" data-testid="text-onboarding-pct">{pct}</span>
          <span className="text-muted-foreground">% ready</span>
        </div>
      </header>

      <section className="space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-transform origin-left" style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <ul className="divide-y rounded-xl border bg-card">
          {checks.map(c => {
            const manual = steps.includes(c.key);
            return (
              <li key={c.key} className="flex items-center gap-4 p-4" data-testid={`row-check-${c.key}`}>
                {c.complete ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Circle className="h-5 w-5 text-muted-foreground/40" />}
                <div className="flex-1">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.complete ? 'Detected in your records' : manual ? 'Marked done manually' : 'Not detected yet'}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={manual} onCheckedChange={v => { setDirty(true); setSteps(s => v ? [...s, c.key] : s.filter(x => x !== c.key)); }} data-testid={`checkbox-step-${c.key}`} />
                  Done
                </label>
                {c.href?.startsWith('/') && <Link href={c.href} className="text-primary" aria-label={`Open ${c.label}`} data-testid={`link-check-${c.key}`}><ArrowRight className="h-4 w-4" /></Link>}
              </li>
            );
          })}
          {checks.length === 0 && <li className="p-6 text-sm text-muted-foreground">No checklist items available.</li>}
        </ul>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={!dirty || isPending} data-testid="button-save-onboarding">{isPending ? 'Saving...' : 'Save progress'}</Button>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Business health</h2>
            <Button variant="outline" size="sm" onClick={() => void runChecks()} disabled={isPending} data-testid="button-run-checks"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Run checks</Button>
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No open alerts recorded. Run checks to refresh; a check that cannot verify something reports it as an alert rather than healthy.</div>
          ) : alerts.map(a => (
            <div key={a.id} className={`flex items-start gap-3 rounded-lg border p-4 ${a.severity === 'critical' || a.severity === 'high' ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`} data-testid={`alert-${a.id}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
              <div className="flex-1 text-sm">
                <p className="font-medium">{a.message}</p>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">{a.source} · {a.severity} · {format(new Date(a.updatedAt), 'MMM d, h:mm a')}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void resolve(a.id)} disabled={isPending} data-testid={`button-resolve-${a.id}`}>Resolve</Button>
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-xl border bg-card p-5 self-start">
          <h2 className="font-semibold">Your data</h2>
          <p className="text-sm text-muted-foreground">Download a JSON copy of this company's business records. Passwords, credentials and security tokens are excluded. This is not a full backup: photos, documents and attachments are not included.</p>
          <Button variant="outline" onClick={() => void exportData()} disabled={!isOwner || exporting} data-testid="button-export">
            <Download className="mr-1.5 h-4 w-4" /> {exporting ? 'Preparing...' : 'Export business data'}
          </Button>
          {!isOwner && <p className="text-xs text-muted-foreground">Only the company owner can export.</p>}
        </div>
      </section>
    </div>
  );
}
