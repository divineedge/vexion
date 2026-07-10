import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useListJobs, getListJobsQueryKey, useListUsers, getListUsersQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { AlertTriangle, Plus, CheckCircle, XCircle, Wrench, Users } from 'lucide-react';
import { format } from 'date-fns';

interface Callback {
  id: number;
  tenantId: number;
  originalJobId: number;
  originalAssigneeId: number | null;
  callbackJobId: number | null;
  reason: string | null;
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
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState('__all__');
  const [filterStatus, setFilterStatus] = useState('__all__');
  const [form, setForm] = useState({
    originalJobId: '',
    originalAssigneeId: '',
    reason: '',
  });

  const { data: callbacks, isLoading } = useQuery<Callback[]>({
    queryKey: ['callbacks', filterAssignee, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterAssignee !== '__all__') params.set('assigneeId', filterAssignee);
      if (filterStatus !== '__all__') params.set('status', filterStatus);
      return customFetch<Callback[]>(`/api/callbacks?${params}`);
    },
  });

  const { data: stats } = useQuery<CallbackStats>({
    queryKey: ['callback-stats'],
    queryFn: () => customFetch<CallbackStats>('/api/callbacks/stats'),
  });

  const { data: completedJobs } = useListJobs(
    { status: 'completed' },
    { query: { enabled: createOpen, queryKey: getListJobsQueryKey({ status: 'completed' }) } },
  );

  const { data: users } = useListUsers({ query: { enabled: createOpen, queryKey: getListUsersQueryKey() } });

  const createMutation = useMutation({
    mutationFn: (data: { originalJobId: number; originalAssigneeId?: number; reason?: string }) =>
      customFetch<Callback>('/api/callbacks', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Callback ticket created');
      qc.invalidateQueries({ queryKey: ['callbacks'] });
      qc.invalidateQueries({ queryKey: ['callback-stats'] });
      setCreateOpen(false);
      setForm({ originalJobId: '', originalAssigneeId: '', reason: '' });
    },
    onError: () => toast.error('Failed to create callback'),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      customFetch(`/api/callbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Callback updated');
      qc.invalidateQueries({ queryKey: ['callbacks'] });
      qc.invalidateQueries({ queryKey: ['callback-stats'] });
    },
    onError: () => toast.error('Failed to update callback'),
  });

  const handleCreate = () => {
    if (!form.originalJobId) { toast.error('Original job is required'); return; }
    createMutation.mutate({
      originalJobId: parseInt(form.originalJobId, 10),
      originalAssigneeId: form.originalAssigneeId ? parseInt(form.originalAssigneeId, 10) : undefined,
      reason: form.reason || undefined,
    });
  };

  const openCallbacks = callbacks?.filter(c => c.status === 'open') ?? [];
  const resolvedCallbacks = callbacks?.filter(c => c.status === 'resolved') ?? [];
  const warningTechs = stats?.technicians.filter(t => t.hasWarning) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Callback Tracker</h1>
          <p className="text-muted-foreground mt-1">Quality assurance — non-revenue tickets linked to original jobs.</p>
        </div>
        {canManageJobs && (
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Log Callback
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${(stats?.companyCallbackRatio ?? 0) > 10 ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-600'}`}>
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
                  The following technicians have callback ratios above the 10% threshold:{' '}
                  {warningTechs.map(t => `${t.name} (${t.callbackRatio}%)`).join(', ')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-tech quality scores */}
      {(stats?.technicians ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quality Score by Technician</CardTitle>
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
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.technicians.map(t => (
                  <TableRow key={t.userId} className={t.hasWarning ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right">{t.completedJobs}</TableCell>
                    <TableCell className="text-right">{t.callbackCount}</TableCell>
                    <TableCell className="text-right font-semibold">{t.callbackRatio}%</TableCell>
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
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {stats?.technicians.map(t => (
                  <SelectItem key={t.userId} value={String(t.userId)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(filterStatus !== '__all__' || filterAssignee !== '__all__') && (
              <Button variant="ghost" size="sm" onClick={() => { setFilterStatus('__all__'); setFilterAssignee('__all__'); }}>
                Clear filters
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Original Job</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Logged</TableHead>
                {canManageJobs && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : (callbacks ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Wrench className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No callbacks logged yet.
                  </TableCell>
                </TableRow>
              ) : (
                (callbacks ?? []).map(cb => (
                  <TableRow key={cb.id} className={cb.status === 'open' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}>
                    <TableCell>
                      <p className="font-medium">{cb.originalJobTitle ?? `Job #${cb.originalJobId}`}</p>
                      <p className="text-xs text-muted-foreground">Job #{cb.originalJobId}</p>
                    </TableCell>
                    <TableCell>{cb.assigneeName ?? '—'}</TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm truncate">{cb.reason ?? <span className="text-muted-foreground italic">No reason provided</span>}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={cb.status === 'open' ? 'destructive' : 'outline'} className={cb.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}>
                        {cb.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(cb.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    {canManageJobs && (
                      <TableCell>
                        {cb.status === 'open' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => resolveMutation.mutate({ id: cb.id, status: 'resolved' })}
                          >
                            Resolve
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => resolveMutation.mutate({ id: cb.id, status: 'open' })}
                          >
                            Reopen
                          </Button>
                        )}
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
      <Sheet open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); setForm({ originalJobId: '', originalAssigneeId: '', reason: '' }); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Log Callback Ticket</SheetTitle>
            <SheetDescription>
              A callback is a non-revenue fix ticket issued because of a mistake on a prior completed job.
              It will be linked to the original job and technician, affecting their quality score.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Original Job <span className="text-destructive">*</span></label>
              <Select value={form.originalJobId} onValueChange={v => setForm(f => ({ ...f, originalJobId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select completed job..." /></SelectTrigger>
                <SelectContent>
                  {(completedJobs ?? []).map(j => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.title} {j.customerName ? `— ${j.customerName}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Technician Responsible</label>
              <Select value={form.originalAssigneeId} onValueChange={v => setForm(f => ({ ...f, originalAssigneeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Auto-detect from job..." /></SelectTrigger>
                <SelectContent>
                  {(users ?? [])
                    .filter(u => u.role === 'technician' || u.role === 'crew_manager')
                    .map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leave blank to auto-detect from the job's assigned technician.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason / Description</label>
              <Textarea
                placeholder="What was missed or done incorrectly? e.g. 'Missed edging on back gate area'"
                rows={3}
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Logging...' : 'Log Callback'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
