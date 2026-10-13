import { useMemo, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Users, Search, ChevronRight, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { useHrMeta, useHrEmployees, EMPLOYMENT_STATUSES, type HrEmployeeRow } from '@/lib/hr';
import { EmployeeTemplatesPanel } from '@/components/hr/EmployeeTemplatesPanel';
import { CredentialsPanel } from '@/components/hr/CredentialsPanel';
import { EmployeeAccountsPanel } from '@/components/hr/EmployeeAccountsPanel';

const statusLabel = (s: HrEmployeeRow['employmentStatus']) => EMPLOYMENT_STATUSES.find(x => x.value === s)?.label ?? 'Not set';
const statusTone: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200', onboarding: 'bg-sky-50 text-sky-700 border-sky-200',
  on_leave: 'bg-amber-50 text-amber-700 border-amber-200', former: 'bg-muted text-muted-foreground',
};
const roleLabel = (r: string) => r.replace(/_/g, ' ');

export default function EmployeesPage() {
  const meta = useHrMeta();
  const { canManageOffice } = useAuth();
  const hasHr = !!meta.data?.hasHrAccess;
  const list = useHrEmployees(hasHr);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t && ['directory', 'accounts', 'forms', 'credentials'].includes(t) ? t : 'directory';
  });
  const [status, setStatus] = useState<'all' | 'current' | 'former'>('current');

  const rows = useMemo(() => (list.data?.employees ?? []).filter(e => {
    if (status === 'current' && e.employmentStatus === 'former') return false;
    if (status === 'former' && e.employmentStatus !== 'former') return false;
    const s = q.trim().toLowerCase();
    return !s || [e.name, e.email, e.jobTitle, e.role].some(x => (x ?? '').toLowerCase().includes(s));
  }), [list.data, q, status]);

  if (meta.isLoading) return <div className="space-y-3"><Skeleton className="h-9 w-56" /><Skeleton className="h-64" /></div>;
  if (meta.isError) return <div className="p-8 text-center space-y-3"><p className="text-sm text-destructive">Could not check your access.</p><Button size="sm" variant="outline" onClick={() => meta.refetch()}>Retry</Button></div>;
  // Non-HR staff only ever see their own record — no directory fallback.
  // Office staff without HR access get the read-only account list only (no private HR data).
  if (!hasHr && canManageOffice) return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
        <p className="text-muted-foreground mt-1">Staff accounts and access. Personnel files are limited to the owner and HR staff.</p>
      </div>
      <Tabs value="accounts">
        <TabsList><TabsTrigger value="accounts" data-testid="tab-employee-accounts">Accounts & access</TabsTrigger></TabsList>
        <TabsContent value="accounts" className="mt-4"><EmployeeAccountsPanel showEmployeeFileLinks={false} /></TabsContent>
      </Tabs>
    </div>
  );
  if (!hasHr) return meta.data?.ownUserId ? <Redirect to={`/employees/${meta.data.ownUserId}`} /> : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Private personnel records. Only the owner and designated HR staff can see this page.</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="directory">Directory</TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-employee-accounts">Accounts & access</TabsTrigger>
          <TabsTrigger value="forms">Employee forms</TabsTrigger>
          <TabsTrigger value="credentials">Licenses & certificates</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="space-y-4 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name, email, title" value={q} onChange={e => setQ(e.target.value)} data-testid="input-employee-search" />
            </div>
            {(['current', 'former', 'all'] as const).map(s => (
              <Button key={s} size="sm" variant={status === s ? 'secondary' : 'ghost'} onClick={() => setStatus(s)} className="capitalize">{s}</Button>
            ))}
          </div>
          <Card><CardContent className="p-0">
            {list.isLoading ? <div className="divide-y">{[0, 1, 2, 3].map(i => <div key={i} className="p-4 flex gap-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div></div>)}</div>
            : list.isError ? <div className="p-8 text-center space-y-3"><p className="text-sm text-destructive">Could not load employees.</p><Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button></div>
            : rows.length === 0 ? (
              <div className="p-12 text-center space-y-2"><Users className="w-10 h-10 mx-auto text-muted-foreground/50" /><p className="font-medium">No employees match</p><p className="text-sm text-muted-foreground">Try a different search or status filter.</p></div>
            ) : (
              <div className="divide-y">
                {rows.map(e => (
                  <Link key={e.id} href={`/employees/${e.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors" data-testid={`employee-row-${e.id}`}>
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">{e.name.slice(0, 2).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{e.name}</span>
                        <Badge variant="outline" className={`text-xs ${statusTone[e.employmentStatus ?? ''] ?? ''}`}>{statusLabel(e.employmentStatus)}</Badge>
                        {!e.isActive && <Badge variant="outline" className="text-xs">Login disabled</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-4">
                        <span>{e.jobTitle || <span className="capitalize">{roleLabel(e.role)}</span>}</span>
                        {e.email && <span className="truncate">{e.email}</span>}
                        {e.hireDate && <span>Hired {format(new Date(`${e.hireDate.slice(0, 10)}T12:00:00`), 'MMM d, yyyy')}</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="accounts" className="mt-4"><EmployeeAccountsPanel /></TabsContent>
        <TabsContent value="forms" className="mt-4"><EmployeeTemplatesPanel /></TabsContent>
        <TabsContent value="credentials" className="mt-4"><CredentialsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
