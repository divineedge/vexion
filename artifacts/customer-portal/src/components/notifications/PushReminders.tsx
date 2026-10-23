import * as React from "react";
import { getPortalPushKey, subscribePortalPush, unsubscribePortalPush } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, BellOff, Loader2, Smartphone, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type PushState = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const BASE = import.meta.env.BASE_URL;
const SW_URL = `${BASE}customer-push-sw.js`;

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(BASE);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Customer opt-in for push visit reminders on this device. Never prompts on load. */
export function PushReminders() {
  const [state, setState] = React.useState<PushState>("checking");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!pushSupported()) { setState(isIos() && !isStandalone() ? "needs-install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    try {
      const sub = await existingSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: BASE });
      await navigator.serviceWorker.ready;
      const { publicKey } = await getPortalPushKey();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      }
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("This browser returned an incomplete subscription.");
      await subscribePortalPush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setState("on");
      toast.success("Push reminders enabled on this device");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not enable push reminders.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    setBusy(true);
    try {
      const sub = await existingSubscription();
      if (sub) {
        // Revoke on the server first so reminders stop even if the browser step fails.
        await unsubscribePortalPush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Push reminders turned off for this device");
    } catch {
      setError("Could not turn off push reminders. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-sm" data-testid="card-push-reminders">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4" /> Push Reminders</CardTitle>
        <CardDescription className="text-sm">Get a notification on this device before upcoming service visits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "checking" && <Skeleton className="h-10 w-full" />}

        {state === "unsupported" && (
          <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/40" data-testid="status-push-unsupported">
            <BellOff className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">This browser doesn't support push notifications. Email reminders still work.</p>
          </div>
        )}

        {state === "needs-install" && (
          <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/40" data-testid="status-push-install">
            <Smartphone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">On iPhone and iPad, add this portal to your Home Screen (Share, then Add to Home Screen), open it from there, and come back to this page.</p>
          </div>
        )}

        {state === "denied" && (
          <div className="flex items-start gap-3 p-3 border rounded-md bg-amber-50 border-amber-200" data-testid="status-push-denied">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">Notifications are blocked for this site. Allow them in your browser or device settings, then reload this page.</p>
          </div>
        )}

        {state === "on" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 border rounded-md bg-emerald-50 border-emerald-200" data-testid="status-push-on">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-800">Enabled on this device.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={disable} disabled={busy} className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" data-testid="button-disable-push">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />} Turn off on this device
            </Button>
          </div>
        )}

        {state === "off" && (
          <Button size="sm" onClick={enable} disabled={busy} className="gap-1.5" data-testid="button-enable-push">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />} Enable push reminders
          </Button>
        )}

        {error && <p className="text-xs text-destructive" data-testid="text-push-error">{error}</p>}
        <p className="text-xs text-muted-foreground">Notifications only include general visit details, never payment information.</p>
      </CardContent>
    </Card>
  );
}
