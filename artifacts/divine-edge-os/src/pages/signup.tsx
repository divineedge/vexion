import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { customFetch } from '@workspace/api-client-react';
import type { AuthResponse } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Building2, CheckCircle2 } from 'lucide-react';

export default function SignupPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const [form, setForm] = useState({
    companyName: '',
    ownerName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await customFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          ownerName: form.ownerName,
          email: form.email,
          password: form.password,
        }),
      });
      login(data.user);
      setLocation('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { payload?: { error?: string } })?.payload?.error;
      setError(msg ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const perks = [
    'Full scheduling & route management',
    'Customer portal & estimate approvals',
    'Chemical application compliance',
    'Field app for your crew',
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 bg-primary p-10 text-primary-foreground">
        <div>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-8">
            <span className="text-white text-2xl font-bold">D</span>
          </div>
          <h2 className="text-3xl font-bold mb-3">Run your field service business from one place.</h2>
          <p className="text-primary-foreground/70 mb-10">
            Divine Edge OS gives your team everything they need — scheduling, routing, estimates, compliance, and more.
          </p>
          <ul className="space-y-3">
            {perks.map(p => (
              <li key={p} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-5 h-5 text-primary-foreground/80 shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/50">© {new Date().getFullYear()} Divine Edge OS</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1 lg:hidden">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-bold">D</span>
              </div>
              <span className="font-semibold text-sm">Divine Edge OS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
            <p className="text-muted-foreground text-sm mt-1">Set up your business in under a minute.</p>
          </div>

          <Card>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded-md">
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> Company Name
                  </label>
                  <Input
                    title="Your company or business name"
                    value={form.companyName}
                    onChange={set('companyName')}
                    placeholder="Torres Field Services"
                    required
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Your Name</label>
                  <Input
                    title="Your full name — used as the account owner"
                    value={form.ownerName}
                    onChange={set('ownerName')}
                    placeholder="Mike Torres"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Work Email</label>
                  <Input
                    type="email"
                    title="Work email address — used to log in"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="mike@company.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Password</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      title="Password — at least 8 characters"
                      value={form.password}
                      onChange={set('password')}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      title={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(v => !v)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Confirm Password</label>
                  <Input
                    type="password"
                    title="Re-enter your password to confirm"
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <Button type="submit" title="Create your Divine Edge OS account" className="w-full" disabled={loading}>
                  {loading ? 'Creating your account…' : 'Create Account'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-primary font-medium hover:underline">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
