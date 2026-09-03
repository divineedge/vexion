import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { setDefaultHeaders } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { Mail, Phone, ArrowRight, Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  last4Phone: z
    .string()
    .min(4, "Enter the last 4 digits of your phone number")
    .max(4, "Enter only the last 4 digits")
    .regex(/^\d{4}$/, "Must be exactly 4 digits"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [tenantId, setTenantId] = useState<number>(1);
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [isPending, setIsPending] = useState(false);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", last4Phone: "" },
  });

  // Resolve tenant from URL param and fetch branding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    const tenantParam = params.get("tenant");

    if (emailParam) form.setValue("email", emailParam);

    // Support both numeric tenant IDs (?tenant=11) and slugs (?tenant=divine-edge)
    const isSlug = tenantParam && isNaN(Number(tenantParam));
    const id = tenantParam && !isSlug ? Number(tenantParam) : 1;

    if (isSlug) {
      // Resolve slug → tenant ID via the public tenant-info endpoint
      fetch(`/api/portal/tenant-info?slug=${encodeURIComponent(tenantParam!)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.tenantId) {
            setTenantId(d.tenantId);
            setDefaultHeaders({ "x-tenant-id": String(d.tenantId) });
            if (d.logoUrl) setTenantLogoUrl(d.logoUrl);
            if (d.name) setTenantName(d.name);
          }
        })
        .catch(() => {});
      setTenantId(id);
      setDefaultHeaders({ "x-tenant-id": id.toString() });
      return; // branding loaded via slug endpoint above
    }

    setTenantId(id);
    setDefaultHeaders({ "x-tenant-id": id.toString() });

    fetch(`/api/portal/tenant-info?tenantId=${encodeURIComponent(id.toString())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.logoUrl) setTenantLogoUrl(d.logoUrl);
        if (d?.name) setTenantName(d.name);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep default header in sync if tenantId changes
  useEffect(() => {
    setDefaultHeaders({ "x-tenant-id": tenantId.toString() });
  }, [tenantId]);

  const onSubmit = async (values: LoginForm) => {
    setIsPending(true);
    try {
      // Pass slug as query param so server can resolve it even if tenantId is still defaulting
      const params = new URLSearchParams(window.location.search);
      const tenantParam = params.get("tenant");
      const loginUrl = tenantParam
        ? `/api/portal/auth/login?tenant=${encodeURIComponent(tenantParam)}`
        : "/api/portal/auth/login";
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId.toString(),
        },
        body: JSON.stringify({ email: values.email, last4Phone: values.last4Phone }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as any).error ?? "We couldn't verify your details. Please try again.");
        return;
      }

      const data = await res.json();
      localStorage.setItem("portal_token", data.token);
      setDefaultHeaders({
        "x-portal-token": data.token,
      });
      toast.success(`Welcome back${data.customer?.name ? `, ${data.customer.name.split(" ")[0]}` : ""}!`);
      setLocation("/home");
    } catch {
      toast.error("Connection error. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative blurs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/20 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          {tenantLogoUrl ? (
            <img
              src={tenantLogoUrl}
              alt={tenantName || "Company logo"}
              className="h-16 w-auto object-contain mx-auto mb-6"
            />
          ) : (
            <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/20">
              <span className="text-3xl font-bold">
                {tenantName ? tenantName[0].toUpperCase() : "D"}
              </span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {tenantName ? `${tenantName} Portal` : "Client Portal"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your services, view invoices, and more.
          </p>
        </div>

        {/* Login card */}
        <Card className="border-border/50 shadow-2xl shadow-black/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Sign In
            </CardTitle>
            <CardDescription>
              Enter the email and last 4 digits of the phone number we have on file for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                          <Input
                            placeholder="you@example.com"
                            type="email"
                            autoComplete="email"
                            className="h-12 pl-10"
                            disabled={isPending}
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Last 4 of phone */}
                <FormField
                  control={form.control}
                  name="last4Phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last 4 Digits of Phone Number</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                          <Input
                            placeholder="1234"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            maxLength={4}
                            className="h-12 pl-10 tracking-widest text-lg font-mono"
                            disabled={isPending}
                            {...field}
                            onChange={(e) =>
                              field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))
                            }
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-12 text-md font-medium mt-2"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>Secure self-service powered by Divine Edge OS</p>
        </div>
      </div>
    </div>
  );
}
