import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useGetGuestDocumentPortal,
  useConfirmGuestDocumentPortal,
  getGetGuestDocumentPortalQueryKey,
  type GuestDocumentPortal,
  type GuestDocumentProperty,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { MeasurementZonesView } from "@/components/MeasurementZonesView";
import { SatelliteMeasurementMap, usableZones } from "@/components/SatelliteMeasurementMap";
import { AlertCircle, CheckCircle2, ExternalLink, FileText, MapPin, Phone, RotateCw, ShieldCheck } from "lucide-react";

type Kind = "invoice" | "estimate";

/** Adds noindex + no-referrer meta for the life of the page, restoring previous values on unmount. */
function usePrivatePageMeta() {
  useEffect(() => {
    const set = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      const created = !el;
      const prev = el?.getAttribute("content") ?? null;
      if (!el) { el = document.createElement("meta"); el.name = name; document.head.appendChild(el); }
      el.setAttribute("content", content);
      return () => {
        if (created) el!.remove();
        else if (prev === null) el!.removeAttribute("content");
        else el!.setAttribute("content", prev);
      };
    };
    const a = set("robots", "noindex, nofollow");
    const b = set("referrer", "no-referrer");
    return () => { a(); b(); };
  }, []);
}

export default function ShareDocument() {
  const params = useParams<{ kind: string; token: string }>();
  const rawKind = params.kind;
  const kind: Kind = rawKind === "estimate" ? "estimate" : "invoice";
  const validKind = rawKind === "invoice" || rawKind === "estimate";
  const token = params.token ?? "";
  usePrivatePageMeta();

  const query = useGetGuestDocumentPortal(kind, token, {
    query: { enabled: validKind && !!token, queryKey: getGetGuestDocumentPortalQueryKey(kind, token), retry: false },
  });

  if (!validKind || !token) return <Unavailable />;
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    const status = (query.error as { status?: number } | null)?.status;
    return <Unavailable onRetry={status && status < 500 && status !== 429 ? undefined : () => query.refetch()} retrying={query.isFetching} />;
  }
  return <Portal kind={kind} token={token} doc={query.data} />;
}

function Portal({ kind, token, doc }: { kind: Kind; token: string; doc: GuestDocumentPortal }) {
  const docUrl = `/${kind}/${encodeURIComponent(token)}?embedded=1`;
  const label = kind === "invoice" ? "Invoice" : "Estimate";
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => {
    const prev = document.title;
    document.title = `${label} ${doc.documentNumber} · ${doc.companyName}`;
    return () => { document.title = prev; };
  }, [label, doc.documentNumber, doc.companyName]);

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {doc.logoUrl && logoOk ? (
            <img src={doc.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setLogoOk(false)} className="h-9 w-auto max-w-[120px] object-contain" data-testid="img-company-logo" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
              {doc.companyName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight" data-testid="text-company-name">{doc.companyName}</p>
            <p className="truncate text-xs text-muted-foreground">{label} {doc.documentNumber} for {doc.customerName}</p>
          </div>
          {doc.companyPhone && (
            <a href={`tel:${doc.companyPhone}`} className="hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent sm:flex" data-testid="link-company-phone">
              <Phone className="h-3.5 w-3.5" /> {doc.companyPhone}
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="doc-heading" className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your {label.toLowerCase()}</p>
              <h1 id="doc-heading" className="text-2xl font-semibold" data-testid="text-document-number">{label} {doc.documentNumber}</h1>
            </div>
            <a href={docUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
               className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent" data-testid="link-open-document">
              <ExternalLink className="h-4 w-4" /> Open full {label.toLowerCase()} / print
            </a>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <iframe
              src={docUrl}
              title={`${label} ${doc.documentNumber} from ${doc.companyName}`}
              referrerPolicy="no-referrer"
              className="block h-[78vh] min-h-[560px] w-full"
              data-testid="iframe-document"
            />
          </div>
        </section>

        <aside className="space-y-6 min-w-0">
          <ReviewCard kind={kind} token={token} doc={doc} />
        </aside>

        {doc.showMeasurements && (
          <section aria-labelledby="props-heading" className="space-y-4 lg:col-span-2">
            <div>
              <h2 id="props-heading" className="text-xl font-semibold">Property and measurements</h2>
              <p className="text-sm text-muted-foreground">Please look these over. If anything is off, describe it in the review panel and the office will check it.</p>
            </div>
            {doc.properties.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No property is linked to this {label.toLowerCase()}.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {doc.properties.map(p => <PropertyCard key={p.id} property={p} />)}
              </div>
            )}
          </section>
        )}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> This private link only shows this {label.toLowerCase()}. Do not forward it.
      </footer>
    </div>
  );
}

function PropertyCard({ property }: { property: GuestDocumentProperty }) {
  const zones = usableZones(property.measurementZones ?? []);
  const hasPin = property.lat != null && property.lng != null && Number.isFinite(property.lat) && Number.isFinite(property.lng);
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4" data-testid={`card-property-${property.id}`}>
      <h3 className="flex items-start gap-2 font-medium"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {property.address}</h3>
      {hasPin ? (
        <>
          <SatelliteMeasurementMap lat={property.lat!} lng={property.lng!} zones={zones} address={property.address} />
          {zones.length > 0 ? (
            <ul className="divide-y rounded-xl border" data-testid={`list-measurements-${property.id}`}>
              {zones.map(z => (
                <li key={z.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: z.color || "currentColor" }} aria-hidden />
                  <span className="flex-1">{z.label || "Measured area"}</span>
                  <span className="font-medium tabular-nums">{z.mode === "linear" ? `${Math.round(z.lengthFt ?? 0).toLocaleString()} ft` : `${Math.round(z.areaSqft).toLocaleString()} sq ft`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No measurements have been recorded for this property yet.</p>
          )}
        </>
      ) : (
        <>
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">The map pin for this property has not been saved yet, so satellite imagery is unavailable.</p>
          <MeasurementZonesView zones={zones} />
        </>
      )}
    </article>
  );
}

function ReviewCard({ kind, token, doc }: { kind: Kind; token: string; doc: GuestDocumentPortal }) {
  const [email, setEmail] = useState(doc.email ?? "");
  const [phone, setPhone] = useState(doc.phone ?? "");
  const [address, setAddress] = useState(doc.address ?? "");
  const [corrections, setCorrections] = useState("");
  const [ackContact, setAckContact] = useState(false);
  const [ackProperty, setAckProperty] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const confirm = useConfirmGuestDocumentPortal();
  const propertyIds = useMemo(() => doc.properties.map(p => p.id), [doc.properties]);
  const needsPropertyAck = doc.properties.length > 0;
  const canSubmit = ackContact && (!needsPropertyAck || ackProperty) && email.trim() && phone.trim() && address.trim() && !confirm.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    confirm.mutate(
      { kind, token, data: { email: email.trim(), phone: phone.trim(), address: address.trim(), confirmed: true, propertyIds, ...(corrections.trim() ? { corrections: corrections.trim() } : {}) } },
      { onSuccess: r => setDone(r.message || "Thanks. Your review was sent to the office.") },
    );
  };

  if (done) {
    return (
      <div className="rounded-xl border border-primary/30 bg-secondary p-5" role="status" data-testid="status-confirmed">
        <CheckCircle2 className="mb-2 h-6 w-6 text-primary" />
        <h2 className="font-semibold">Review received</h2>
        <p className="mt-1 text-sm text-muted-foreground">{done}</p>
        <p className="mt-2 text-sm text-muted-foreground">The office reviews any changes before updating your records. Your {kind} above is still available.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm lg:sticky lg:top-20" aria-labelledby="review-heading">
      <div>
        <h2 id="review-heading" className="font-semibold">Confirm your details</h2>
        <p className="text-sm text-muted-foreground">Optional, and does not affect paying or responding. Changes go to the office for review; nothing updates automatically.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g-email">Email</Label>
        <Input id="g-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} data-testid="input-email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g-phone">Phone</Label>
        <Input id="g-phone" type="tel" autoComplete="tel" maxLength={80} required value={phone} onChange={e => setPhone(e.target.value)} data-testid="input-phone" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g-address">Mailing address</Label>
        <Textarea id="g-address" autoComplete="street-address" maxLength={1000} required rows={2} value={address} onChange={e => setAddress(e.target.value)} data-testid="input-address" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g-corrections">Corrections for property or measurements (optional)</Label>
        <Textarea id="g-corrections" maxLength={4000} rows={3} placeholder="For example: the back lawn area is missing the side strip." value={corrections} onChange={e => setCorrections(e.target.value)} data-testid="input-corrections" />
      </div>
      <div className="space-y-3 rounded-lg bg-muted/60 p-3">
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox checked={ackContact} onCheckedChange={v => setAckContact(v === true)} className="mt-0.5" data-testid="checkbox-ack-contact" />
          <span>I checked my email, phone, and address above.</span>
        </label>
        {needsPropertyAck && (
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={ackProperty} onCheckedChange={v => setAckProperty(v === true)} className="mt-0.5" data-testid="checkbox-ack-property" />
            <span>I reviewed the {doc.properties.length === 1 ? "property" : `${doc.properties.length} properties`}{doc.showMeasurements ? " and measurements" : ""} on this {kind}.</span>
          </label>
        )}
      </div>
      {confirm.isError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive" data-testid="text-confirm-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> We could not save your review. Check your connection and try again.
        </p>
      )}
      <Button type="submit" className="w-full" disabled={!canSubmit} data-testid="button-confirm">
        {confirm.isPending ? "Sending..." : confirm.isError ? "Try again" : "Send to office"}
      </Button>
    </form>
  );
}

function LoadingState() {
  return (
    <div className="min-h-[100dvh] bg-background" aria-busy="true" aria-label="Loading document">
      <div className="border-b bg-card"><div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3"><Skeleton className="h-9 w-9 rounded-lg" /><Skeleton className="h-5 w-48" /></div></div>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[70vh] rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function Unavailable({ onRetry, retrying }: { onRetry?: () => void; retrying?: boolean }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4">
      <div className="max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm" role="alert" data-testid="status-unavailable">
        <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">This link is not available</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may have expired or been replaced. Please contact the company that sent it for a new link.</p>
        <Button variant="outline" className="mt-4" onClick={() => (onRetry ? onRetry() : window.location.reload())} disabled={retrying} data-testid="button-retry">
          <RotateCw className="mr-2 h-4 w-4" /> {retrying ? "Retrying..." : "Try again"}
        </Button>
      </div>
    </div>
  );
}
