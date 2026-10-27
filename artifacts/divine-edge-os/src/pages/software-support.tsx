import { useState } from 'react';
import { Link } from 'wouter';
import { ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useExperienceAdmin } from '@/lib/experience';
import { SupportTriage } from '@/components/experience/SupportTriage';
import { ContentEditor } from '@/components/experience/ContentEditor';
import { BusinessPolicies } from '@/components/experience/BusinessPolicies';
import { OperationsPanel } from '@/components/experience/OperationsPanel';

const TABS = [
  { key: 'inbox', label: 'Support inbox' },
  { key: 'content', label: 'Guides & releases' },
  { key: 'policies', label: 'Business policies' },
  { key: 'ops', label: 'Operations' },
] as const;
type Tab = typeof TABS[number]['key'];

export default function SoftwareSupportPage() {
  const { isSuperAdmin, user } = useAuth();
  // Only request admin data with a verified software-owner grant.
  const { admin, isLoading, isError, refetch } = useExperienceAdmin(isSuperAdmin);
  const [tab, setTab] = useState<Tab>('inbox');

  if (!isSuperAdmin) return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Software owner access required</h1>
      <Link href="/help" className="mt-3 inline-block text-sm text-primary underline">Go to Help &amp; Feedback</Link>
    </div>
  );

  const openCount = admin?.threads.filter(t => t.status !== 'resolved').length ?? 0;
  const alertCount = admin?.alerts.filter(a => !a.resolved).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Software admin</p>
          <h1 className="text-3xl font-bold tracking-tight">Software support</h1>
        </div>
        <div className="flex gap-6 font-mono text-xs">
          <span><span className="text-2xl font-bold tabular-nums" data-testid="text-open-threads">{openCount}</span> open</span>
          <span><span className="text-2xl font-bold tabular-nums text-amber-700" data-testid="text-open-alerts">{alertCount}</span> alerts</span>
          <Link href="/software-admin" className="self-end text-primary underline" data-testid="link-software-admin">Software Admin</Link>
        </div>
      </header>
      <nav className="flex gap-4 overflow-x-auto border-b">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`tab-${t.key}`}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2 text-sm font-medium ${tab === t.key ? 'border-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{t.label}</button>
        ))}
      </nav>
      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : isError || !admin ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Could not load. <button className="underline" onClick={() => void refetch()} data-testid="button-retry-admin">Retry</button></div>
      ) : tab === 'inbox' ? <SupportTriage admin={admin} currentUserId={user?.id} />
        : tab === 'content' ? <ContentEditor content={admin.content} />
        : tab === 'policies' ? <BusinessPolicies businesses={admin.businesses} />
        : <OperationsPanel admin={admin} />}
    </div>
  );
}
