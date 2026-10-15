/** Staff: build website quote / hiring forms and review submissions. /website-forms?kind=quote|hiring */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Lock, AlertTriangle, Save, Send, RotateCcw, Calculator, UserPlus, Copy, ExternalLink } from 'lucide-react';
import { Link } from 'wouter';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useHrMeta } from '@/components/hr/hrApi';
import { loadWebsiteForm, saveWebsiteForm, loadPublicWebsiteForm, type FlowDefinition } from '@/lib/websiteIntake';
import FlowBuilder from '@/components/website-intake/FlowBuilder';
import FlowRenderer from '@/components/website-intake/FlowRenderer';
import SubmissionInbox from '@/components/website-intake/SubmissionInbox';

type Kind = 'quote' | 'hiring';
const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : f);

export default function WebsiteFormsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const kind: Kind = new URLSearchParams(search).get('kind') === 'hiring' ? 'hiring' : 'quote';
  const { canManageOffice: office, can } = useAuth();
  const canManageOffice = office && can('pages.billing') && can('financials.jobPrices') && can('customerInfo.email') && can('customerInfo.phone');
  const hr = useHrMeta();
  const hiringOk = !!(hr.data?.hasHrAccess || hr.data?.isOwner);
  const allowed = kind === 'quote' ? canManageOffice : hiringOk;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Growth</p>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Globe className="w-6 h-6 text-primary" />Website Forms</h1>
          <p className="text-sm text-muted-foreground">Design what visitors are asked, then review every submission before anything enters your records.</p>
        </div>
        <div className="inline-flex rounded-lg border p-1 bg-muted/40">
          {canManageOffice && <button onClick={() => setLocation('/website-forms?kind=quote')} data-testid="button-kind-quote"
            className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 ${kind === 'quote' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}><Calculator className="w-4 h-4" />Quick quote</button>}
          {hiringOk && <button onClick={() => setLocation('/website-forms?kind=hiring')} data-testid="button-kind-hiring"
            className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 ${kind === 'hiring' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}><UserPlus className="w-4 h-4" />Hiring</button>}
        </div>
      </header>
      {kind === 'hiring' && hr.isLoading ? <div className="h-40 rounded-xl bg-muted animate-pulse" />
        : !allowed ? (
          <div className="text-center py-20 space-y-3" data-testid="text-no-access">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">{kind === 'hiring' ? 'Hiring forms are private' : 'Office access required'}</h2>
            <p className="text-sm text-muted-foreground">{kind === 'hiring' ? 'Only the owner and designated HR staff can edit the hiring form or read applications.' : 'Ask an owner or manager for access.'}</p>
          </div>
        ) : <Workspace key={kind} kind={kind} />}
    </div>
  );
}

function Workspace({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['website-form', kind], queryFn: () => loadWebsiteForm(kind) });
  const [draft, setDraft] = useState<FlowDefinition | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const init = useRef(false);
  useEffect(() => { if (q.data && !init.current) { init.current = true; setDraft(q.data.definition); setRevision(q.data.revision); } }, [q.data]);
  const dirty = useMemo(() => !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(q.data.definition), [draft, q.data]);

  const save = async (publish: boolean) => {
    if (!draft) return;
    setSaving(publish ? 'publish' : 'draft'); setErr(null);
    try {
      const r = await saveWebsiteForm(kind, draft, revision, publish);
      qc.setQueryData(['website-form', kind], r);
      setDraft(r.definition); setRevision(r.revision); setConflict(false);
      toast.success(publish ? 'Published. Visitors now see this version.' : 'Draft saved');
    } catch (e) {
      if ((e as { status?: number })?.status === 409) { setConflict(true); setErr('Someone else saved this form. Your draft is kept here; reload to see their version.'); }
      else setErr(errMsg(e, 'Could not save.'));
    } finally { setSaving(null); }
  };
  const reload = async () => { const r = await q.refetch(); if (r.data) { setDraft(r.data.definition); setRevision(r.data.revision); setConflict(false); setErr(null); } };

  if (q.isLoading || (!draft && !q.isError)) return <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>;
  if (q.isError || !draft) return <div className="flex items-center gap-3 text-sm text-destructive py-6"><AlertTriangle className="w-4 h-4" />{errMsg(q.error, 'Could not load this form.')}<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>;

  return (
    <Tabs defaultValue="build">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="build" data-testid="tab-build">Build</TabsTrigger>
          <TabsTrigger value="preview" data-testid="tab-preview">Preview</TabsTrigger>
          <TabsTrigger value="inbox" data-testid="tab-inbox">Submissions</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <Badge variant={q.data?.published ? 'default' : 'outline'} data-testid="status-published">{q.data?.published ? 'Live' : 'Not published'}</Badge>
          {dirty && <Badge variant="secondary">Unsaved changes</Badge>}
          <span className="text-xs text-muted-foreground font-mono">rev {revision}</span>
        </div>
      </div>
      {err && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex flex-wrap items-center gap-2" data-testid="text-save-error">
          <AlertTriangle className="w-4 h-4" />{err}
          {conflict && <Button size="sm" variant="outline" className="gap-1" onClick={reload} data-testid="button-reload"><RotateCcw className="w-3.5 h-3.5" />Discard mine and reload</Button>}
        </div>
      )}
      <PublicLinkPanel kind={kind} />
      <TabsContent value="build" className="mt-4 space-y-4">
        <FlowBuilder value={draft} onChange={setDraft} kind={kind} />
        <div className="sticky bottom-3 z-10 flex justify-end gap-2 rounded-xl border bg-background/90 backdrop-blur p-2 shadow-lg">
          <Button variant="outline" className="gap-1.5" disabled={!!saving} onClick={() => save(false)} data-testid="button-save-draft"><Save className="w-4 h-4" />{saving === 'draft' ? 'Saving…' : 'Save draft'}</Button>
          <Button className="gap-1.5" disabled={!!saving} onClick={() => save(true)} data-testid="button-publish"><Send className="w-4 h-4" />{saving === 'publish' ? 'Publishing…' : 'Publish'}</Button>
        </div>
      </TabsContent>
      <TabsContent value="preview" className="mt-4">
        <div className="max-w-lg mx-auto rounded-2xl border bg-card shadow-xl overflow-hidden">
          <div className="px-5 py-4 bg-primary text-primary-foreground">
            <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">Draft preview</p>
            <h2 className="text-lg font-semibold">{draft.title || 'Untitled form'}</h2>
            {draft.intro && <p className="text-sm opacity-90 mt-1">{draft.intro}</p>}
          </div>
          <div className="p-5">
            {draft.steps.length ? <FlowRenderer key={JSON.stringify(draft)} definition={draft} preview allowProperty={kind === 'quote'} />
              : <p className="text-sm text-muted-foreground text-center py-6">Add a step to preview the form.</p>}
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-3">Service and posting pickers show live options on the public page. Map lookup works on the public page.</p>
      </TabsContent>
      <TabsContent value="inbox" className="mt-4"><SubmissionInbox kind={kind} /></TabsContent>
    </Tabs>
  );
}

function PublicLinkPanel({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const hr = useHrMeta();
  const tenantId = (user as { tenantId?: number } | null)?.tenantId ?? null;
  const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
  const url = kind === 'quote' ? (tenantId ? `${base}/widget/quote?tenantId=${tenantId}` : null) : (hr.data?.publicCareersUrl ?? null);
  const slug = kind === 'hiring' && url ? url.split('/careers/')[1]?.split(/[?#]/)[0] : undefined;
  const cfg = useQuery({
    queryKey: ['website-form-public', kind, tenantId, slug],
    enabled: !!url,
    queryFn: () => loadPublicWebsiteForm(kind === 'quote' ? { kind, tenantId: tenantId ?? undefined } : { kind, slug }),
  });
  const iframe = url ? `<iframe src="${url}" title="${kind === 'quote' ? 'Quick quote' : 'Careers'}" style="width:100%;max-width:640px;height:900px;border:0" loading="lazy"></iframe>` : '';
  const copy = (t: string, l: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${l} copied`)).catch(() => toast.error('Copy failed'));
  const settingsHref = kind === 'quote' ? '/settings?tab=growth' : '/hiring';
  return (
    <section className="mt-4 rounded-xl border bg-card p-4 space-y-3" data-testid="panel-public-link">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Public page</h3>
        {cfg.isLoading ? <Badge variant="outline">Checking…</Badge>
          : cfg.isError ? <Badge variant="destructive">Status unavailable</Badge>
            : cfg.data && <Badge variant={cfg.data.enabled ? 'default' : 'outline'} data-testid="status-public-enabled">{cfg.data.enabled ? 'Accepting submissions' : 'Turned off'}</Badge>}
        {cfg.data && !cfg.data.enabled && (
          <Link href={settingsHref} className="text-xs underline text-muted-foreground" data-testid="link-enable-settings">
            Turn on in {kind === 'quote' ? 'Settings, Growth Programs' : 'Hiring, Settings'}
          </Link>
        )}
      </div>
      {!url ? <p className="text-xs text-muted-foreground">{kind === 'hiring' ? 'Your careers link appears once the public careers page is set up in Hiring, Settings.' : 'Company identifier unavailable.'}</p> : (<>
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" data-testid="input-public-url" />
          <Button size="icon" variant="outline" aria-label="Copy link" onClick={() => copy(url, 'Link')} data-testid="button-copy-url"><Copy className="w-4 h-4" /></Button>
          <Button size="icon" variant="outline" aria-label="Open" onClick={() => window.open(url, '_blank', 'noopener')} data-testid="button-open-url"><ExternalLink className="w-4 h-4" /></Button>
        </div>
        <div className="flex gap-2">
          <Input readOnly value={iframe} className="font-mono text-xs" data-testid="input-embed-code" />
          <Button size="icon" variant="outline" aria-label="Copy embed code" onClick={() => copy(iframe, 'Embed code')} data-testid="button-copy-embed"><Copy className="w-4 h-4" /></Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Visitors see the published version. Drafts stay private until you publish.</p>
      </>)}
    </section>
  );
}
