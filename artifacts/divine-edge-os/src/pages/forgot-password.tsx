import { useState } from 'react';
import { Link } from 'wouter';
import { useRequestStaffPasswordReset } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const req = useRequestStaffPasswordReset();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    req.mutate({ data: { email: email.trim().toLowerCase() } }, {
      onSuccess: (r) => setMessage((r as { message?: string })?.message ?? 'If that address has an account, a reset code is on its way.'),
      onError: () => setError('Could not send right now. Try again in a moment.'),
    });
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
          <p className="text-sm text-muted-foreground mt-1">We'll email a reset code if the address matches an account.</p>
        </div>
        <Card><CardContent className="p-6">
          {message ? (
            <div className="space-y-4">
              <p className="text-sm" data-testid="text-reset-requested">{message}</p>
              <p className="text-sm text-muted-foreground">The email contains a reset code. Enter it on the next screen.</p>
              <Link href="/reset-password" className="block text-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground" data-testid="link-enter-code">Enter reset code</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <p className="text-sm text-destructive" data-testid="text-forgot-error">{error}</p>}
              <Input type="email" required autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" data-testid="input-forgot-email" />
              <Button type="submit" className="w-full" disabled={req.isPending} data-testid="button-forgot-submit">{req.isPending ? 'Sending...' : 'Send reset code'}</Button>
            </form>
          )}
        </CardContent></Card>
        <p className="text-center text-sm"><Link href="/reset-password" className="text-muted-foreground hover:underline mr-4" data-testid="link-have-code">I have a code</Link><Link href="/login" className="text-primary hover:underline" data-testid="link-back-login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
