import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePortalRequestOtp, usePortalVerifyOtp, setDefaultHeaders } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { Mail, ArrowRight, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const otpSchema = z.object({
  otp: z.string().min(6, "Code must be 6 characters").max(6, "Code must be 6 characters"),
});

export default function Login() {
  const [location, setLocation] = useLocation();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [emailSent, setEmailSent] = useState("");
  const [tenantId, setTenantId] = useState<number>(1);
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);
  const [emailDelivered, setEmailDelivered] = useState<boolean>(true);
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');

  const requestOtp = usePortalRequestOtp();
  const verifyOtp = usePortalVerifyOtp();

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: "",
    },
  });

  const otpForm = useForm<z.infer<typeof otpSchema>>({
    resolver: zodResolver(otpSchema),
    defaultValues: {
      otp: "",
    },
  });

  // Extract initial email and tenant from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    const tenantParam = params.get("tenant");
    
    if (emailParam) {
      emailForm.setValue("email", emailParam);
    }
    
    if (tenantParam) {
      const id = Number(tenantParam);
      setTenantId(id);
      // Fetch tenant branding for the login screen
      fetch(`/api/settings`, { headers: { 'x-tenant-id': id.toString() } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.logoUrl) setTenantLogoUrl(d.logoUrl);
          if (d?.companyName) setTenantName(d.companyName);
        })
        .catch(() => {});
    }
  }, [emailForm]);

  // Set the tenant header before any request
  useEffect(() => {
    setDefaultHeaders({ "x-tenant-id": tenantId.toString() });
  }, [tenantId]);

  const onEmailSubmit = (values: z.infer<typeof emailSchema>) => {
    requestOtp.mutate(
      { data: { email: values.email } },
      {
        onSuccess: (data) => {
          setEmailSent(values.email);
          setStep("otp");
          const delivered = (data as any).emailDelivered !== false;
          setEmailDelivered(delivered);
          if (delivered) {
            toast.success("Security code sent!");
          }
          
          if (data.previewOtp) {
            setPreviewOtp(data.previewOtp);
            // In development, auto-fill it
            otpForm.setValue("otp", data.previewOtp);
          }
        },
        onError: () => {
          toast.error("Failed to send code. Please try again.");
        },
      }
    );
  };

  const onOtpSubmit = (values: z.infer<typeof otpSchema>) => {
    verifyOtp.mutate(
      { data: { email: emailSent, otp: values.otp } },
      {
        onSuccess: (data) => {
          localStorage.setItem("portal_token", data.token);
          setDefaultHeaders({ 
            "x-portal-token": data.token,
            "x-tenant-id": tenantId.toString()
          });
          toast.success("Welcome back!");
          setLocation("/home");
        },
        onError: () => {
          toast.error("Invalid or expired code.");
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/20 blur-[100px] pointer-events-none" />
      
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-8">
          {tenantLogoUrl ? (
            <img src={tenantLogoUrl} alt={tenantName || 'Company logo'} className="h-16 w-auto object-contain mx-auto mb-6" />
          ) : (
            <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/20">
              <span className="text-3xl font-bold">{tenantName ? tenantName[0].toUpperCase() : 'D'}</span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{tenantName ? `${tenantName} Portal` : 'Client Portal'}</h1>
          <p className="text-muted-foreground mt-2">Manage your services, view invoices, and more.</p>
        </div>

        <Card className="border-border/50 shadow-2xl shadow-black/5">
          {step === "email" ? (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" />
                  Sign In
                </CardTitle>
                <CardDescription>
                  Enter the email address associated with your account. We'll send you a secure one-time code to log in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...emailForm}>
                  <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                    <FormField
                      control={emailForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="you@example.com" 
                              type="email"
                              className="h-12"
                              disabled={requestOtp.isPending}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button 
                      type="submit" 
                      className="w-full h-12 text-md font-medium" 
                      disabled={requestOtp.isPending}
                    >
                      {requestOtp.isPending ? "Sending..." : "Send Secure Code"}
                      {!requestOtp.isPending && <ArrowRight className="ml-2 w-4 h-4" />}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  {emailDelivered ? "Check your email" : "Email delivery not configured"}
                </CardTitle>
                <CardDescription>
                  {emailDelivered ? (
                    <>We've sent a 6-digit login code to <span className="font-medium text-foreground">{emailSent}</span>. Enter it below to sign in.</>
                  ) : (
                    <span className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      Email delivery is not configured for this account. Your login code was not sent. Please contact support to resolve this before signing in.
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...otpForm}>
                  <form onSubmit={otpForm.handleSubmit(onOtpSubmit)} className="space-y-6">
                    <FormField
                      control={otpForm.control}
                      name="otp"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>6-Digit Code</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="000000" 
                              className="text-center text-2xl tracking-widest h-14"
                              maxLength={6}
                              autoComplete="one-time-code"
                              disabled={verifyOtp.isPending}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                          {previewOtp && (
                            <p className="text-xs text-muted-foreground bg-muted p-2 rounded mt-2 border border-border/50">
                              <span className="font-semibold">Dev Note:</span> Your test code is {previewOtp}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                    <Button 
                      type="submit" 
                      className="w-full h-12 text-md font-medium" 
                      disabled={verifyOtp.isPending}
                    >
                      {verifyOtp.isPending ? "Verifying..." : "Verify & Sign In"}
                      {!verifyOtp.isPending && <CheckCircle2 className="ml-2 w-4 h-4" />}
                    </Button>
                  </form>
                </Form>
              </CardContent>
              <CardFooter className="flex justify-center border-t border-border/50 pt-6">
                <Button 
                  variant="ghost" 
                  onClick={() => setStep("email")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Use a different email
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
        
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>Secure self-service powered by Divine Edge OS</p>
        </div>
      </div>
    </div>
  );
}
