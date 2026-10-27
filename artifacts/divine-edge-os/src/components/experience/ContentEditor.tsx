import { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, useExperienceAction, type HelpContent } from '@/lib/experience';

type Draft = { id?: string; kind: 'help' | 'release'; title: string; body: string; published: boolean };
const EMPTY: Draft = { kind: 'help', title: '', body: '', published: false };

export function ContentEditor({ content }: { content: HelpContent[] }) {
  const { run, isPending } = useExperienceAction();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  async function save() {
    try {
      await run('saveContent', { ...(draft.id ? { id: draft.id } : {}), kind: draft.kind, title: draft.title.trim(), body: draft.body, published: draft.published });
      toast.success(draft.published && draft.kind === 'release' ? 'Published. Staff will be notified.' : 'Saved');
      setDraft(EMPTY);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <ul className="divide-y rounded-xl border bg-card self-start">
        {content.length === 0 && <li className="p-6 text-sm text-muted-foreground">No guides or release notes yet.</li>}
        {content.map(c => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40" onClick={() => setDraft({ id: c.id, kind: c.kind, title: c.title, body: c.body, published: c.published })} data-testid={`row-content-${c.id}`}>
              <span className="font-mono text-[10px] uppercase w-14 text-muted-foreground">{c.kind}</span>
              <span className="flex-1 truncate text-sm font-medium">{c.title}</span>
              <Badge variant="outline" className={c.published ? 'bg-teal-50 text-teal-800' : ''}>{c.published ? 'Live' : 'Draft'}</Badge>
              <span className="text-xs text-muted-foreground">{format(new Date(c.updatedAt), 'MMM d')}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{draft.id ? 'Edit entry' : 'New entry'}</h3>
          {draft.id && <Button variant="ghost" size="sm" onClick={() => setDraft(EMPTY)} data-testid="button-new-content">New</Button>}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {(['help', 'release'] as const).map(k => (
            <button key={k} onClick={() => setDraft(d => ({ ...d, kind: k }))} className={`rounded-md px-3 py-1 text-xs font-medium ${draft.kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid={`button-content-kind-${k}`}>{k === 'help' ? 'Guide' : 'Release note'}</button>
          ))}
        </div>
        <Input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Title" data-testid="input-content-title" />
        <Textarea rows={8} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="Plain text body" data-testid="input-content-body" />
        <label className="flex items-center gap-2 text-sm"><Switch checked={draft.published} onCheckedChange={v => setDraft(d => ({ ...d, published: v }))} data-testid="switch-content-published" /> Published</label>
        <Button onClick={() => void save()} disabled={isPending || !draft.title.trim() || !draft.body.trim()} data-testid="button-save-content">{isPending ? 'Saving...' : 'Save'}</Button>
      </div>
    </div>
  );
}
