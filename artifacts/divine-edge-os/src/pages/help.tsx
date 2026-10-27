import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { BookOpen, LifeBuoy, Megaphone, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { ImagePicker, type UploadedImage } from '@/components/experience/ImagePicker';
import { ThreadView } from '@/components/experience/ThreadView';
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE, errorMessage, useExperienceAction, useExperienceHub, type ThreadKind,
} from '@/lib/experience';

function referrerPath(): string | undefined {
  const raw = new URLSearchParams(window.location.search).get('from');
  // Path only, never a full URL or query.
  if (raw && /^\/[A-Za-z0-9/_-]*$/.test(raw)) return raw.slice(0, 120);
  return undefined;
}

export default function HelpPage() {
  const { user, isSuperAdmin } = useAuth();
  const { hub, isLoading, isError, refetch } = useExperienceHub();
  const { run, isPending } = useExperienceAction();

  const [kind, setKind] = useState<ThreadKind>('problem');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<UploadedImage[]>([]);
  const [consent, setConsent] = useState(false);
  const [fromPage] = useState(referrerPath);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'help' | 'release'>('help');

  const threads = hub?.threads ?? [];
  const messagesByThread = useMemo(() => {
    const m: Record<string, NonNullable<typeof hub>['messages']> = {};
    for (const msg of hub?.messages ?? []) (m[msg.threadId] ??= []).push(msg);
    return m;
  }, [hub]);
  const content = (hub?.content ?? []).filter(c => c.published && c.kind === tab);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    try {
      await run('createThread', {
        kind, title: title.trim(), body: body.trim(),
        ...(files.length ? { attachments: files.map(f => f.id) } : {}),
        diagnosticsConsent: consent,
        ...(consent && fromPage ? { page: fromPage } : {}),
        ...(consent ? { clientVersion: 'web' } : {}),
      });
      setTitle(''); setBody(''); setFiles([]); setConsent(false);
      toast.success('Sent to the Divine Edge team');
    } catch (err) { toast.error(errorMessage(err, 'Not sent. Your draft is still here.')); }
  }

  return (
    <div className="min-w-0 max-w-full space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Help desk</p>
          <h1 className="text-3xl font-bold tracking-tight">Help &amp; Feedback</h1>
          <p className="mt-1 max-w-xl text-muted-foreground">
            Report a software problem, suggest an idea, or ask how something works. This goes to the people who build Divine Edge, not your customers.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/account-security" className="text-sm font-medium text-primary hover:underline" data-testid="link-security-from-help">Account security</Link>
          {isSuperAdmin && <Link href="/software-support" className="text-sm font-medium text-primary hover:underline" data-testid="link-software-support">Support inbox</Link>}
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={e => void submit(e)} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm lg:sticky lg:top-4 self-start">
          <div className="flex items-center gap-2 font-semibold"><Send className="h-4 w-4 text-primary" /> New request</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {(['problem', 'feature', 'help'] as ThreadKind[]).map(k => (
              <button key={k} type="button" onClick={() => setKind(k)} data-testid={`button-kind-${k}`}
                className={`rounded-md py-1.5 text-sm font-medium transition ${kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short summary" maxLength={160} data-testid="input-thread-title" required />
          <Textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder={kind === 'problem' ? 'What did you expect, and what happened instead?' : kind === 'feature' ? 'What would make your day easier?' : 'What are you trying to do?'} data-testid="input-thread-body" required />
          <ImagePicker uploadUrl="/api/experience/uploads" value={files} onChange={setFiles} testId="thread-upload" label="Add screenshots" />
          <label className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Switch checked={consent} onCheckedChange={setConsent} data-testid="switch-diagnostics" />
            <span>Include basic diagnostics (the page you came from{fromPage ? `: ${fromPage}` : ''} and app version). No customer data is attached.</span>
          </label>
          <Button type="submit" className="w-full" disabled={isPending || !title.trim() || !body.trim()} data-testid="button-submit-thread">
            {isPending ? 'Sending...' : 'Send to support'}
          </Button>
          <p className="text-[11px] text-muted-foreground">Customer service feedback about your business lives in <Link href="/reviews" className="underline">Reviews</Link>.</p>
        </form>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><LifeBuoy className="h-4 w-4 text-primary" /> Your requests</h2>
            <Button variant="ghost" size="sm" onClick={() => void refetch()} data-testid="button-refresh-threads"><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              Could not load help. <button className="underline" onClick={() => void refetch()} data-testid="button-retry-help">Retry</button>
            </div>
          ) : threads.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing open. When you send something, you will see its status and our replies here.
            </div>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {threads.map(t => (
                <li key={t.id} data-testid={`row-thread-${t.id}`}>
                  <button className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40" onClick={() => setOpenId(openId === t.id ? null : t.id)} data-testid={`button-open-thread-${t.id}`}>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground w-16 shrink-0">{KIND_LABEL[t.kind]}</span>
                    <span className="flex-1 truncate font-medium">{t.title}</span>
                    <Badge variant="outline" className={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                    <span className="hidden sm:block text-xs text-muted-foreground">{format(new Date(t.updatedAt), 'MMM d')}</span>
                  </button>
                  {openId === t.id && (
                    <div className="border-t bg-muted/20 p-4">
                      <ThreadView thread={t} messages={(messagesByThread[t.id] ?? []).filter(m => !m.internal)} currentUserId={user?.id}
                        draft={drafts[t.id] ?? ''} onDraft={v => setDrafts(d => ({ ...d, [t.id]: v }))} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="pt-6">
            <div className="mb-3 flex items-center gap-4 border-b">
              {(['help', 'release'] as const).map(k => (
                <button key={k} onClick={() => setTab(k)} data-testid={`tab-content-${k}`}
                  className={`-mb-px flex items-center gap-2 border-b-2 pb-2 text-sm font-medium ${tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
                  {k === 'help' ? <BookOpen className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
                  {k === 'help' ? 'Guides' : 'Release notes'}
                </button>
              ))}
            </div>
            {content.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing published yet.</p>
            ) : (
              <div className="space-y-3">
                {content.map(c => (
                  <article key={c.id} className="rounded-lg border bg-card p-4" data-testid={`content-${c.id}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{c.title}</h3>
                      <time className="font-mono text-[10px] text-muted-foreground">{format(new Date(c.updatedAt), 'MMM d, yyyy')}</time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
