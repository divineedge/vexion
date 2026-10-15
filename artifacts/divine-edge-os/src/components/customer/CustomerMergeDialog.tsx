/** Merge a duplicate (source) customer INTO the current customer (explicit primary). */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useLocation, Link } from 'wouter';
import { toast } from 'sonner';
import { GitMerge, AlertTriangle, Search, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/use-debounce';

interface MergeParty { id: number; name: string; email?: string | null; phone?: string | null; archivedAt?: string | null }
export interface MergePreview { primary: MergeParty; source: MergeParty; relations: { table: string; count: number }[]; blockers: string[] }
interface CustomerHit { id: number; name: string; email?: string | null; phone?: string | null; archivedAt?: string | null }

const label = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function CustomerMergeButton({ primaryId, primaryName }: { primaryId: number; primaryName: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" className="gap-2" title="Merge a duplicate customer into this one" onClick={() => setOpen(true)} data-testid="button-merge-customer">
      <GitMerge className="w-4 h-4" /> Merge duplicate
    </Button>
    {open && <CustomerMergeDialog primaryId={primaryId} primaryName={primaryName} onClose={() => setOpen(false)} />}
  </>;
}

function CustomerMergeDialog({ primaryId, primaryName, onClose }: { primaryId: number; primaryName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [ack, setAck] = useState(false);

  const search = useQuery({
    queryKey: ['customer-merge-search', dq],
    enabled: dq.trim().length >= 2 && !sourceId,
    queryFn: () => customFetch<{ items: CustomerHit[] }>(`/api/customers?q=${encodeURIComponent(dq.trim())}&includeArchived=true&limit=20`),
  });
  const hits = (search.data?.items ?? []).filter(c => c.id !== primaryId);

  const preview = useQuery({
    queryKey: ['customer-merge-preview', primaryId, sourceId],
    enabled: !!sourceId,
    queryFn: () => customFetch<MergePreview>(`/api/customers/${primaryId}/merge-preview?sourceId=${sourceId}`),
  });
  const merge = useMutation({
    mutationFn: () => customFetch<{ primaryId: number; sourceId: number }>(`/api/customers/${primaryId}/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, confirm: true }),
    }),
    onSuccess: async r => {
      await qc.invalidateQueries();
      toast.success('Customers merged');
      onClose();
      setLocation(`/customers/${r.primaryId}`);
    },
    onError: (e: unknown) => toast.error((e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : 'Merge failed')),
  });

  const p = preview.data;
  const blocked = (p?.blockers.length ?? 0) > 0;
  const total = p?.relations.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <Dialog open onOpenChange={o => { if (!o && !merge.isPending) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto" data-testid="dialog-merge-customer">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into {primaryName}</DialogTitle>
          <DialogDescription>This customer is kept. Pick the duplicate to fold into it.</DialogDescription>
        </DialogHeader>

        {!sourceId ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus className="pl-9" placeholder="Search name, email or phone (includes inactive)" value={q} onChange={e => setQ(e.target.value)} aria-label="Search for the duplicate customer" data-testid="input-merge-search" />
            </div>
            {search.isLoading && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>}
            {search.isError && <Button variant="outline" size="sm" onClick={() => search.refetch()}>Search failed. Retry</Button>}
            {dq.trim().length >= 2 && search.isSuccess && hits.length === 0 && <p className="text-sm text-muted-foreground">No other customers match.</p>}
            <ul className="divide-y rounded-md border empty:hidden">
              {hits.map(c => (
                <li key={c.id}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted/60 focus-visible:bg-muted/60 outline-none" onClick={() => { setSourceId(c.id); setAck(false); }} data-testid={`button-merge-pick-${c.id}`}>
                    <span className="font-medium">{c.name}</span> {c.archivedAt && <Badge variant="secondary" className="ml-1">Inactive</Badge>}
                    <span className="block text-xs text-muted-foreground">#{c.id} {[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : preview.isLoading ? (
          <div className="space-y-2"><div className="h-20 rounded-md bg-muted animate-pulse" /><div className="h-32 rounded-md bg-muted animate-pulse" /></div>
        ) : preview.isError || !p ? (
          <div className="space-y-2 text-sm"><p className="text-destructive">{(preview.error as { data?: { error?: string } } | null)?.data?.error ?? 'Could not load the merge preview.'}</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => preview.refetch()}>Retry</Button><Button size="sm" variant="ghost" onClick={() => setSourceId(null)}>Pick another</Button></div></div>
        ) : (
          <div className="space-y-4 text-sm" data-testid="panel-merge-preview">
            <div className="grid grid-cols-2 gap-3">
              {([['Kept (primary)', p.primary], ['Merged in (source)', p.source]] as const).map(([t, c]) => (
                <div key={t} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t}</p>
                  <p className="font-semibold mt-1">{c.name} <span className="text-muted-foreground font-normal">#{c.id}</span></p>
                  <p className="text-xs text-muted-foreground break-all">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</p>
                  {c.archivedAt && <Badge variant="secondary" className="mt-1">Inactive</Badge>}
                </div>
              ))}
            </div>
            <div>
              <p className="font-medium">Records moving to {p.primary.name} ({total})</p>
              {p.relations.filter(r => r.count > 0).length === 0 ? <p className="text-muted-foreground">No related records.</p> : (
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {p.relations.filter(r => r.count > 0).map(r => <li key={r.table} className="flex justify-between"><span>{label(r.table)}</span><span className="tabular-nums">{r.count}</span></li>)}
                </ul>
              )}
            </div>
            {blocked ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1" data-testid="panel-merge-blockers">
                <p className="font-medium flex items-center gap-1.5 text-destructive"><AlertTriangle className="w-4 h-4" /> This merge can't go ahead</p>
                <ul className="list-disc pl-5">{p.blockers.map(b => <li key={b}>{b}</li>)}</ul>
                <p className="text-xs text-muted-foreground">If the other customer has the saved payment profile, open that customer and merge from there so it becomes the primary. <Link href={`/customers/${p.source.id}`} className="underline" onClick={onClose}>Open {p.source.name}</Link></p>
              </div>
            ) : (
              <div className="rounded-md bg-muted/50 p-3 space-y-1.5">
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>{p.primary.name}</strong> is kept. <strong>{p.source.name}</strong> becomes inactive and is marked as merged; its record is preserved, not deleted.</li>
                  <li>Jobs, invoices, payments, plans and other history keep their current status; they are only reassigned.</li>
                  <li>Balances or credits that move over are transfers, not new money.</li>
                  <li>This can't be undone from the app.</li>
                </ul>
                <label className="flex items-start gap-2 pt-1 cursor-pointer">
                  <Checkbox checked={ack} onCheckedChange={v => setAck(v === true)} data-testid="checkbox-merge-ack" />
                  <span>I understand and want to merge {p.source.name} into {p.primary.name}.</span>
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {sourceId && <Button variant="ghost" disabled={merge.isPending} onClick={() => { setSourceId(null); setAck(false); }}>Back</Button>}
          <Button variant="outline" disabled={merge.isPending} onClick={onClose}>Cancel</Button>
          {sourceId && <Button disabled={!p || blocked || !ack || merge.isPending} onClick={() => merge.mutate()} data-testid="button-confirm-merge">
            {merge.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Merging…</> : 'Merge customers'}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
