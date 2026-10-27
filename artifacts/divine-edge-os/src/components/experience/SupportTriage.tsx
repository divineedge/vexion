import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThreadView } from './ThreadView';
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE, errorMessage, useExperienceAction,
  type ExperienceAdmin, type SupportThread, type ThreadPriority, type ThreadStatus,
} from '@/lib/experience';

const STATUSES = Object.keys(STATUS_LABEL) as ThreadStatus[];
const PRIORITIES: ThreadPriority[] = ['low', 'normal', 'high'];

export function SupportTriage({ admin, currentUserId }: { admin: ExperienceAdmin; currentUserId?: number }) {
  const { run, isPending } = useExperienceAction();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dupDraft, setDupDraft] = useState<Record<string, string>>({});

  const bizName = useMemo(() => new Map(admin.businesses.map(b => [b.id, b.name])), [admin.businesses]);
  const threads = admin.threads
    .filter(t => filter === 'all' || t.status !== 'resolved')
    .sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
  const selected = admin.threads.find(t => t.id === selectedId) ?? null;

  async function patch(t: SupportThread, changes: Partial<Pick<SupportThread, 'status' | 'priority' | 'assigneeId' | 'duplicateOf'>>) {
    try {
      await run('updateThread', {
        threadId: t.id, status: changes.status ?? t.status, priority: changes.priority ?? t.priority,
        assigneeId: 'assigneeId' in changes ? changes.assigneeId : t.assigneeId,
        duplicateOf: 'duplicateOf' in changes ? changes.duplicateOf : t.duplicateOf,
      });
      toast.success('Thread updated');
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-2">
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {(['open', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 text-xs font-medium ${filter === f ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid={`filter-threads-${f}`}>{f === 'open' ? 'Open' : 'All'}</button>
          ))}
        </div>
        <ul className="divide-y rounded-xl border bg-card max-h-[70vh] overflow-y-auto">
          {threads.length === 0 && <li className="p-6 text-sm text-muted-foreground">Inbox clear.</li>}
          {threads.map(t => (
            <li key={t.id}>
              <button onClick={() => setSelectedId(t.id)} data-testid={`row-admin-thread-${t.id}`}
                className={`w-full p-3 text-left hover:bg-muted/40 ${selectedId === t.id ? 'bg-primary/5 border-l-2 border-primary' : ''}`}>
                <div className="flex items-center gap-2">
                  {t.priority === 'high' && <span className="h-2 w-2 rounded-full bg-destructive" aria-label="High priority" />}
                  <span className="flex-1 truncate font-medium text-sm">{t.title}</span>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[t.status]}`}>{STATUS_LABEL[t.status]}</Badge>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {KIND_LABEL[t.kind]} · {bizName.get(t.tenantId) ?? `Business ${t.tenantId}`} · {format(new Date(t.updatedAt), 'MMM d')}
                  {t.duplicateOf ? ' · duplicate' : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div>
            <h3 className="text-lg font-semibold">{selected.title}</h3>
            <p className="text-xs text-muted-foreground">{bizName.get(selected.tenantId) ?? `Business ${selected.tenantId}`} · user #{selected.userId}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={selected.status} onValueChange={v => void patch(selected, { status: v as ThreadStatus })} disabled={isPending}>
              <SelectTrigger data-testid="select-thread-status"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selected.priority} onValueChange={v => void patch(selected, { priority: v as ThreadPriority })} disabled={isPending}>
              <SelectTrigger data-testid="select-thread-priority"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selected.assigneeId == null ? 'none' : String(selected.assigneeId)} onValueChange={v => void patch(selected, { assigneeId: v === 'none' ? null : Number(v) })} disabled={isPending}>
              <SelectTrigger data-testid="select-thread-assignee"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {admin.staffUsers.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Duplicate of thread ID" value={dupDraft[selected.id] ?? selected.duplicateOf ?? ''} onChange={e => setDupDraft(d => ({ ...d, [selected.id]: e.target.value }))} data-testid="input-duplicate-of" />
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => void patch(selected, { duplicateOf: (dupDraft[selected.id] ?? '').trim() || null })} data-testid="button-save-duplicate">Link</Button>
          </div>
          {selected.diagnostics != null && (
            <details className="rounded-md bg-muted/50 p-2 text-xs"><summary className="cursor-pointer">Diagnostics (shared with consent)</summary><pre className="mt-2 whitespace-pre-wrap font-mono">{JSON.stringify(selected.diagnostics, null, 2)}</pre></details>
          )}
          <ThreadView thread={selected} messages={admin.messages.filter(m => m.threadId === selected.id)} currentUserId={currentUserId} canInternal
            draft={drafts[selected.id] ?? ''} onDraft={v => setDrafts(d => ({ ...d, [selected.id]: v }))} />
        </div>
      ) : (
        <div className="grid place-items-center rounded-xl border border-dashed p-10 text-sm text-muted-foreground">Select a thread to triage.</div>
      )}
    </div>
  );
}
