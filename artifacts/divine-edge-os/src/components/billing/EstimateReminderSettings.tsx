import { useEffect, useRef, useState } from 'react';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import type { AutosaveStatus } from '@/lib/settingsAutosave';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { BellRing, Plus, Trash2, Mail, MessageSquare, Info, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export interface EstimateReminderRule {
  offsetDays: number;
  label: string;
  channels: string[];
  notifyAdmin: boolean;
  createTask: boolean;
}
export interface EstimateReminderConfig { enabled: boolean; rules: EstimateReminderRule[] }

const KEY = ['estimate-reminder-settings'] as const;
const URL = '/api/estimate-reminder-settings';

function ruleError(r: EstimateReminderRule, all: EstimateReminderRule[]): string | null {
  if (!Number.isInteger(r.offsetDays) || r.offsetDays < 1 || r.offsetDays > 365) return 'Days must be a whole number from 1 to 365.';
  if (all.filter(o => o.offsetDays === r.offsetDays).length > 1) return `Another rule already fires on day ${r.offsetDays}. Each rule needs a distinct day.`;
  if (r.channels.length === 0 && !r.notifyAdmin && !r.createTask) return 'Pick at least one channel or internal action.';
  return null;
}

export function EstimateReminderSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => customFetch<EstimateReminderConfig>(URL),
  });
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<EstimateReminderRule[]>([]);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      setEnabled(!!data.enabled);
      setRules((data.rules ?? []).map(r => ({ ...r, channels: r.channels ?? [], notifyAdmin: !!r.notifyAdmin, createTask: !!r.createTask })));
    }
  }, [data]);

  const errors = rules.map(r => ruleError(r, rules));
  const emptyEnabled = enabled && rules.length === 0;
  const hasErrors = errors.some(Boolean) || emptyEnabled;

  const buildPayload = (en: boolean, rs: EstimateReminderRule[]): EstimateReminderConfig => ({
    enabled: en,
    rules: [...rs].sort((x, y) => x.offsetDays - y.offsetDays).map(r => ({ ...r, label: r.label.trim() || `${r.offsetDays} days after sending` })),
  });

  const saveNow = async (body: EstimateReminderConfig) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const mySeq = ++seq.current;
    setStatus('saving');
    try {
      const res = await customFetch<EstimateReminderConfig>(URL, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      qc.setQueryData(KEY, res);
      if (mySeq === seq.current) { setStatus('saved'); setDirty(false); }
    } catch (e: any) {
      if (mySeq === seq.current) {
        setStatus('error');
        toast.error(e?.data?.error ?? e?.message ?? 'Could not save estimate reminders');
      }
    }
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  // Debounced autosave — only valid drafts are ever sent.
  useEffect(() => {
    if (!initialized.current || !dirty) return;
    if (timer.current) clearTimeout(timer.current);
    if (hasErrors) { setStatus('pending'); return; }
    setStatus('pending');
    const body = buildPayload(enabled, rules);
    timer.current = setTimeout(() => { saveRef.current(body); }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rules, dirty, hasErrors]);

  const update = (idx: number, patch: Partial<EstimateReminderRule>) => {
    setDirty(true);
    setRules(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const toggleChannel = (idx: number, ch: string, on: boolean) => {
    const cur = rules[idx].channels;
    update(idx, { channels: on ? [...cur.filter(c => c !== ch), ch] : cur.filter(c => c !== ch) });
  };
  const addRule = () => {
    setDirty(true);
    const used = new Set(rules.map(r => r.offsetDays));
    let next = Math.min(365, (rules.length ? Math.max(...rules.map(r => r.offsetDays).filter(Number.isFinite), 0) + 4 : 3));
    while (used.has(next) && next < 365) next++;
    setRules(prev => [...prev, { offsetDays: next, label: `${next} days after sending`, channels: ['email'], notifyAdmin: false, createTask: false }]);
  };

  if (isLoading) return <Skeleton className="h-56 w-full rounded-xl" />;
  if (isError) {
    return (
      <Card><CardContent className="p-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="w-4 h-4 text-destructive" /> Couldn't load estimate reminder settings.</div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Retry</Button>
      </CardContent></Card>
    );
  }

  return (
    <Card data-testid="card-estimate-reminders">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><BellRing className="w-4 h-4" /> Estimate Follow-up Reminders</CardTitle>
            <CardDescription>Nudge customers on sent estimates they haven't accepted or declined, and optionally alert staff.</CardDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={v => { setDirty(true); setEnabled(v); }} data-testid="switch-estimate-reminders" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Timing counts days after an estimate is sent. <strong className="text-foreground">Older sent estimates without a recorded send date start their timing from the day reminders are turned on</strong>, so nobody gets a burst of overdue reminders at activation. Reminders stop once an estimate is accepted, declined or expired.</p>
        </div>

        <div className={`space-y-2 ${enabled ? '' : 'opacity-60'}`}>
          {rules.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No reminder rules yet. Add one — for example 3 days by email, then 7 days with a follow-up task.
            </div>
          )}
          {rules.map((rule, idx) => (
            <div key={idx} className={`rounded-lg border p-3 bg-muted/20 ${errors[idx] ? 'border-destructive/50' : ''}`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-0.5">
                  <label className="text-xs text-muted-foreground">Days after sending</label>
                  <Input type="number" min={1} max={365} step={1} className="h-8 w-24 text-sm" value={Number.isNaN(rule.offsetDays) ? '' : rule.offsetDays}
                    onChange={e => update(idx, { offsetDays: e.target.value === '' ? NaN : Number(e.target.value) })} data-testid={`input-est-rule-days-${idx}`} />
                </div>
                <div className="flex-1 min-w-[160px] space-y-0.5">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input className="h-8 text-sm" placeholder="e.g. Gentle nudge" value={rule.label} onChange={e => update(idx, { label: e.target.value })} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-xs text-muted-foreground">Customer channels</label>
                  <div className="flex items-center gap-3 h-8">
                    {([['email', 'Email', Mail], ['sms', 'SMS', MessageSquare]] as const).map(([ch, text, Icon]) => (
                      <div key={ch} className="flex items-center gap-1.5">
                        <Checkbox id={`est-${idx}-${ch}`} checked={rule.channels.includes(ch)} onCheckedChange={v => toggleChannel(idx, ch, v === true)} />
                        <label htmlFor={`est-${idx}-${ch}`} className="text-sm cursor-pointer flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {text}</label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <label className="text-xs text-muted-foreground">Internal actions</label>
                  <div className="flex items-center gap-3 h-8">
                    <div className="flex items-center gap-1.5">
                      <Checkbox id={`est-${idx}-admin`} checked={rule.notifyAdmin} onCheckedChange={v => update(idx, { notifyAdmin: v === true })} />
                      <label htmlFor={`est-${idx}-admin`} className="text-sm cursor-pointer whitespace-nowrap">Alert admin</label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox id={`est-${idx}-task`} checked={rule.createTask} onCheckedChange={v => update(idx, { createTask: v === true })} />
                      <label htmlFor={`est-${idx}-task`} className="text-sm cursor-pointer whitespace-nowrap">Follow-up task</label>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" aria-label="Remove rule"
                  onClick={() => { setDirty(true); setRules(prev => prev.filter((_, i) => i !== idx)); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              {errors[idx] ? <p className="text-xs text-destructive mt-2">{errors[idx]}</p>
                : rule.channels.length === 0 && <p className="text-[11px] text-muted-foreground mt-2">Internal only — the customer won't be contacted.</p>}
            </div>
          ))}
        </div>

        {enabled && rules.length === 0 && <p className="text-xs text-destructive">Add at least one rule before enabling reminders.</p>}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={addRule} disabled={rules.length >= 10} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Rule</Button>
          {dirty && hasErrors ? (
            <span className="text-xs text-destructive flex items-center gap-1" data-testid="estimate-reminders-invalid">
              <AlertTriangle className="w-3.5 h-3.5" /> Not saved — fix the highlighted rule{errors.filter(Boolean).length > 1 ? 's' : ''} to save.
            </span>
          ) : (
            <AutosaveIndicator status={status} hasUnsaved={dirty} onRetry={() => saveNow(buildPayload(enabled, rules))} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
