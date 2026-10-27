import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import {
  getGetAccountSecurityQueryKey, useGetAccountSecurity, useUpdateAccountSecurity,
  type UpdateAccountSecurityBodyAction,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/experience';

type Enrollment = { secret: string; otpauthUrl: string };
type Mode = 'idle' | 'enroll' | 'disable' | 'recoveryCodes';

export default function AccountSecurityPage() {
  const qc = useQueryClient();
  const status = useGetAccountSecurity({ query: { queryKey: getGetAccountSecurityQueryKey(), refetchInterval: 30000 } });
  const update = useUpdateAccountSecurity();
  const sec = (status.data ?? {}) as { enabled?: boolean; recoveryCodesRemaining?: number };

  // Secrets and codes live only in component memory; never persisted.
  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  function reset() { setMode('idle'); setPassword(''); setCode(''); setEnrollment(null); }

  async function call(action: UpdateAccountSecurityBodyAction) {
    try {
      const res = (await update.mutateAsync({ data: { action, password, ...(code.trim() ? { code: code.trim() } : {}) } })) as Record<string, unknown>;
      void qc.invalidateQueries({ queryKey: getGetAccountSecurityQueryKey() });
      if (action === 'enroll') { setEnrollment({ secret: String(res.secret ?? ''), otpauthUrl: String(res.otpauthUrl ?? '') }); setCode(''); return; }
      if (Array.isArray(res.recoveryCodes)) setCodes(res.recoveryCodes.map(String));
      if (action === 'disable') toast.success('Two-step sign-in turned off');
      if (action === 'confirm') toast.success('Two-step sign-in is on');
      reset();
    } catch (e) { toast.error(errorMessage(e, 'Check your password and code.')); }
  }

  const pwField = (
    <Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Current password" data-testid="input-reauth-password" />
  );
  const codeField = (placeholder: string) => (
    <Input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" placeholder={placeholder} data-testid="input-mfa-code" />
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="border-b pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Your account</p>
        <h1 className="text-3xl font-bold tracking-tight">Account security</h1>
        <p className="mt-1 text-muted-foreground">Optional two-step sign-in with an authenticator app. Nothing changes unless you turn it on.</p>
      </header>

      {status.isLoading ? <Skeleton className="h-28" /> : status.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Could not load. <button className="underline" onClick={() => void status.refetch()} data-testid="button-retry-security">Retry</button></div>
      ) : (
        <section className="flex items-center gap-4 rounded-xl border bg-card p-5">
          {sec.enabled ? <ShieldCheck className="h-8 w-8 text-primary" /> : <ShieldOff className="h-8 w-8 text-muted-foreground" />}
          <div className="flex-1">
            <p className="font-semibold" data-testid="text-mfa-status">{sec.enabled ? 'Two-step sign-in is on' : 'Two-step sign-in is off'}</p>
            {sec.enabled && <p className="text-sm text-muted-foreground">{sec.recoveryCodesRemaining ?? 0} unused recovery codes</p>}
          </div>
          {mode === 'idle' && (sec.enabled ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setMode('recoveryCodes')} data-testid="button-new-codes">New recovery codes</Button>
              <Button variant="outline" size="sm" onClick={() => setMode('disable')} data-testid="button-disable-mfa">Turn off</Button>
            </div>
          ) : <Button size="sm" onClick={() => setMode('enroll')} data-testid="button-start-enroll">Set up</Button>)}
        </section>
      )}

      {codes && (
        <section className="space-y-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-5" data-testid="panel-recovery-codes">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Save these recovery codes now</h2>
          <p className="text-sm text-muted-foreground">Each works once if you lose your phone. They will not be shown again.</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">{codes.map(c => <span key={c} className="rounded bg-background px-2 py-1">{c}</span>)}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(codes.join('\n')); toast.success('Copied'); }} data-testid="button-copy-codes"><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</Button>
            <Button size="sm" onClick={() => setCodes(null)} data-testid="button-codes-saved">I saved them</Button>
          </div>
        </section>
      )}

      {mode === 'enroll' && !enrollment && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Step 1 · Confirm it's you</h2>
          {pwField}
          <div className="flex gap-2"><Button onClick={() => void call('enroll')} disabled={!password || update.isPending} data-testid="button-enroll">Continue</Button><Button variant="ghost" onClick={reset}>Cancel</Button></div>
        </section>
      )}
      {mode === 'enroll' && enrollment && (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Step 2 · Add to your authenticator</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).</li>
            <li>Choose to add an account by entering a setup key.</li>
            <li>Enter the key below as a time-based key. This setup expires in 10 minutes.</li>
          </ol>
          <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
            <code className="flex-1 break-all font-mono text-sm tracking-wider" data-testid="text-totp-secret">{enrollment.secret}</code>
            <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(enrollment.secret); toast.success('Key copied'); }} data-testid="button-copy-secret"><Copy className="h-4 w-4" /></Button>
          </div>
          <h2 className="font-semibold">Step 3 · Enter the 6-digit code</h2>
          {codeField('123456')}
          <div className="flex gap-2"><Button onClick={() => void call('confirm')} disabled={!code.trim() || update.isPending} data-testid="button-confirm-mfa">Turn on</Button><Button variant="ghost" onClick={reset}>Cancel</Button></div>
        </section>
      )}
      {(mode === 'disable' || mode === 'recoveryCodes') && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{mode === 'disable' ? 'Turn off two-step sign-in' : 'Replace recovery codes'}</h2>
          {pwField}
          {codeField('Authenticator code or unused recovery code')}
          <div className="flex gap-2">
            <Button variant={mode === 'disable' ? 'destructive' : 'default'} onClick={() => void call(mode)} disabled={!password || !code.trim() || update.isPending} data-testid="button-submit-security">{mode === 'disable' ? 'Turn off' : 'Generate new codes'}</Button>
            <Button variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </section>
      )}
      <p className="text-sm text-muted-foreground">Trouble signing in? <Link href="/help?from=/account-security" className="text-primary underline">Contact support</Link>.</p>
    </div>
  );
}
