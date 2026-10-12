import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBillingAutomationStatus, getGetBillingAutomationStatusQueryKey,
  useRetryBillingEmail, type BillingEmailQueueEntry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const labels: Record<string, string> = {
  pending: "Queued", processing: "Sending", sent: "Sent / accepted by provider",
  failed: "Failed — verify before retry", interrupted: "Interrupted — delivery uncertain",
};

export function BillingEmailDeliveries() {
  const client = useQueryClient();
  const query = useGetBillingAutomationStatus({
    query: { queryKey: getGetBillingAutomationStatusQueryKey(), refetchInterval: 30_000 },
  });
  const resolve = useRetryBillingEmail();
  const [selected, setSelected] = useState<BillingEmailQueueEntry | null>(null);
  const [evidence, setEvidence] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "not_sent" | "">("");
  const stats = query.data?.queueStats;

  function submit() {
    if (!selected || !outcome || evidence.trim().length < 10) return;
    resolve.mutate({ id: selected.id, data: { outcome, evidence: evidence.trim() } }, {
      onSuccess: () => {
        toast.success(outcome === "sent" ? "Delivery marked sent. No new email was sent." : "Verified email queued for retry.");
        setSelected(null);
        client.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
      },
      onError: (err: any) => toast.error(err?.data?.error ?? err?.message ?? "Unable to resolve delivery"),
    });
  }

  return <Card>
    <CardHeader><CardTitle>Email deliveries</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {stats ? `${stats.interrupted} uncertain · ${stats.failed} failed · ${stats.processing} sending · ${stats.pending} queued · ${stats.sent} sent` : "Loading delivery status…"}
      </p>
      <p className="text-xs text-muted-foreground">Interrupted emails may already have been accepted. Verify with the original provider before retrying. “Sent” means provider acceptance, not guaranteed inbox delivery.</p>
      {query.isError && <p role="alert" className="text-sm text-destructive">Unable to load email deliveries. <button className="underline" onClick={() => query.refetch()}>Try again</button></p>}
      {query.data?.emailQueue.length === 0 && <p className="text-sm">No invoice emails queued yet.</p>}
      <div className="max-h-80 overflow-auto">
        {query.data?.emailQueue.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{entry.invoiceNumber ?? `Invoice #${entry.invoiceId}`} · {labels[entry.status] ?? entry.status}</p>
            <p className="text-xs text-muted-foreground break-all">{entry.deliveryProvider ?? "Provider not recorded"} · {entry.deliveryRecipient ?? "Recipient not recorded"} · {entry.attempts} attempt(s){entry.lastAttemptAt && ` · ${new Date(entry.lastAttemptAt).toLocaleString()}`}</p>
            {entry.providerMessageId && <p className="text-xs break-all">Provider message ID: {entry.providerMessageId}</p>}
            {entry.errorMsg && <p className="text-xs text-destructive max-w-2xl break-words">{entry.errorMsg}</p>}
          </div>
          {["failed", "interrupted"].includes(entry.status) && <Button variant="outline" size="sm" onClick={() => { setSelected(entry); setOutcome(""); setEvidence(""); }}>Verify delivery</Button>}
        </div>)}
      </div>
      {query.data && <p className="text-xs text-muted-foreground">Showing up to 100 entries, unresolved deliveries first. Counts include all entries.</p>}
    </CardContent>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !resolve.isPending) setSelected(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify invoice email delivery</DialogTitle>
          <DialogDescription>{selected?.verificationInstructions}</DialogDescription>
        </DialogHeader>
        <p className="text-sm break-all">{selected?.invoiceNumber} · {selected?.deliveryRecipient ?? "Recipient unknown"}{selected?.lastAttemptAt && ` · ${new Date(selected.lastAttemptAt).toLocaleString()}`}</p>
        <p className="text-sm">Accepted, queued, deferred or delivered messages must be marked sent, not retried. A missing search result alone is not proof that no email was sent. If you cannot confirm the outcome, leave this unresolved.</p>
        <label className="text-sm space-y-2">Verified provider outcome
          <select className="w-full border rounded p-2 bg-background" value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)} disabled={resolve.isPending}>
            <option value="">Choose only after checking provider records</option>
            <option value="sent">Provider accepted it — mark sent without resending</option>
            <option value="not_sent">Confirmed not sent or queued — retry delivery</option>
          </select>
        </label>
        <label className="text-sm space-y-2">Verification evidence
          <Textarea value={evidence} maxLength={2000} onChange={e => setEvidence(e.target.value)} disabled={resolve.isPending} placeholder="Record the provider, log/event ID, time checked, and confirmed outcome. Do not include credentials." />
        </label>
        <Button onClick={submit} disabled={resolve.isPending || !outcome || evidence.trim().length < 10}>{resolve.isPending ? "Saving…" : outcome === "not_sent" ? "Confirm verified retry" : "Save verified outcome"}</Button>
      </DialogContent>
    </Dialog>
  </Card>;
}
