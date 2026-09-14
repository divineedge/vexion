import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { customFetch, type ExternalScope } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, LockKeyhole, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';

type OAuthConsentDetails = {
  requestId: string;
  client: {
    name: string;
    clientId: string;
  };
  connection: {
    id: string;
    name: string;
    expiresAt: string;
  };
  redirectUri: string;
  scopes: ExternalScope[];
  warnings: {
    sensitive: boolean;
    writes: boolean;
  };
  expiresAt: string;
};

type OAuthConsentDecision = {
  redirectTo: string;
};

const scopeDetails: Record<ExternalScope, { label: string; description: string; sensitive?: boolean; write?: boolean }> = {
  'customers:read': {
    label: 'Customer basics',
    description: 'Customer identity and status, without contact details or notes.',
  },
  'customers:contact': {
    label: 'Customer contact details',
    description: 'Customer contact information. Requires customer basics.',
    sensitive: true,
  },
  'jobs:read': {
    label: 'Job schedules and status',
    description: 'Basic scheduling and status information, without notes, costs, or access codes.',
  },
  'equipment:read': {
    label: 'Equipment basics',
    description: 'Basic equipment information, without costs, history, or private notes.',
  },
  'invoices:read': {
    label: 'Invoice balances and status',
    description: 'Invoice balances and payment status.',
    sensitive: true,
  },
  'tasks:read': {
    label: 'Follow-up tasks',
    description: 'Office follow-up tasks, which can include free text.',
    sensitive: true,
  },
  'tasks:create': {
    label: 'Create follow-up tasks',
    description: 'Create office follow-up tasks.',
    sensitive: true,
    write: true,
  },
  'communications:read': {
    label: 'Communication metadata',
    description: 'Call and SMS metadata, including sensitive contact information.',
    sensitive: true,
  },
  'communications:content': {
    label: 'Message content',
    description: 'The text of customer and staff communications.',
    sensitive: true,
  },
  'communications:ingest': {
    label: 'Import communication events',
    description: 'Import call or SMS events into this business.',
    sensitive: true,
    write: true,
  },
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'We could not load this authorization request. It may have expired or already been decided.';
}

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

function safeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'an unavailable time' : format(date, 'PPp');
}

function loginContinuationPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export default function OAuthConsentPage() {
  const { isAuthenticated, isOwner, logout } = useAuth();
  const [, setLocation] = useLocation();
  const requestId = useMemo(() => new URLSearchParams(window.location.search).get('oauth_consent'), []);
  const [consent, setConsent] = useState<OAuthConsentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<'approve' | 'deny' | null>(null);

  const continueToLogin = () => {
    setLocation(`/login?returnTo=${encodeURIComponent(loginContinuationPath())}`);
  };

  useEffect(() => {
    if (!requestId) {
      setLoading(false);
      setError('This OAuth consent link is missing its authorization request.');
      return;
    }

    if (!isAuthenticated) {
      continueToLogin();
      return;
    }

    if (!isOwner) {
      setLoading(false);
      setError('Only the company owner can approve or deny an assistant’s access request.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    void customFetch<OAuthConsentDetails>(`/api/oauth/consent/${encodeURIComponent(requestId)}`, {
      responseType: 'json',
    })
      .then((details) => {
        if (!cancelled) setConsent(details);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        if (errorStatus(fetchError) === 401) {
          continueToLogin();
          return;
        }
        setError(errorMessage(fetchError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isOwner, requestId]);

  const submitDecision = async (nextDecision: 'approve' | 'deny') => {
    if (!requestId || !consent || decision) return;
    setDecision(nextDecision);
    setError('');

    try {
      const result = await customFetch<OAuthConsentDecision>(`/api/oauth/consent/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        responseType: 'json',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: nextDecision }),
      });

      if (!result.redirectTo) {
        throw new Error('The authorization server did not return a redirect destination.');
      }

      // This is the pre-registered redirect URI returned by the server. Do not
      // reconstruct it in the client or append session data to it.
      window.location.assign(result.redirectTo);
    } catch (submitError) {
      if (errorStatus(submitError) === 401) {
        continueToLogin();
        return;
      }
      setError(errorMessage(submitError));
      setDecision(null);
    }
  };

  return (
    <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-lg">
        <CardHeader className="border-b space-y-3">
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
            <LockKeyhole className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-2xl">Authorize assistant access</CardTitle>
            <CardDescription className="mt-1">
              Review this request carefully. Approval gives a third-party assistant access to selected data across your business.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="py-6 space-y-5">
          {loading && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading secure authorization request…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <p>{error}</p>
              {!isAuthenticated && (
                <Button variant="outline" className="mt-3" onClick={continueToLogin}>Sign in to continue</Button>
              )}
              {isAuthenticated && !isOwner && (
                <Button variant="outline" className="mt-3" onClick={logout}>Sign out</Button>
              )}
            </div>
          )}

          {!loading && consent && (
            <>
              <section className="rounded-lg border bg-card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assistant requesting access</p>
                <p className="mt-1 font-semibold">{consent.client.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connecting through <span className="font-medium text-foreground">{consent.connection.name}</span>
                </p>
              </section>

              <section className="rounded-lg border bg-card p-4 space-y-2">
                <p className="text-sm font-medium">Where you will return</p>
                <p className="flex items-start gap-2 break-all font-mono text-xs text-muted-foreground">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {consent.redirectUri}
                </p>
                <p className="text-xs text-muted-foreground">This exact return address was registered by the company owner.</p>
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-semibold">Requested categories</h2>
                  <p className="text-sm text-muted-foreground">
                    These permissions apply tenant-wide across your business, not just to a selected customer, crew, or job.
                  </p>
                </div>
                <div className="space-y-2">
                  {consent.scopes.map((scope) => {
                    const details = scopeDetails[scope];
                    return (
                      <div key={scope} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm">{details?.label ?? scope}</p>
                          {details?.sensitive && <Badge variant="destructive">Sensitive</Badge>}
                          {details?.write && <Badge className="bg-amber-600 hover:bg-amber-600">Writes data</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{details?.description ?? scope}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold">Business-wide third-party access</p>
                    <p>
                      Third parties may retain data after receiving it, and AI output can be incorrect. Revoking access later stops future requests but cannot retrieve information already shared.
                    </p>
                    {consent.warnings.sensitive && (
                      <p className="font-medium">This request includes sensitive customer, financial, task, or communication information.</p>
                    )}
                    {consent.warnings.writes && (
                      <p className="font-medium">This assistant can create or import business data. Review its requested write permissions before approving.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-lg bg-muted p-4 text-sm text-muted-foreground space-y-2">
                <p className="flex items-center gap-2"><Clock3 className="w-4 h-4" /> This approval request expires {safeDate(consent.expiresAt)}.</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> The connection itself expires {safeDate(consent.connection.expiresAt)}. Access can also be paused or revoked by the owner.</p>
              </section>
            </>
          )}
        </CardContent>

        {!loading && consent && (
          <CardFooter className="border-t pt-5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void submitDecision('deny')}
              disabled={decision !== null}
            >
              {decision === 'deny' ? 'Denying…' : 'Deny access'}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => void submitDecision('approve')}
              disabled={decision !== null}
            >
              {decision === 'approve' ? 'Approving…' : 'Approve requested access'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}