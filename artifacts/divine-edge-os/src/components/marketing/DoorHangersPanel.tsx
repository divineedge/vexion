import { useState } from 'react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { MapPin, Plus, UserRound, CalendarCheck, AlertCircle, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useDoorHangers, useCreateDoorHanger, useAcquisitionSettings } from '@/lib/acquisition';

const today = () => new Date().toISOString().slice(0, 10);

export default function DoorHangersPanel() {
  const { canManageOffice } = useAuth();
  const [jobFilter, setJobFilter] = useState<string>('all');
  const jobId = jobFilter === 'all' ? null : Number(jobFilter);
  const { data, isLoading, isError, refetch } = useDoorHangers(jobId);
  const { data: settings } = useAcquisitionSettings(canManageOffice);
  const create = useCreateDoorHanger();
  const [form, setForm] = useState({ jobId: '', address: '', lat: '', lng: '', employeeId: '', completedAt: today() });

  const submit = () => {
    if (!form.address.trim()) { toast.error('House address is required'); return; }
    const lat = form.lat.trim() ? Number(form.lat) : undefined;
    const lng = form.lng.trim() ? Number(form.lng) : undefined;
    if ((lat !== undefined && !Number.isFinite(lat)) || (lng !== undefined && !Number.isFinite(lng))) { toast.error('Lat/lng must be numbers'); return; }
    create.mutate({
      address: form.address.trim(), lat, lng,
      jobId: form.jobId ? Number(form.jobId) : undefined,
      employeeId: canManageOffice && form.employeeId ? Number(form.employeeId) : undefined,
      completedAt: form.completedAt ? new Date(form.completedAt + 'T12:00:00').toISOString() : undefined,
    }, {
      onSuccess: () => { toast.success('Door hanger recorded'); setForm(f => ({ ...f, address: '', lat: '', lng: '' })); },
      onError: (e) => toast.error((e as Error)?.message || 'Failed to record door hanger'),
    });
  };

  const jobs = data?.jobs ?? [];
  const selectedJob = jobs.find(j => String(j.id) === form.jobId);

  return (
    <div className="space-y-4">
      {canManageOffice && settings && !settings.doorHangersEnabled && (
        <div className="flex items-center gap-2 text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          <AlertCircle className="w-4 h-4" /> Door hanger program is disabled in Settings → Growth Programs. Recording may be rejected until enabled.
        </div>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> Record a door hanger</CardTitle>
          <CardDescription>Log each real house a hanger was left at near a current job. Type the actual address — nothing is auto-generated.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Anchor job / customer property</label>
            <Select value={form.jobId || '__none__'} onValueChange={v => setForm(f => ({ ...f, jobId: v === '__none__' ? '' : v }))}>
              <SelectTrigger data-testid="select-doorhanger-job"><SelectValue placeholder="No job" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No anchor job</SelectItem>
                {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.title}{j.customerName ? ` · ${j.customerName}` : ''}{j.propertyAddress ? ` · ${j.propertyAddress}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedJob?.propertyAddress && <p className="text-xs text-muted-foreground">Around: {selectedJob.propertyAddress}</p>}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">House address <span className="text-destructive">*</span></label>
            <Input data-testid="input-doorhanger-address" placeholder="Street address of the house visited" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Latitude (optional)</label><Input data-testid="input-doorhanger-lat" inputMode="decimal" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Longitude (optional)</label><Input data-testid="input-doorhanger-lng" inputMode="decimal" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} /></div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Assigned employee</label>
            {canManageOffice ? (
              <Select value={form.employeeId || '__self__'} onValueChange={v => setForm(f => ({ ...f, employeeId: v === '__self__' ? '' : v }))}>
                <SelectTrigger data-testid="select-doorhanger-employee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__self__">Me (default)</SelectItem>
                  {(data?.employees ?? []).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : <p className="text-sm text-muted-foreground h-9 flex items-center">Recorded under your own account</p>}
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Completed date</label><Input data-testid="input-doorhanger-date" type="date" value={form.completedAt} onChange={e => setForm(f => ({ ...f, completedAt: e.target.value }))} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button data-testid="button-record-doorhanger" onClick={submit} disabled={create.isPending || !form.address.trim()}>{create.isPending ? 'Saving…' : 'Record visit'}</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-sm">Recorded houses {data ? `(${data.visits.length})` : ''}</h3>
        <Select value={jobFilter} onValueChange={setJobFilter}>
          <SelectTrigger className="w-64 h-9" data-testid="select-doorhanger-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.title}{j.customerName ? ` · ${j.customerName}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : isError ? (
        <div className="border rounded-lg p-6 text-center text-sm space-y-2"><p className="text-destructive">Could not load door hanger visits.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>
      ) : (data?.visits ?? []).length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground"><MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" /><p>No door hangers recorded yet.</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data!.visits.map(v => {
            const job = jobs.find(j => j.id === v.jobId);
            return (
              <Card key={v.id} data-testid={`card-doorhanger-${v.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary shrink-0" />{v.address}</p>
                    {v.convertedCustomerId ? <Link href={`/customers/${v.convertedCustomerId}`}><Badge className="cursor-pointer">Converted · #{v.convertedCustomerId}</Badge></Link> : <Badge variant="outline">Visit #{v.id}</Badge>}
                  </div>
                  {v.lat != null && v.lng != null && <p className="text-xs text-muted-foreground tabular-nums">{v.lat.toFixed(5)}, {v.lng.toFixed(5)}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><UserRound className="w-3 h-3" />{v.employeeName ?? 'Unassigned'}</span>
                    <span className="flex items-center gap-1"><CalendarCheck className="w-3 h-3" />{v.completedAt ? format(new Date(v.completedAt), 'MMM d, yyyy') : 'No date'}</span>
                    {v.jobId && <span>Job: {job ? `${job.title}${job.customerName ? ` · ${job.customerName}` : ''}` : `#${v.jobId}`}</span>}
                  </div>
                  {v.shareUrl && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" data-testid={`button-copy-dh-link-${v.id}`}
                        title="Signups through this link are tied to this house and the employee who recorded it"
                        onClick={() => { navigator.clipboard.writeText(v.shareUrl!).then(() => toast.success('Door hanger link copied'), () => toast.error('Could not copy link')); }}>
                        <Link2 className="w-3.5 h-3.5" /> Copy house link
                      </Button>
                      <span className="text-[11px] text-muted-foreground">Signups via this link credit this house and employee.</span>
                  </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
