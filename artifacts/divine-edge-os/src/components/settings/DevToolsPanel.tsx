import React, { useState } from 'react';
import {
  useGetDevToolsEnvironment,
  useSimulateGenerateInvoices, useSimulateSendReminders,
  useListCompletableJobs, useSimulateCompleteJobAutoInvoice,
  useSimulateRunRecurringScheduler,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, FlaskConical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type LogEntry = { at: string; label: string; ok: boolean; detail: string };

function useSimLog() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const push = (label: string, ok: boolean, detail: string) => {
    setLog(prev => [{ at: new Date().toISOString(), label, ok, detail }, ...prev].slice(0, 30));
  };
  return { log, push };
}

function LogPanel({ log }: { log: LogEntry[] }) {
  if (log.length === 0) return null;
  return (
    <div className="rounded-lg border divide-y max-h-64 overflow-y-auto mt-3">
      {log.map((entry, i) => (
        <div key={i} className="px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{entry.label}</span>
            <Badge variant={entry.ok ? 'secondary' : 'destructive'} className="text-xs">{entry.ok ? 'ok' : 'error'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{entry.detail}</p>
        </div>
      ))}
    </div>
  );
}

export default function DevToolsPanel() {
  const { data: env } = useGetDevToolsEnvironment();
  const isProduction = env?.isProduction ?? false;
  const [confirmProd, setConfirmProd] = useState(false);

  return (
    <div className="space-y-6">
      <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Dev/Test Panel</CardTitle>
          <CardDescription>
            Manually run the automations that normally fire on a schedule. Dry-run first to see what would happen before executing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isProduction && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <div>
                <p className="font-medium">This is a production environment.</p>
                <p className="text-xs">Executing (not dry-running) any action below affects live customer data.</p>
              </div>
            </div>
          )}
          {isProduction && (
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" className="accent-primary" checked={confirmProd} onChange={e => setConfirmProd(e.target.checked)} />
              I understand this will affect live production data
            </label>
          )}
        </CardContent>
      </Card>

      <GenerateInvoicesCard isProduction={isProduction} confirmProd={confirmProd} />
      <SendRemindersCard isProduction={isProduction} confirmProd={confirmProd} />
      <CompleteJobCard isProduction={isProduction} confirmProd={confirmProd} />
      <RecurringSchedulerCard isProduction={isProduction} confirmProd={confirmProd} />
    </div>
  );
}

function GenerateInvoicesCard({ isProduction, confirmProd }: { isProduction: boolean; confirmProd: boolean }) {
  const { log, push } = useSimLog();
  const sim = useSimulateGenerateInvoices();

  const run = (dryRun: boolean) => {
    sim.mutate({ data: { dryRun, confirmProductionRun: isProduction ? confirmProd : undefined } }, {
      onSuccess: (result) => {
        if (result.dryRun) push('Generate Invoices — dry run', true, `${result.due?.length ?? 0} template(s) due`);
        else push('Generate Invoices — executed', true, `${(result.results ?? []).length} template(s) processed`);
      },
      onError: (err: any) => {
        const msg = err?.error ?? 'Failed';
        push('Generate Invoices', false, msg);
        toast.error(msg);
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Generate Invoices Now</CardTitle>
        <CardDescription>Runs the recurring billing scheduler immediately for this tenant.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={sim.isPending}>
            {sim.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />} Dry Run
          </Button>
          <Button size="sm" onClick={() => run(false)} disabled={sim.isPending || (isProduction && !confirmProd)}>Execute</Button>
        </div>
        <LogPanel log={log} />
      </CardContent>
    </Card>
  );
}

function SendRemindersCard({ isProduction, confirmProd }: { isProduction: boolean; confirmProd: boolean }) {
  const { log, push } = useSimLog();
  const sim = useSimulateSendReminders();

  const run = (dryRun: boolean) => {
    sim.mutate({ data: { dryRun, confirmProductionRun: isProduction ? confirmProd : undefined } }, {
      onSuccess: (result) => {
        if (result.dryRun) push('Send 7-Day Reminders — dry run', true, `${(result.jobs ?? []).length} job(s) in the next 7 days`);
        else push('Send 7-Day Reminders — executed', true, `${(result.results ?? []).length} reminder(s) processed`);
      },
      onError: (err: any) => { const msg = err?.error ?? 'Failed'; push('Send 7-Day Reminders', false, msg); toast.error(msg); },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Send 7-Day Reminders</CardTitle>
        <CardDescription>Sends reminder texts/emails for jobs scheduled in the next 7 days that haven't been reminded yet.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={sim.isPending}>Dry Run</Button>
          <Button size="sm" onClick={() => run(false)} disabled={sim.isPending || (isProduction && !confirmProd)}>Execute</Button>
        </div>
        <LogPanel log={log} />
      </CardContent>
    </Card>
  );
}

function CompleteJobCard({ isProduction, confirmProd }: { isProduction: boolean; confirmProd: boolean }) {
  const { log, push } = useSimLog();
  const { data: jobs } = useListCompletableJobs();
  const [jobId, setJobId] = useState<string>('');
  const sim = useSimulateCompleteJobAutoInvoice();

  const run = (dryRun: boolean) => {
    if (!jobId) { toast.error('Select a job first'); return; }
    sim.mutate({ data: { jobId: parseInt(jobId, 10), dryRun, confirmProductionRun: isProduction ? confirmProd : undefined } }, {
      onSuccess: (result) => {
        if (result.dryRun) push('Trigger Job Completion Auto-Invoice — dry run', true, `Would auto-invoice: ${result.wouldAutoInvoice ? 'yes' : 'no'} ($${result.estimatedAmount ?? 0})`);
        else push('Trigger Job Completion Auto-Invoice — executed', true, result.invoiceGenerated ? `Invoice #${result.invoiceId} created` : 'Job completed, no invoice generated');
      },
      onError: (err: any) => { const msg = err?.error ?? 'Failed'; push('Trigger Job Completion Auto-Invoice', false, msg); toast.error(msg); },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Trigger Job Completion Auto-Invoice</CardTitle>
        <CardDescription>Complete a specific in-progress job and see whether it auto-generates an invoice.</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={jobId} onValueChange={setJobId}>
          <SelectTrigger className="mb-3"><SelectValue placeholder="Select a job..." /></SelectTrigger>
          <SelectContent>
            {(jobs ?? []).map(j => (
              <SelectItem key={j.jobId} value={String(j.jobId)}>{j.title} — {j.customerName}{j.wouldAutoInvoice ? ' (auto-invoice on)' : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={sim.isPending}>Dry Run</Button>
          <Button size="sm" onClick={() => run(false)} disabled={sim.isPending || (isProduction && !confirmProd)}>Execute</Button>
        </div>
        <LogPanel log={log} />
      </CardContent>
    </Card>
  );
}

function RecurringSchedulerCard({ isProduction, confirmProd }: { isProduction: boolean; confirmProd: boolean }) {
  const { log, push } = useSimLog();
  const sim = useSimulateRunRecurringScheduler();

  const run = (dryRun: boolean) => {
    sim.mutate({ data: { dryRun, confirmProductionRun: isProduction ? confirmProd : undefined } }, {
      onSuccess: (result) => {
        if (result.dryRun) push('Run Recurring Job Scheduler — dry run', true, `${(result.series ?? []).length} recurring series checked`);
        else push('Run Recurring Job Scheduler — executed', true, `${(result.results ?? []).filter((r: any) => r.generated).length} new job(s) generated`);
      },
      onError: (err: any) => { const msg = err?.error ?? 'Failed'; push('Run Recurring Job Scheduler', false, msg); toast.error(msg); },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Run Recurring Job Scheduler</CardTitle>
        <CardDescription>Generates the next occurrence for any recurring job series that is due.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={sim.isPending}>Dry Run</Button>
          <Button size="sm" onClick={() => run(false)} disabled={sim.isPending || (isProduction && !confirmProd)}>Execute</Button>
        </div>
        <LogPanel log={log} />
      </CardContent>
    </Card>
  );
}
