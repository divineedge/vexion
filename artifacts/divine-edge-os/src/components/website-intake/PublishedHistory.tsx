import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { loadWebsiteFormHistory, type FlowKind, type WebsiteFormVersion } from '@/lib/websiteIntake';
import FlowRenderer from './FlowRenderer';

export default function PublishedHistory({ kind, busy, onRestore }: {
  kind: FlowKind; busy: boolean; onRestore: (version: WebsiteFormVersion) => void;
}) {
  const [selected, setSelected] = useState<WebsiteFormVersion | null>(null);
  const history = useInfiniteQuery({
    queryKey: ['website-form-history', kind],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => loadWebsiteFormHistory(kind, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  const versions = history.data?.pages.flatMap(p => p.versions) ?? [];
  return <section className="space-y-4" aria-label="Published form history">
    <p className="text-sm text-muted-foreground">Restore a published version as a saved draft. The live form stays unchanged until you explicitly select Publish. Past submission snapshots never change.</p>
    {history.isLoading && <p role="status">Loading published versions…</p>}
    {history.isError && <div role="alert" className="text-sm text-destructive">Could not load published history. <Button variant="outline" size="sm" onClick={() => history.refetch()}>Retry</Button></div>}
    {!history.isLoading && !history.isError && !versions.length && <p className="text-sm text-muted-foreground">No published versions yet.</p>}
    {versions.map((v, i) => <div key={v.id} className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" data-testid={`published-version-${v.id}`}>
      <div>
        <div className="font-medium flex flex-wrap items-center gap-2">{v.definition.title} <Badge variant="outline">Revision {v.revision}</Badge> {i === 0 && <Badge>Current live version</Badge>}</div>
        <p className="text-sm text-muted-foreground mt-1">{v.legacy ? 'Preserved existing live form — original publisher and publication date unavailable.' : `Published by ${v.publisherName ?? 'Unknown staff member'} · ${v.publishedAt ? new Date(v.publishedAt).toLocaleString() : 'Date unavailable'}`}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setSelected(v)}>View version</Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onRestore(v)}>Restore as draft</Button>
      </div>
    </div>)}
    {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? 'Loading…' : 'Load older versions'}</Button>}
    {selected && <div className="rounded-xl border p-5 space-y-3" data-testid="history-preview">
      <div className="flex justify-between items-start gap-3"><h3 className="font-semibold">Revision {selected.revision}: {selected.definition.title}</h3><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close preview</Button></div>
      {selected.definition.intro && <p className="text-sm">{selected.definition.intro}</p>}
      <p className="text-xs text-muted-foreground">Read-only flow preview. Conditional questions appear when their earlier answers match.</p>
      <FlowRenderer key={selected.id} definition={selected.definition} preview allowProperty={kind === 'quote'} />
    </div>}
  </section>;
}
