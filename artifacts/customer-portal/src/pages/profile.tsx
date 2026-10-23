import * as React from "react";
import { usePortalGetMe, getPortalGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { User, Phone, Mail, Building2, Pencil, X, Check, Loader2, CreditCard, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { loadStripe, type Stripe as StripeInstance } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { PushReminders } from "@/components/notifications/PushReminders";
import { CardAuthorizationTerms } from "@/components/payments/CardAuthorization";

// ── Stripe card setup sub-component ─────────────────────────────────────────

interface CardFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function CardFormInner({ onSuccess, onCancel }: CardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = React.useState(false);
  const [complete, setComplete] = React.useState(false);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);

  // Get the setup intent as soon as this form mounts
  React.useEffect(() => {
    customFetch<{ clientSecret: string; publishableKey: string }>("/api/portal/me/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saveCard: true, authorizationAccepted: true }),
    })
      .then(r => setClientSecret(r.clientSecret))
      .catch(() => toast.error("Failed to prepare card form"));
  }, []);

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;
    const cardEl = elements.getElement(CardElement);
    if (!cardEl) return;
    setBusy(true);
    try {
      const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card: cardEl } });
      if (result.error) { toast.error(result.error.message ?? "Card setup failed"); return; }
      const pmId = result.setupIntent?.payment_method as string | undefined;
      if (!pmId) { toast.error("No payment method returned"); return; }
      await customFetch("/api/portal/me/attach-payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: pmId, saveCard: true, authorizationAccepted: true }),
      });
      toast.success("Card saved successfully");
      onSuccess();
    } catch {
      toast.error("Failed to save card");
    } finally {
      setBusy(false);
    }
  };

  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Preparing card form…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border rounded-md bg-white p-3 shadow-sm">
        <CardElement
          onChange={e => setComplete(e.complete)}
          options={{ style: { base: { fontSize: "15px", color: "#1a1a1a", "::placeholder": { color: "#a0aec0" } } } }}
        />
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ShieldCheck className="w-3 h-3 text-emerald-600" /> Secured by Stripe — your card details are never stored on our servers
      </p>
      <CardAuthorizationTerms />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={busy || !complete} className="gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {busy ? "Saving…" : "Save Card & Authorize"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          <X className="w-3.5 h-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Main Profile page ────────────────────────────────────────────────────────

export default function Profile() {
  const { data: me, isLoading } = usePortalGetMe();
  const qc = useQueryClient();

  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    if (me) {
      setName(me.name ?? "");
      setPhone(me.phone ?? "");
    }
  }, [me]);

  const [nameError, setNameError] = React.useState('');
  const [phoneError, setPhoneError] = React.useState('');

  async function handleSave() {
    setNameError('');
    setPhoneError('');
    let hasError = false;
    if (!name.trim()) { setNameError('Name is required.'); hasError = true; }
    const phoneClean = phone.trim();
    if (phoneClean && !/^\+?[\d\s\-().]{7,20}$/.test(phoneClean)) { setPhoneError('Enter a valid phone number.'); hasError = true; }
    if (hasError) return;
    setSaving(true);
    try {
      await customFetch("/api/portal/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phoneClean }),
      });
      await qc.invalidateQueries({ queryKey: getPortalGetMeQueryKey() });
      setEditing(false);
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (me) {
      setName(me.name ?? "");
      setPhone(me.phone ?? "");
    }
    setEditing(false);
  }

  // ── Payment method state ──────────────────────────────────────────────────

  const { data: pmData, refetch: refetchPm } = useQuery({
    queryKey: ["portal-payment-method"],
    queryFn: () => customFetch<{ paymentMethod: { label: string; brand: string; last4: string; expMonth: number; expYear: number } | null }>("/api/portal/me/payment-method"),
    staleTime: 30_000,
  });

  const [showCardForm, setShowCardForm] = React.useState(false);
  const [stripePromise, setStripePromise] = React.useState<Promise<StripeInstance | null> | null>(null);
  const [removingCard, setRemovingCard] = React.useState(false);

  const openCardForm = React.useCallback(async () => {
    if (!stripePromise) {
      // Fetch publishable key from setup-intent (it's returned alongside clientSecret)
      const r = await customFetch<{ publishableKey: string; clientSecret: string }>("/api/portal/me/setup-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saveCard: true, authorizationAccepted: true }) }).catch(() => null);
      if (r?.publishableKey) setStripePromise(loadStripe(r.publishableKey));
      else { toast.error("Stripe is not configured — contact your service provider"); return; }
    }
    setShowCardForm(true);
  }, [stripePromise]);

  const handleCardSuccess = () => {
    setShowCardForm(false);
    refetchPm();
  };

  const handleRemoveCard = async () => {
    if (!confirm("Remove your saved card? You will need to add one again to pay invoices online.")) return;
    setRemovingCard(true);
    try {
      await customFetch("/api/portal/me/payment-method", { method: "DELETE" });
      refetchPm();
      toast.success("Card removed");
    } catch {
      toast.error("Failed to remove card");
    } finally {
      setRemovingCard(false);
    }
  };

  const pm = pmData?.paymentMethod ?? null;
  const brandLabel = pm ? `${pm.brand.charAt(0).toUpperCase()}${pm.brand.slice(1)} ···· ${pm.last4}` : null;

  return (
    <div className="max-w-xl space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">View and update your contact information.</p>
      </div>

      {/* ── Contact Information ─────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Contact Information</CardTitle>
            <CardDescription className="text-sm">Your name and phone number are visible to your service provider.</CardDescription>
          </div>
          {!editing && !isLoading && (
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : editing ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" value={name} onChange={e => { setName(e.target.value); setNameError(''); }} placeholder="Your name" className={nameError ? 'border-destructive' : ''} />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" type="tel" value={phone} onChange={e => { setPhone(e.target.value); setPhoneError(''); }} placeholder="+1 (555) 000-0000" className={phoneError ? 'border-destructive' : ''} />
                {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
                  <X className="w-3.5 h-3.5 mr-1" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium">{me?.name || "—"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium">{me?.email || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">To change your email, contact your service provider.</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="text-sm font-medium">{me?.phone || "—"}</p>
                </div>
              </div>
              {me?.company && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Company</p>
                      <p className="text-sm font-medium">{me.company}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PushReminders />

      {/* ── Payment Method ──────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Payment Method
          </CardTitle>
          <CardDescription className="text-sm">
            A saved card lets your service provider collect payment for invoices automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pm && (() => {
            const cardExpiry = new Date(pm.expYear, pm.expMonth, 0);
            const daysLeft = Math.ceil((cardExpiry.getTime() - Date.now()) / 86_400_000);
            const expired = daysLeft < 0;
            const critical = !expired && daysLeft <= 30;
            const warning = !expired && !critical && daysLeft <= 60;
            if (expired || critical || warning) {
              return (
                <div className={`flex items-start gap-3 p-3 border rounded-md mb-3 ${expired || critical ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${expired || critical ? 'text-red-600' : 'text-amber-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${expired || critical ? 'text-red-800' : 'text-amber-800'}`}>
                      {expired
                        ? `Your card expired in ${pm.expMonth}/${pm.expYear}`
                        : `Your card expires soon — ${pm.expMonth}/${pm.expYear} (${daysLeft} days)`}
                    </p>
                    <p className={`text-xs mt-0.5 ${expired || critical ? 'text-red-700' : 'text-amber-700'}`}>
                      Please update your payment method to avoid service interruptions.
                    </p>
                  </div>
                  <Button size="sm" variant="outline"
                    className={`shrink-0 text-xs gap-1.5 ${expired || critical ? 'border-red-300 text-red-700 hover:bg-red-100' : 'border-amber-300 text-amber-700 hover:bg-amber-100'}`}
                    onClick={openCardForm}>
                    <CreditCard className="w-3 h-3" /> Update Card
                  </Button>
                </div>
              );
            }
            return null;
          })()}

          {pm ? (
            <div className="space-y-3">
              {/* Current card display */}
              <div className="flex items-center justify-between gap-3 p-3 border rounded-md bg-emerald-50 border-emerald-200">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-800">{brandLabel}</p>
                    <p className="text-xs text-emerald-600">Expires {pm.expMonth}/{pm.expYear}</p>
                  </div>
                </div>
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={openCardForm} className="gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" /> Replace Card
                </Button>
                <Button size="sm" variant="ghost" onClick={handleRemoveCard} disabled={removingCard}
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
                  {removingCard ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/40 border-dashed">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No card on file</p>
              </div>
              <Button size="sm" onClick={openCardForm} className="gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Add Payment Method
              </Button>
            </div>
          )}

          {/* Stripe card form */}
          {showCardForm && stripePromise && (
            <div className="pt-2 border-t mt-2">
              <p className="text-xs font-medium mb-3 text-foreground">
                {pm ? "Enter your new card details" : "Enter your card details"}
              </p>
              <Elements stripe={stripePromise}>
                <CardFormInner onSuccess={handleCardSuccess} onCancel={() => setShowCardForm(false)} />
              </Elements>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
