import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useConfirmStaffPasswordReset } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Read the token once, then strip it from the address bar so it never lingers in history or referrers. */
let captured: string | null = null;
function takeToken(): string {
  if (captured !== null && !new URL(window.location.href).searchParams.has('token')) return captured;
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token') ?? '';
  if (token) {
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }
  captured = token;
  return token;
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState(takeToken);
  const [fromLink] = useState(() => token !== '');
  const confirm = useConfirmStaffPasswordReset();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer'; meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => { meta.remove(); captured = null; };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) { setError('Enter the reset code from your email.'); return; }
    if (password.length < 12) { setError('Use at least 12 characters.'); return; }
    if (password !== again) { setError('Passwords do not match.'); return; }
    confirm.mutate({ data: { token, password } }, {
      onSuccess: () => setDone(true),
      onError: () => setError('This code is invalid or expired. Request a new one.'),
    });
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold tracking-tight">Choose a new password</h1>
        <Card><CardContent className="p-6 space-y-4">
          {done ? (
            <p className="text-sm" data-testid="text-reset-done">Password updated. Other sessions were signed out. Two-step sign-in stays on if you use it.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <p className="text-sm text-destructive" data-testid="text-reset-error">{error}</p>}
              {!fromLink && (
                <Input value={token} onChange={e => setToken(e.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="Reset code from your email" className="font-mono" data-testid="input-reset-code" />
              )}
              <Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (12+ characters)" data-testid="input-new-password" />
              <Input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} placeholder="Repeat new password" data-testid="input-repeat-password" />
              <Button type="submit" className="w-full" disabled={confirm.isPending} data-testid="button-reset-submit">{confirm.isPending ? 'Saving...' : 'Update password'}</Button>
            </form>
          )}
        </CardContent></Card>
        <p className="text-center text-sm"><Link href="/forgot-password" className="text-muted-foreground hover:underline mr-4" data-testid="link-request-new-code">Request a new code</Link><Link href="/login" className="text-primary hover:underline" data-testid="link-reset-login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
