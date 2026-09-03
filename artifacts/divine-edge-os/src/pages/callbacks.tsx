import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useListJobs, getListJobsQueryKey, useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { addHours, format as fnsFormat } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { AlertTriangle, Plus, CheckCircle, XCircle, Wrench, Users, Calendar, Search, Pencil, ExternalLink, Clock, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';

interface Callback {
  id: number;
  tenantId: number;
  originalJobId: number;
  originalAssigneeId: number | null;
  callbackJobId: number | null;
  reason: string | null;
  resolutionNotes: string | null;
  scheduledFixDate: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  originalJobTitle: string | null;
  assigneeName: string | null;
}

interface CallbackStats {
  companyCallbackRatio: number;
  totalCallbacks: number;
  totalCompleted: number;
  technicians: {
    userId: number;
    name: string;
    callbackCount: number;
    completedJobs: number;
    callbackRatio: number;
    hasWarning: boolean;
  }[];
}

export default function CallbacksPage() {
  const { canManageJobs } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState('__all__');
  const [filterStatus, setFilterStatus] = useState('__all__');
  const [callbackSearch, setCallbackSearch] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [filterPriority, setFilterPriority] = useState('__all__');

  // Create form
  const [form, setForm] = useState({
    originalJobId: '',
    reason: '',
    scheduledFixDate: '',
    priority: 'normal' as 'high' | 'normal' | 'low',
  });

  // Open create sheet from URL params (?action=create&jobId=N) or pre-filter by assignee (?assignee=N)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      const jobId = params.get('jobId');
      if (jobId) setForm(f => ({ ...f, originalJobId: jobId }));
      setCreateOpen(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    const assigneeParam = params.get('assignee');
    if (assigneeParam) {
      setFilterAssignee(assigneeParam);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Resolve dialog state
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveTargetId, setResolveTargetId] = useState<number | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  // Edit callback state
  const [editingCb, setEditingCb] = useState<{ id: number; reason: string; scheduledFixDate: string } | null>(null);

  const { data: callbacks, isLoading } = useQuery<Callback[]>({
    queryKey: ['callbacks', filterAssignee, filterStatus, filterFromDate, filterToDate, filterPriority],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterAssignee !== '__all__') params.set('assigneeId', filterAssignee);
      if (filterStatus !== '__all__') params.set('status', filterStatus);
      if (filterFromDate) params.set('fromDate', filterFromDate);
      if (filterToDate) params.set('toDate', filterToDate);
      if (filterPriority !== '__all__') params.set('priority', filterPriority);
      return customFetch<Callback[]>(`/api/callbacks?${params}`);
    },
  });

  const { data: stats } = useQuery<CallbackStats>({
    queryKey: ['callback-stats', filterFromDate, filterToDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterFromDate) params.set('fromDate', filterFromDate);
      if (filterToDate) params.set('toDate', filterToDate);
      return customFetch<CallbackStats>(`/api/callbacks/stats?${params}`);
    },
  });

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  // Auto-compute due date from priority when priority changes
  useEffect(() => {
    if (!createOpen) return;
    const s = settings as any;
    const hours = form.priority === 'high'
      ? (s?.callbackDueHoursHigh ?? 4)
      : form.priority === 'low'
        ? (s?.callbackDueHoursLow ?? 72)
        : (s?.callbackDueHoursNormal ?? 24);
    setForm(f => ({ ...f, scheduledFixDate: fnsFormat(addHours(new Date(), hours), 'yyyy-MM-dd') }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.priority, createOpen]);

  const { data: completedJobs } = useListJobs(
    { status: 'completed' },
    { query: { enabled: createOpen, queryKey: getListJobsQueryKey({ status: 'completed' }) } },
  );
  const { data: inProgressJobs } = useListJobs(
    { status: 'in_progress' },
    { query: { enabled: createOpen, queryKey: getListJobsQueryKey({ status: 'in_progress' }) } },
  );
  const selectableJobs = [...(completedJobs ?? []), ...(inProgressJobs ?? [])].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const createMutation = useMutation({
    mutationFn: (data: { originalJobId: number; reason?: string; scheduledFixDate?: string }) =>
      customFetch<Callback>('/api/callbacks', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Callback ticket created and credited to the job\'s assigned technician');
      qc.invalidateQueries({ queryKey: ['callbacks'] });
      qc.invalidateQueries({ queryKey: ['callback-stats'] });
      setCreateOpen(false);
      setForm({ originalJobId: '', reason: '', scheduledFixDate: '', priority: 'normal' });
    },
    onError: () => toast.error('Failed to create callback'),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status, resolutionNotes }: { id: number; status: string; resolutionNotes?: string }) =>
      customFetch(`/api/callbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ status, resolutionNotes }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Callback updated');
      qc.invalidateQueries({ queryKey: ['callbacks'] });
      qc.invalidateQueries({ queryKey: ['callback-stats'] });
      setResolveDialogOpen(false);
      setResolveNotes('');
      setResolveTargetId(null);
    },
    onError: () => toast.error('Failed to update callback'),
  });

  const handleCreate = () => {
    if (!form.originalJobId) { toast.error('Original job is required'); return; }
    createMutation.mutate({
      originalJobId: parseInt(form.originalJobId, 10),
      reason: form.reason || undefined,
      scheduledFixDate: form.scheduledFixDate || undefined,
    });
  };

  const openResolveDialog = (id: number) => {
    setResolveTargetId(id);
    setResolveNotes('');
    setResolveDialogOpen(true);
  };

  const handleResolve = () => {
    if (!resolveTargetId) return;
    resolveMutation.mutate({
      id: resolveTargetId,
      status: 'resolved',
      resolutionNotes: resolveNotes || undefined,
    });
  };

  const openCallbacks = callbacks?.filter(c => c.status === 'open') ?? [];
  const resolvedCallbacks = callbacks?.filter(c => c.status === 'resolved') ?? [];
  const warningTechs = stats?.technicians.filter(t => t.hasWarning) ?? [];
  const filteredCallbacks = (callbacks ?? [])
    .filter(cb => !callbackSearch.trim() ||
      (cb.originalJobTitle ?? `Job #${cb.originalJobId}`).toLowerCase().includes(callbackSearch.toLowerCase()) ||
      (cb.assigneeName ?? '').toLowerCase().includes(callbackSearch.toLowerCase()) ||
      (cb.reason ?? '').toLowerCase().includes(callbackSearch.toLowerCase()) ||
      ((cb as any).customerName ?? '').toLowerCase().includes(callbackSearch.toLowerCase()))
    .filter(cb => !filterFromDate || new Date(cb.createdAt) >= new Date(filterFromDate))
    .filter(cb => !filterToDate || new Date(cb.createdAt) <= new Date(filterToDate + 'T23:59:59'))
    .filter(cb => filterPriority === '__all__' || (cb as any).priority === filterPriority);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Callback Tracker</h1>
          <p className="text-muted-foreground mt-1">
            Quality assurance — non-revenue tickets linked to original jobs.
            {openCallbacks.length > 0 && <span className="ml-2 inline-flex items-center gap-1 text-destructive font-medium text-sm"><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-white text-xs font-bold">{openCallbacks.length}</span> open</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/efficiency">
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
              <Users className="w-3.5 h-3.5" /> Efficiency metrics
            </Button>
          </Link>
          {canManageJobs && (
            <Button className="gap-2" title="Log a new customer callback ticket" disabled={createMutation.isPending} onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> {createMutation.isPending ? 'Logging…' : 'Log Callback'}
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${(stats?.companyCallbackRatio ?? 0) > ((settings as any)?.callbackWarningThresholdPct ?? 10) ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-600'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.companyCallbackRatio ?? 0}%</p>
              <p className="text-xs text-muted-foreground">Company CB Ratio</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <XCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{openCallbacks.length}</p>
              <p className="text-xs text-muted-foreground">Open Callbacks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{resolvedCallbacks.length}</p>
              <p className="text-xs text-muted-foreground">Resolved</p>
            </div>
          </CardContent>
        </Card>
        <Card className={warningTechs.length > 0 ? 'border-amber-300' : ''}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${warningTechs.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${warningTechs.length > 0 ? 'text-amber-600' : ''}`}>{warningTechs.length}</p>
              <p className="text-xs text-muted-foreground">Techs w/ Warnings</p>
            </div>
          </CardContent>
        </Card>
        {(stats as any)?.avgResolutionDays != null && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{(stats as any).avgResolutionDays.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">days</span></p>
                <p className="text-xs text-muted-foreground">Avg Resolution Time</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Warning banners */}
      {warningTechs.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-400">Quality Warning — High Callback Rate Detected</p>
                <p className="text-sm text-amber-700 dark:text-amber-500 mt-1">
                  The following technicians have callback ratios above the {(settings as any)?.callbackWarningThresholdPct ?? 10}% threshold:{' '}
                  {warningTechs.map(t => `${t.name} (${t.callbackRatio}%)`).join(', ')}
                </p>
                {warningTechs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {warningTechs.map(t => (
                      <button
                        key={t.userId}
                        title={`Filter the list to show only ${t.name}'s callbacks`}
                        className="text-xs px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 transition-colors"
                        onClick={() => setFilterAssignee(String(t.userId))}
                      >
                        View {t.name}'s callbacks →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-tech quality scores */}
      {(stats?.technicians ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quality Score by Technician <span className="text-xs font-normal text-muted-foreground">({(stats?.technicians ?? []).length} tech{(stats?.technicians ?? []).length !== 1 ? 's' : ''})</span></CardTitle>
            <CardDescription>Callback Ratio = callbacks ÷ completed jobs × 100</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-right">Completed Jobs</TableHead>
                  <TableHead className="text-right">Callbacks</TableHead>
                  <TableHead className="text-right">Callback Ratio</TableHead>
                  <TableHead className="text-right">Last Callback</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.technicians.map(t => (
                  <TableRow key={t.userId} className={t.hasWarning ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                    <TableCell className="font-medium"><button title={`Filter callbacks to show only ${t.name}'s tickets`} className="hover:underline text-primary" onClick={() => { setFilterAssignee(String(t.userId)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t.name}</button></TableCell>
                    <TableCell className="text-right">{t.completedJobs}</TableCell>
                    <TableCell className="text-right">{t.callbackCount}</TableCell>
                    <TableCell className="text-right font-semibold">{t.callbackRatio}%</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {(t as any).lastCallbackAt ? new Date((t as any).lastCallbackAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.hasWarning
                        ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> High</Badge>
                        : <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><CheckCircle className="w-3 h-3" /> Good</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filters + callback list */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={callbackSearch}
                onChange={e => setCallbackSearch(e.target.value)}
                placeholder="Search callbacks…"
                title="Search by customer name or issue description"
                className="h-9 text-sm pl-7 w-48"
              />
              {callbackSearch && <button title="Clear search" onClick={() => setCallbackSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
            </div>
            <div className="flex items-center rounded-md border bg-muted/50 p-0.5">
              {([['__all__', 'All', 'Show all callbacks'], ['open', 'Open', 'Show open (unresolved) callbacks'], ['resolved', 'Resolved', 'Show resolved callbacks']] as const).map(([val, label, tip]) => {
                const badgeCount = val === '__all__' ? (stats?.totalCallbacks ?? 0) : val === 'open' ? ((stats?.totalCallbacks ?? 0) - (stats?.totalCompleted ?? 0)) : (stats?.totalCompleted ?? 0);
                return (
                  <button
                    key={val}
                    title={tip}
                    onClick={() => setFilterStatus(val)}
                    className={`px-3 py-1 text-xs rounded-sm font-medium transition-colors flex items-center gap-1.5 ${filterStatus === val ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                    {badgeCount > 0 && (
                      <span className={`rounded-full px-1.5 py-0 text-[10px] leading-4 ${filterStatus === val ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>{badgeCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger className="w-44" title="Filter by assigned technician"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {stats?.technicians.map(t => (
                  <SelectItem key={t.userId} value={String(t.userId)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={filterFromDate}
              onChange={e => setFilterFromDate(e.target.value)}
              className="h-9 text-sm w-36"
              title={filterStatus === 'resolved' ? 'From date (resolved date)' : 'From date (logged date)'}
              placeholder="From"
            />
            <Input
              type="date"
              value={filterToDate}
              onChange={e => setFilterToDate(e.target.value)}
              className="h-9 text-sm w-36"
              title={filterStatus === 'resolved' ? 'To date (resolved date)' : 'To date (logged date)'}
              placeholder="To"
            />
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-32 h-9 text-sm" title="Filter by priority"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All priorities</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            {(filterStatus !== '__all__' || filterAssignee !== '__all__' || filterFromDate || filterToDate || filterPriority !== '__all__') && (
              <Button variant="ghost" size="sm" title="Reset all callback filters to show everything" onClick={() => { setFilterStatus('__all__'); setFilterAssignee('__all__'); setFilterFromDate(''); setFilterToDate(''); setFilterPriority('__all__'); }}>
                Clear filters
              </Button>
            )}
          </div>
          {!isLoading && filteredCallbacks.length > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/20">
              Showing {filteredCallbacks.length} callback{filteredCallbacks.length !== 1 ? 's' : ''}
              {callbacks && filteredCallbacks.length !== callbacks.length && ` (filtered from ${callbacks.length})`}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Original Job</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Fix By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>{filterStatus === 'resolved' ? 'Resolved' : 'Logged'}</TableHead>
                {canManageJobs && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : (callbacks ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    <Wrench className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No callbacks logged yet.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCallbacks
                  .sort((a, b) => {
                    const aDate = new Date(a.status === 'resolved' && a.resolvedAt ? a.resolvedAt : a.createdAt).getTime();
                    const bDate = new Date(b.status === 'resolved' && b.resolvedAt ? b.resolvedAt : b.createdAt).getTime();
                    return bDate - aDate; // newest first
                  })
                  .map(cb => (
                  <TableRow key={cb.id} className={cb.status === 'open' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}>
                    <TableCell>
                      <Link href={`/schedule?jobId=${cb.originalJobId}`} className="font-medium hover:underline text-foreground" title={cb.originalJobTitle ?? `Job #${cb.originalJobId}`}>
                        {cb.originalJobTitle ?? `Job #${cb.originalJobId}`}
                      </Link>
                      {(cb as any).customerName && (
                        <p className="text-xs text-muted-foreground">
                          {(cb as any).customerId
                            ? <Link href={`/customers/${(cb as any).customerId}`} title={`View ${(cb as any).customerName}`} className="hover:underline">{(cb as any).customerName}</Link>
                            : (cb as any).customerName
                          }{(cb as any).customerPhone ? ` · ${(cb as any).customerPhone}` : ''}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {cb.assigneeName
                        ? <button className="hover:underline text-primary text-sm" title={`Filter by assignee: ${cb.assigneeName}`} onClick={() => setFilterAssignee(String((cb as any).assigneeId ?? '__all__'))}>{cb.assigneeName}</button>
                        : '—'}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm truncate" title={cb.reason ?? undefined}>{cb.reason ?? <span className="text-muted-foreground italic">No reason provided</span>}</p>
                      {cb.resolutionNotes && (
                        <p className="text-xs text-emerald-600 mt-0.5 truncate" title={cb.resolutionNotes}>✓ {cb.resolutionNotes}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {cb.scheduledFixDate ? (() => {
                        const isOverdue = cb.status === 'open' && new Date(cb.scheduledFixDate) < new Date();
                        return (
                          <span title={new Date(cb.scheduledFixDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} className={`flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                            <Calendar className="w-3.5 h-3.5" />
                            {format(new Date(cb.scheduledFixDate), 'MMM d, yyyy')}
                            {isOverdue ? (
                              <span className="text-[10px] ml-1">Overdue</span>
                            ) : (
                              (() => {
                                const daysLeft = Math.ceil((new Date(cb.scheduledFixDate).getTime() - Date.now()) / 86400000);
                                return daysLeft <= 7 ? <span className="text-[10px] ml-1 text-amber-600">{daysLeft}d left</span> : null;
                              })()
                            )}
                          </span>
                        );
                      })() : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cb.status === 'open' ? 'destructive' : 'outline'} className={cb.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''} title={cb.status === 'open' ? 'Awaiting resolution' : cb.status === 'resolved' ? 'Issue resolved' : cb.status}>
                        {cb.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(cb as any).priority && (cb as any).priority !== 'normal' ? (
                        <Badge variant="outline" className={(cb as any).priority === 'high' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'} title={(cb as any).priority === 'high' ? `High priority — fix within ${(settings as any)?.callbackDueHoursHigh ?? 4}hr(s)` : `Low priority — fix within ${(settings as any)?.callbackDueHoursLow ?? 72}hr(s)`}>
                          {(cb as any).priority}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {(() => {
                        const d = cb.status === 'resolved' && cb.resolvedAt ? new Date(cb.resolvedAt) : new Date(cb.createdAt);
                        const daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
                        return (
                          <span title={format(d, 'MMM d, yyyy')}>
                            {daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`}
                          </span>
                        );
                      })()}
                    </TableCell>
                    {canManageJobs && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {(cb as any).originalJobId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Open the original job"
                              className="h-7 text-xs gap-1"
                              onClick={() => setLocation(`/schedule?jobId=${(cb as any).originalJobId}`)}
                            >
                              <ExternalLink className="w-3 h-3" /> Job
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit this callback"
                            className="h-7 text-xs gap-1"
                            onClick={() => setEditingCb({ id: cb.id, reason: cb.reason ?? '', scheduledFixDate: cb.scheduledFixDate ?? '' })}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                          {cb.status === 'open' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              title="Mark this callback as resolved"
                              className="h-7 text-xs"
                              onClick={() => openResolveDialog(cb.id)}
                            >
                              Resolve
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reopen this callback"
                              className="h-7 text-xs"
                              disabled={resolveMutation.isPending}
                              onClick={() => resolveMutation.mutate({ id: cb.id, status: 'open' })}
                            >
                              {resolveMutation.isPending ? 'Reopening…' : 'Reopen'}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); setForm({ originalJobId: '', reason: '', scheduledFixDate: '', priority: 'normal' }); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Log Callback Ticket</SheetTitle>
            <SheetDescription>
              A callback is a non-revenue fix ticket issued because of a mistake on a prior completed job.
              The responsible technician is credited automatically from the job's assigned technician.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Original Job <span className="text-destructive">*</span></label>
              <Select value={form.originalJobId} onValueChange={v => setForm(f => ({ ...f, originalJobId: v }))}>
                <SelectTrigger title="Select the job that generated this callback"><SelectValue placeholder="Select job..." /></SelectTrigger>
                <SelectContent>
                  {selectableJobs.map(j => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.title} {j.customerName ? `— ${j.customerName}` : ''} {j.status === 'in_progress' ? '(in progress)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  The responsible technician will be credited to whoever is assigned to this job.
                </p>
                {form.originalJobId && (
                  <a
                    href={`${import.meta.env.BASE_URL}schedule?jobId=${form.originalJobId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the original job in the schedule view"
                    className="text-xs text-primary hover:underline whitespace-nowrap ml-2 flex items-center gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    View job →
                  </a>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as 'high' | 'normal' | 'low' }))}>
                <SelectTrigger title="Set the urgency level for this callback"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">🔴 High — fix within {(settings as any)?.callbackDueHoursHigh ?? 4} hr(s)</SelectItem>
                  <SelectItem value="normal">🟡 Normal — fix within {(settings as any)?.callbackDueHoursNormal ?? 24} hr(s)</SelectItem>
                  <SelectItem value="low">⚪ Low — fix within {(settings as any)?.callbackDueHoursLow ?? 72} hr(s)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sets the auto-calculated fix date below. Adjust thresholds in Settings.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason / Description</label>
              <Textarea
                title="Describe what was missed or done incorrectly"
                placeholder="What was missed or done incorrectly? e.g. 'Missed edging on back gate area'"
                rows={3}
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5"><Calendar className="w-4 h-4" />Scheduled Fix Date</label>
              <Input
                type="date"
                title="Target date to have this callback resolved"
                value={form.scheduledFixDate}
                onChange={e => setForm(f => ({ ...f, scheduledFixDate: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Auto-set from priority — adjust if needed.</p>
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Discard this callback ticket" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button title="Save this callback ticket" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Logging...' : 'Log Callback'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Callback Dialog */}
      <Dialog open={editingCb != null} onOpenChange={open => { if (!open) setEditingCb(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Callback</DialogTitle>
            <DialogDescription>Update the reason, priority, or fix-by date for this callback.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason</label>
              <Textarea
                rows={2}
                title="Describe what went wrong"
                value={editingCb?.reason ?? ''}
                onChange={e => setEditingCb(v => v ? { ...v, reason: e.target.value } : v)}
                placeholder="What went wrong?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fix By</label>
              <Input type="date" title="Updated target date to have this callback resolved" min={new Date().toISOString().split('T')[0]} value={editingCb?.scheduledFixDate ?? ''} onChange={e => setEditingCb(v => v ? { ...v, scheduledFixDate: e.target.value } : v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" title="Discard callback edits" onClick={() => setEditingCb(null)}>Cancel</Button>
            <Button
              title="Save changes to this callback ticket"
              disabled={resolveMutation.isPending}
              onClick={() => {
                if (!editingCb) return;
                resolveMutation.mutate(
                  { id: editingCb.id, reason: editingCb.reason || undefined, scheduledFixDate: editingCb.scheduledFixDate || undefined } as any,
                  {
                    onSuccess: () => { toast.success('Callback updated'); setEditingCb(null); },
                    onError: () => toast.error('Failed to update callback'),
                  },
                );
              }}
            >
              {resolveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={open => { if (!open) { setResolveDialogOpen(false); setResolveNotes(''); setResolveTargetId(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Callback</DialogTitle>
            <DialogDescription>
              Mark this callback as resolved. Optionally add notes about what was done to fix the issue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Resolution Notes (optional)</label>
              <Textarea
                title="Describe what was done to resolve the callback"
                placeholder="What was done to fix the issue? e.g. 'Re-edged back gate area and touched up near fence post'"
                rows={3}
                value={resolveNotes}
                onChange={e => setResolveNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" title="Close without resolving this callback" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
            <Button title="Mark this callback as resolved and close the ticket" onClick={handleResolve} disabled={resolveMutation.isPending} className="gap-2">
              <CheckCircle className="w-4 h-4" />
              {resolveMutation.isPending ? 'Resolving...' : 'Mark Resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
