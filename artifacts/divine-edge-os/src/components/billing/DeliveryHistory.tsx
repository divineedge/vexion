import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Mail, MessageSquare, ShieldCheck, Info, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';

type Channel = 'email' | 'sms';
type Resolution = 'accepted' | 'not_sent' | 'unknown' | 'delivered' | 'failed';
interface Verification { resolution: Resolution; evidence: string; createdAt: string; actorName: string | null }
interface Delivery {
  id: number; source: 'legacy_invoice_queue' | 'legacy_communication' | 'document_delivery'; channel: Channel; status: string;
  provider: string | null; providerMessageId: string | null; recipient: string | null;
  createdAt: string; completedAt: string | null; deliveredAt: string | null;
  firstOpenedAt: string | null; lastOpenedAt: string | null; openCount: number | null;
  verifications: Verification[];
  receipt?: Receipt | null;
  providerCheckedAt?: string | null;
  openHistory?: string[] | null;
}
interface Receipt { id: number; status: string; createdAt: string; updatedAt: string | null; errorCode: string | null; checkedAt: string | null }
interface Page { deliveries: Delivery[]; nextBefore: string | null }

const RES_LABEL: Record<Resolution, string> = {
  accepted: 'Provider accepted (not proof of delivery)', delivered: 'Confirmed delivered', failed: 'Failed',
  not_sent: 'Not sent', unknown: 'Unknown',
};
const dt = (s: string | null) => (s ? format(new Date(s), 'MMM d, yyyy h:mm a') : null);

function VerifyForm({ delivery, onDone }: { delivery: Delivery; onDone: () => void }) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState<Resolution>('unknown');
  const [evidence, setEvidence] = useState('');
  const m = useMutation({
    mutationFn: () => customFetch(`/api/document-deliveries/${delivery.id}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution, evidence: evidence.trim() }),
    }),
    onSuccess: () => { toast.success('Verification recorded (nothing was resent)'); qc.invalidateQueries({ queryKey: ['document-deliveries'] }); onDone(); },
    onError: (e) => toast.error((e as Error)?.message || 'Failed to record verification'),
  });
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Records a manual verification only. This never resends the document.</p>
      <Select value={resolution} onValueChange={v => setResolution(v as Resolution)}>
        <SelectTrigger className="h-8" data-testid={`select-verify-resolution-${delivery.id}`}><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.keys(RES_LABEL) as Resolution[]).map(r => <SelectItem key={r} value={r}>{RES_LABEL[r]}</SelectItem>)}</SelectContent>
      </Select>
      <Textarea data-testid={`input-verify-evidence-${delivery.id}`} rows={2} placeholder="Evidence (e.g. customer confirmed by phone, provider dashboard shows bounce)" value={evidence} onChange={e => setEvidence(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" data-testid={`button-verify-submit-${delivery.id}`} disabled={!evidence.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : 'Record verification'}</Button>
      </div>
    </div>
  );
}

function CheckProviderButton({ delivery }: { delivery: Delivery }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => customFetch(`/api/document-deliveries/${delivery.id}/check-provider`, { method: 'POST' }),
    onSuccess: () => { toast.success('Provider status checked (nothing was sent)'); qc.invalidateQueries({ queryKey: ['document-deliveries'] }); },
    onError: (e) => {
      const status = (e as { status?: number })?.status;
      const data = (e as { data?: { error?: string; message?: string } })?.data;
      toast.error(status === 409
        ? (data?.error || data?.message || 'This provider cannot be checked automatically (only Resend email and Twilio SMS). Record a manual verification instead.')
        : (data?.error || data?.message || 'Provider check failed. Status left unchanged.'));
    },
  });
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" data-testid={`button-check-provider-${delivery.id}`} disabled={m.isPending}
      title="Ask the provider (Resend email / Twilio SMS) for the latest status. Never sends or resends."
      onClick={() => m.mutate()}>
      <RefreshCw className={`w-3 h-3 ${m.isPending ? 'animate-spin' : ''}`} />{m.isPending ? 'Checking…' : 'Check provider'}
    </Button>
  );
}

function OpenHistory({ times }: { times: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(o => !o)} data-testid="button-toggle-open-history">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}Tracking-image fetch times ({times.length})
      </button>
      {open && <ul className="pl-4 mt-0.5 space-y-0.5 tabular-nums text-muted-foreground">{times.map((t, i) => <li key={i}>{dt(t)}</li>)}</ul>}
    </div>
  );
}

function ChannelHistory({ type, id, channel }: { type: 'invoice' | 'estimate'; id: number; channel: Channel }) {
  const [before, setBefore] = useState<string | null>(null);
  const [items, setItems] = useState<Delivery[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const docKey = `${type}:${id}:${channel}`;

  // Reset accumulated history whenever the document changes so we never show another doc's rows.
  useEffect(() => { setItems([]); setBefore(null); setNextBefore(null); setVerifyingId(null); }, [docKey]);

  const q = useQuery({
    queryKey: ['document-deliveries', type, id, channel, before],
    queryFn: () => customFetch<Page>(`/api/document-deliveries?type=${type}&id=${id}&channel=${channel}&limit=25${before != null ? `&before=${encodeURIComponent(before)}` : ''}`),
  });

  useEffect(() => {
    if (!q.data) return;
    setNextBefore(typeof q.data.nextBefore === 'string' && q.data.nextBefore ? q.data.nextBefore : null);
    setItems(cur => {
      const fresh = before == null ? [] : cur;
      const map = new Map<string, Delivery>();
      for (const d of [...fresh, ...q.data!.deliveries]) map.set(`${d.source}:${d.id}`, d);
      // first page refresh: keep older pages already loaded
      if (before == null) for (const d of cur) if (!map.has(`${d.source}:${d.id}`)) map.set(`${d.source}:${d.id}`, d);
      return [...map.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }, [q.data, before]);

  const Icon = channel === 'email' ? Mail : MessageSquare;
  return (
    <div className="space-y-2" data-testid={`delivery-history-${channel}`}>
      <h4 className="text-sm font-semibold flex items-center gap-1.5"><Icon className="w-4 h-4" />{channel === 'email' ? 'Email' : 'SMS'} delivery history</h4>
      {q.isLoading && items.length === 0 ? <Skeleton className="h-16" /> :
        q.isError && items.length === 0 ? (
          <div className="text-sm border rounded-md p-3 flex items-center justify-between"><span className="text-destructive">Could not load history.</span><Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>
        ) : items.length === 0 ? <p className="text-sm text-muted-foreground border border-dashed rounded-md p-3">No {channel === 'email' ? 'email' : 'SMS'} sends recorded.</p> : (
          <div className="rounded-md border divide-y">
            {items.map(d => {
              const legacy = d.source !== 'document_delivery' || d.id < 0;
              const unknownStatus = legacy && d.status === 'sent' && !d.providerMessageId;
              const canVerify = !legacy && d.id > 0;
              return (
                <div key={`${d.source}:${d.id}`} className="p-3 text-sm space-y-1" data-testid={`row-delivery-${d.source}-${d.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize" title={unknownStatus ? 'Recorded as sent but no provider message ID was saved, so delivery cannot be confirmed' : undefined}>{unknownStatus ? 'Status unknown' : d.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-muted-foreground">{d.recipient ?? 'No recipient'}</span>
                      {legacy && <Badge variant="secondary" title="Historical record — read-only">{d.source === 'legacy_communication' ? 'Historical record' : 'Legacy'}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{dt(d.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                    {d.provider && <span>Provider: {d.provider}{d.providerMessageId ? ` · ${d.providerMessageId}` : ''}</span>}
                    {d.completedAt && <span>Provider accepted: {dt(d.completedAt)}</span>}
                    <span>Delivered: {d.deliveredAt ? dt(d.deliveredAt) : d.status === 'delivered' ? 'confirmed by provider (time not reported)' : 'not confirmed'}</span>
                    {d.providerCheckedAt && <span>Provider checked: {dt(d.providerCheckedAt)}</span>}
                    {channel === 'email' ? (
                      d.firstOpenedAt
                        ? <span title="Tracking image was fetched. Privacy proxies (e.g. Apple Mail) can fetch it automatically, so this does not confirm a person read it.">Tracking image fetched {d.openCount ?? 1}× · first {dt(d.firstOpenedAt)}{d.lastOpenedAt ? ` · last ${dt(d.lastOpenedAt)}` : ''}</span>
                        : <span>No tracking-image fetch recorded</span>
                    ) : (
                      <span>Read receipt: {d.firstOpenedAt ? dt(d.firstOpenedAt) : 'unknown (SMS read receipts are not supported)'}</span>
                    )}
                  </div>
                  {d.receipt && (
                    <div className="text-xs rounded border bg-muted/30 px-2 py-1 flex flex-wrap gap-x-3" data-testid={`receipt-${d.id}`}>
                      <span>Provider receipt: <b className="capitalize">{d.receipt.status.replace(/_/g, ' ')}</b></span>
                      {d.receipt.errorCode && <span className="text-destructive">Error {d.receipt.errorCode}</span>}
                      <span className="text-muted-foreground">Received {dt(d.receipt.createdAt)}</span>
                      {d.receipt.updatedAt && <span className="text-muted-foreground">Updated {dt(d.receipt.updatedAt)}</span>}
                      {d.receipt.checkedAt && <span className="text-muted-foreground">Checked {dt(d.receipt.checkedAt)}</span>}
                    </div>
                  )}
                  {channel === 'email' && (d.openHistory?.length ?? 0) > 0 && <OpenHistory times={d.openHistory!} />}
                  {d.verifications.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {d.verifications.map((v, i) => (
                        <li key={i} className="text-xs flex gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" /><span><b>{RES_LABEL[v.resolution] ?? v.resolution}</b> — {v.evidence} <span className="text-muted-foreground">({v.actorName ?? 'Staff'}, {dt(v.createdAt)})</span></span></li>
                      ))}
                    </ul>
                  )}
                  {canVerify && <CheckProviderButton delivery={d} />}
                  {canVerify && verifyingId !== d.id && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-verify-${d.id}`} onClick={() => setVerifyingId(d.id)}>Record manual verification</Button>}
                  {canVerify && verifyingId === d.id && <VerifyForm delivery={d} onDone={() => setVerifyingId(null)} />}
                  {legacy && <p className="text-[11px] text-muted-foreground">Legacy record is read-only here; use the existing email recovery tools to act on it.</p>}
                </div>
              );
            })}
          </div>
        )}
      {nextBefore != null && (
        <Button size="sm" variant="outline" data-testid={`button-older-${channel}`} disabled={q.isFetching} onClick={() => setBefore(nextBefore)}>{q.isFetching ? 'Loading…' : 'Load older'}</Button>
      )}
    </div>
  );
}

/** Email + SMS delivery history for an invoice or estimate. Office staff only. */
export function DeliveryHistory({ type, id }: { type: 'invoice' | 'estimate'; id: number | null | undefined }) {
  const { canManageOffice } = useAuth();
  if (!canManageOffice || !id) return null;
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>"Provider accepted" means the email/SMS provider took the message — it is not proof of delivery. An email "open" only means the tracking image was fetched, which privacy proxies can do automatically; it does not confirm a person read it. SMS read status is unknown unless the carrier reports it.</span>
      </div>
      <ChannelHistory key={`${type}-${id}-email`} type={type} id={id} channel="email" />
      <ChannelHistory key={`${type}-${id}-sms`} type={type} id={id} channel="sms" />
    </div>
  );
}

export default DeliveryHistory;
