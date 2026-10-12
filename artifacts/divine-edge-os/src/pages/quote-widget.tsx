/**
 * Public instant-quote widget — iframe-safe, no auth.
 * Routes: /widget/quote and /quote-widget  (?tenantId=N&ref=TOKEN&dh=CODE&address=...)
 * Price is ALWAYS calculated by the server; the client preview is informational only.
 */
import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, MapPin, ChevronLeft, Ruler, PenLine, Undo2, Trash2, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { resolveServicePrice, type PricingTier } from '@/lib/pricingMatrix';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface RequiredField { key: string; label: string; type: string; required: boolean; options?: string[] }
interface WidgetService {
  id: number; name: string; description: string | null;
  pricingMode: string | null; basePrice: number | null; pricingMatrix: unknown;
}
interface WidgetConfig {
  enabled: boolean; companyName: string; tenantId: number;
  requiredFields: RequiredField[]; services: WidgetService[]; publicAppUrl?: string | null;
}
interface QuoteResult { token: string; price: number; serviceName: string; areaSqft: number | null; exactQuote: true }
type LatLng = { lat: number; lng: number };
type Step = 'address' | 'measure' | 'contact' | 'done';

const CORE_KEYS = new Set(['name', 'email', 'phone', 'address', 'city', 'state', 'zip']);
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── Geodesic helpers (preview only; server recomputes) ───────────────── */
const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;
function geodesicAreaSqft(pts: LatLng[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    a += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((a * R * R) / 2) * 10.7639;
}
function pathLengthFt(pts: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(h));
  }
  return d * 3.28084;
}

/* ── Price preview: same resolver as the server (lib/pricingMatrix) ─── */
type Preview = { ok: true; amount: number; note: string } | { ok: false; reason: string };
function previewPrice(svc: WidgetService, sqft: number | null, ft: number | null): Preview {
  const mode = svc.pricingMode ?? 'flat';
  const base = Number(svc.basePrice ?? 0);
  const matrix = Array.isArray(svc.pricingMatrix) ? (svc.pricingMatrix as PricingTier[]) : null;
  if (!['flat', 'per_sqft', 'per_linear_ft', 'matrix'].includes(mode)) return { ok: false, reason: `Pricing mode "${mode}" isn't supported for online quotes.` };
  if ((mode === 'per_sqft' || mode === 'matrix') && !sqft) return { ok: false, reason: 'Measure your area to preview a price.' };
  if (mode === 'per_linear_ft' && !ft) return { ok: false, reason: 'Measure the length to preview a price.' };
  const amount = resolveServicePrice(mode, base, matrix, sqft, ft);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'This service has no price configured for your property. Please contact the company.' };
  const note = mode === 'flat' ? 'Flat rate' : mode === 'per_sqft' ? `${money(base)} / sq ft` : mode === 'per_linear_ft' ? `${money(base)} / linear ft` : 'Tiered by area';
  return { ok: true, amount, note };
}
const needsLength = (s?: WidgetService | null) => s?.pricingMode === 'per_linear_ft';
const needsArea = (s?: WidgetService | null) => s?.pricingMode === 'per_sqft' || s?.pricingMode === 'matrix';

/* ── Map measurer (Leaflet + ESRI imagery; no Maps key required) ─────── */
function MeasureMap({ center, mode, points, onChange }: {
  center: LatLng; mode: 'area' | 'linear'; points: LatLng[]; onChange: (p: LatLng[]) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const ptsRef = useRef(points); ptsRef.current = points;
  const cbRef = useRef(onChange); cbRef.current = onChange;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(L => {
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], 20);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        cbRef.current([...ptsRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    }).catch(() => setFailed(true));
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { mapRef.current?.setView([center.lat, center.lng], 20); }, [center.lat, center.lng]);

  useEffect(() => {
    const L = LRef.current, g = layerRef.current;
    if (!L || !g) return;
    g.clearLayers();
    const ll = points.map(p => [p.lat, p.lng] as [number, number]);
    const style = { color: 'hsl(48 100% 60%)', weight: 3, fillOpacity: 0.25 };
    if (mode === 'area' && ll.length >= 3) L.polygon(ll, style).addTo(g);
    else if (ll.length >= 2) L.polyline(ll, style).addTo(g);
    ll.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: 'hsl(48 100% 50%)', fillOpacity: 1 }).addTo(g));
  }, [points, mode]);

  if (failed) return <div className="h-64 rounded-lg border grid place-items-center text-sm text-muted-foreground">Map unavailable — enter your measurement manually below.</div>;
  return <div ref={el} className="h-64 sm:h-80 w-full rounded-lg overflow-hidden border cursor-crosshair" data-testid="map-measure" />;
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function QuoteWidgetPage() {
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const tenantId = qs.get('tenantId') ?? qs.get('tenant') ?? '';
  const referralCode = qs.get('ref') ?? undefined;
  const doorHangerCode = qs.get('dh') ?? undefined;

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [step, setStep] = useState<Step>('address');
  const [address, setAddress] = useState(qs.get('address') ?? '');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zip, setZip] = useState('');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  const [serviceId, setServiceId] = useState<number | null>(null);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [manual, setManual] = useState('');
  const [useManual, setUseManual] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  // Idempotency: same unchanged payload reuses its UUID on retry; any change gets a fresh one.
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const submittedSigRef = useRef<string | null>(null);

  const loadConfig = useCallback(() => {
    if (!tenantId) { setConfigError('This quote link is missing a company identifier.'); setLoadingConfig(false); return; }
    setLoadingConfig(true); setConfigError(null);
    customFetch<WidgetConfig>(`/api/widget/config?tenantId=${encodeURIComponent(tenantId)}`)
      .then(c => { setConfig(c); if (c.services.length === 1) setServiceId(c.services[0].id); })
      .catch(() => setConfigError('We couldn’t load this quote form.'))
      .finally(() => setLoadingConfig(false));
  }, [tenantId]);
  useEffect(loadConfig, [loadConfig]);

  const service = config?.services.find(s => s.id === serviceId) ?? null;
  const mode: 'area' | 'linear' = needsLength(service) ? 'linear' : 'area';
  const measured = mode === 'area' ? geodesicAreaSqft(points) : pathLengthFt(points);
  const manualNum = Number(manual);
  const value = useManual ? (manualNum > 0 ? manualNum : null) : (measured > 0 ? Math.round(measured) : null);
  const needsMeasure = needsArea(service) || needsLength(service);
  const preview = service ? previewPrice(service, mode === 'area' ? value : null, mode === 'linear' ? value : null) : null;
  const extraFields = (config?.requiredFields ?? []).filter(f => !CORE_KEYS.has(f.key));

  const locate = async () => {
    if (!address.trim() || !city.trim() || !stateCode.trim() || !zip.trim()) { setError('Street, city, state and ZIP are all required.'); return; }
    setError(null); setLocating(true);
    try {
      const full = `${address}, ${city}, ${stateCode} ${zip}`;
      const r = await customFetch<{ lat: number; lng: number }>(`/api/widget/locate?tenantId=${encodeURIComponent(tenantId)}&address=${encodeURIComponent(full)}`);
      setCenter({ lat: r.lat, lng: r.lng });
    } catch {
      setCenter(null); setUseManual(true);
    } finally { setLocating(false); setStep('measure'); }
  };

  const toContact = () => {
    if (!service) { setError('Choose a service.'); return; }
    if (preview && !preview.ok && !/^Measure/.test(preview.reason)) { setError(preview.reason); return; }
    if (needsMeasure && !value) { setError(mode === 'area' ? 'Outline your area on the map or enter square footage.' : 'Trace the length on the map or enter linear feet.'); return; }
    setError(null); setStep('contact');
  };

  const submit = async () => {
    if (!name.trim() || !phone.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Name, a valid email and phone are required.'); return; }
    const missing = extraFields.find(f => f.required && !custom[f.key]?.trim());
    if (missing) { setError(`${missing.label} is required.`); return; }
    setError(null); setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        tenantId: Number(tenantId), name: name.trim(), email: email.trim(), phone: phone.trim(),
        address: address.trim(), city: city.trim(), state: stateCode.trim(), zip: zip.trim(),
        serviceId, requestId: requestIdRef.current, referralCode, doorHangerCode,
        lat: center?.lat, lng: center?.lng,
        customFieldValues: extraFields.length ? custom : undefined,
      };
      if (needsMeasure) {
        if (!useManual && points.length >= (mode === 'area' ? 3 : 2)) {
          body.measurementPolygon = points;
          if (mode === 'linear') body.lengthFt = value;
        } else if (mode === 'area') body.areaSqft = value;
        else body.lengthFt = value;
      }
      const { requestId: _omit, ...sigBody } = body;
      void _omit;
      const sig = JSON.stringify(sigBody);
      if (submittedSigRef.current !== null && submittedSigRef.current !== sig) {
        requestIdRef.current = crypto.randomUUID();
      }
      submittedSigRef.current = sig;
      body.requestId = requestIdRef.current;
      const r = await customFetch<QuoteResult>('/api/widget/quote-request', { method: 'POST', body: JSON.stringify(body) });
      setResult(r); setStep('done');
    } catch (e: unknown) {
      const msg = (e as { data?: { error?: string } })?.data?.error;
      setError(msg ?? 'We couldn’t price this request. Please check your details and try again.');
    } finally { setSubmitting(false); }
  };

  /* ── Render ── */
  const shell = (children: ReactNode) => (
    <div className="min-h-[100dvh] bg-gradient-to-b from-primary/10 via-background to-muted/40 flex items-start sm:items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b bg-primary text-primary-foreground">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">Instant quote</p>
          <h1 className="text-lg font-semibold" data-testid="text-company">{config?.companyName ?? 'Get your price'}</h1>
          {step !== 'done' && config && (
            <div className="flex gap-1.5 mt-3">{(['address', 'measure', 'contact'] as Step[]).map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full ${['address', 'measure', 'contact'].indexOf(step) >= i ? 'bg-primary-foreground' : 'bg-primary-foreground/30'}`} />
            ))}</div>
          )}
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );

  if (loadingConfig) return shell(<div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />)}</div>);
  if (configError || !config) return shell(
    <div className="text-center py-6 space-y-3"><AlertTriangle className="w-8 h-8 mx-auto text-destructive" /><p className="text-sm">{configError}</p>
      {tenantId && <Button variant="outline" onClick={loadConfig} data-testid="button-retry">Try again</Button>}</div>);
  if (!config.enabled) return shell(<p className="text-sm text-center py-6 text-muted-foreground">Online quotes are currently turned off for {config.companyName}. Please contact them directly.</p>);
  if (!config.services.length) return shell(<p className="text-sm text-center py-6 text-muted-foreground">{config.companyName} hasn’t published any instantly-priced services yet.</p>);

  const err = error && <p className="text-sm text-destructive flex gap-1.5" data-testid="text-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>;

  if (step === 'address') return shell(<>
    <label className="text-sm font-medium flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" />Property address</label>
    <Input placeholder="Street address *" value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" data-testid="input-address" />
    <div className="grid grid-cols-6 gap-2">
      <Input className="col-span-6 sm:col-span-3" placeholder="City *" value={city} onChange={e => setCity(e.target.value)} autoComplete="address-level2" data-testid="input-city" />
      <Input className="col-span-2 sm:col-span-1" placeholder="ST *" maxLength={2} value={stateCode} onChange={e => setStateCode(e.target.value.toUpperCase())} autoComplete="address-level1" data-testid="input-state" />
      <Input className="col-span-4 sm:col-span-2" placeholder="ZIP *" inputMode="numeric" value={zip} onChange={e => setZip(e.target.value)} autoComplete="postal-code" data-testid="input-zip" />
    </div>
    {err}
    <Button className="w-full" onClick={locate} disabled={locating} data-testid="button-locate">
      {locating ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Finding property…</> : 'Continue'}
    </Button>
  </>);

  if (step === 'measure') return shell(<>
    <div className="space-y-2">
      <p className="text-sm font-medium">Service</p>
      <div className="grid gap-2">{config.services.map(s => (
        <button key={s.id} onClick={() => { setServiceId(s.id); setPoints([]); setError(null); }} data-testid={`button-service-${s.id}`}
          className={`text-left px-3 py-2.5 rounded-lg border transition ${serviceId === s.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/50'}`}>
          <p className="text-sm font-medium">{s.name}</p>
          {s.description && <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>}
        </button>))}</div>
    </div>

    {service && needsMeasure && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium flex items-center gap-1.5"><Ruler className="w-4 h-4 text-primary" />{mode === 'area' ? 'Outline the area to treat' : 'Trace the length'}</p>
          {center && <button className="text-xs underline text-muted-foreground" onClick={() => setUseManual(m => !m)} data-testid="button-toggle-manual">{useManual ? 'Draw on map' : 'Enter number instead'}</button>}
        </div>
        {!useManual && center ? (<>
          <MeasureMap center={center} mode={mode} points={points} onChange={setPoints} />
          <div className="flex items-center gap-2 text-xs">
            <PenLine className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground flex-1">Tap the map to place corners.</span>
            <Button size="sm" variant="ghost" disabled={!points.length} onClick={() => setPoints(p => p.slice(0, -1))} data-testid="button-undo"><Undo2 className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={!points.length} onClick={() => setPoints([])} data-testid="button-clear"><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
          <p className="text-sm" data-testid="text-measured">Measured: <strong>{value ? `${value.toLocaleString()} ${mode === 'area' ? 'sq ft' : 'ft'}` : '—'}</strong> <span className="text-xs text-muted-foreground">(final area computed by our server)</span></p>
        </>) : (<>
          {!center && <p className="text-xs text-muted-foreground">We couldn’t place this address on the map. Enter your measurement below.</p>}
          <Input type="number" min={1} placeholder={mode === 'area' ? 'Square feet' : 'Linear feet'} value={manual} onChange={e => setManual(e.target.value)} data-testid="input-manual-measure" />
          <p className="text-xs text-muted-foreground">Customer-provided measurement.</p>
        </>)}
      </div>
    )}

    {service && preview && (
      <div className="rounded-lg border bg-muted/40 p-3" data-testid="text-preview">
        {preview.ok ? <><p className="text-xs text-muted-foreground">Estimated preview · {preview.note}</p><p className="text-2xl font-semibold">{money(preview.amount)}</p><p className="text-[11px] text-muted-foreground">Your exact price is confirmed on the next step.</p></>
          : <p className="text-sm text-muted-foreground">{preview.reason}</p>}
      </div>
    )}
    {err}
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setStep('address')} data-testid="button-back"><ChevronLeft className="w-4 h-4" /></Button>
      <Button className="flex-1" onClick={toContact} data-testid="button-next">Continue</Button>
    </div>
  </>);

  if (step === 'contact') return shell(<>
    <div className="grid gap-2">
      <Input placeholder="Full name *" value={name} onChange={e => setName(e.target.value)} autoComplete="name" data-testid="input-name" />
      <Input type="email" placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" data-testid="input-email" />
      <Input type="tel" placeholder="Phone *" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" data-testid="input-phone" />
      {extraFields.map(f => f.options?.length ? (
        <select key={f.key} className="h-10 rounded-md border bg-background px-3 text-sm" value={custom[f.key] ?? ''} onChange={e => setCustom(c => ({ ...c, [f.key]: e.target.value }))} data-testid={`select-custom-${f.key}`}>
          <option value="">{f.label}{f.required ? ' *' : ''}</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input key={f.key} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} placeholder={`${f.label}${f.required ? ' *' : ''}`}
          value={custom[f.key] ?? ''} onChange={e => setCustom(c => ({ ...c, [f.key]: e.target.value }))} data-testid={`input-custom-${f.key}`} />
      ))}
    </div>
    <p className="text-[11px] text-muted-foreground flex gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0" />We use your details only to respond to this quote. You won’t be added to marketing lists.</p>
    {err}
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setStep('measure')} data-testid="button-back-contact"><ChevronLeft className="w-4 h-4" /></Button>
      <Button className="flex-1" onClick={submit} disabled={submitting} data-testid="button-submit">{submitting ? 'Calculating…' : 'Get my exact price'}</Button>
    </div>
  </>);

  return shell(result && (
    <div className="text-center space-y-3 py-2">
      <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
      <p className="text-sm text-muted-foreground">{result.serviceName}</p>
      <p className="text-4xl font-bold" data-testid="text-price">{money(result.price)}</p>
      {result.areaSqft != null && <p className="text-xs text-muted-foreground">Based on {Math.round(result.areaSqft).toLocaleString()} sq ft</p>}
      <p className="text-xs rounded-md bg-muted/60 p-2.5 text-left">This price depends on the measurement you provided and has not been independently verified against the property. {config.companyName} may adjust it after an on-site check.</p>
      <Button variant="outline" size="sm" data-testid="button-view-quote"
        onClick={() => window.open(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/quote/${result.token}`, '_blank')}>View quote details</Button>
      <Button variant="ghost" size="sm" data-testid="button-new-quote" onClick={() => {
        requestIdRef.current = crypto.randomUUID();
        submittedSigRef.current = null;
        setResult(null); setPoints([]); setManual(''); setError(null); setStep('measure');
      }}>Start a new quote</Button>
    </div>
  ));
}
