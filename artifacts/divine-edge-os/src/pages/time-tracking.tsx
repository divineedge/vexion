import React, { useState, useEffect } from 'react';
import {
  useGetMasterClock, getGetMasterClockQueryKey,
  useStartMasterClock, useStopMasterClock,
  useListSubTimers, getListSubTimersQueryKey,
  useStartSubTimer, useStopSubTimer,
  useListTimeEntries, getListTimeEntriesQueryKey,
  useGetTodaySchedule, getGetTodayScheduleQueryKey,
  useUpdateJob,
  useUpdateVisit,
  useListUsers, getListUsersQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  customFetch,
  SubTimer,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Clock, Play, Square, Timer, History, ClipboardList, AlertTriangle,
  MapPin, User, CalendarClock, CheckCircle2,
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DailyTaskEntry {
  completionId: number;
  bundleId: number;
  bundleName: string | null;
  durationSeconds: number;
  startedAt: string;
  completedAt: string | null;
  hasFlags: boolean;
}

interface DailyTaskHoursResponse {
  userId: number;
  date: string;
  totalSeconds: number;
  totalMinutes: number;
  entries: DailyTaskEntry[];
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${m}m`;
}

function formatElapsedSeconds(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="font-mono tabular-nums text-sm">{formatElapsedSeconds(elapsed)}</span>;
}

export default function TimeTrackingPage() {
  const { canManageOffice, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: tenantSettings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  // "Today" in the tenant's timezone (falls back to the browser's zone).
  const today = (() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tenantSettings?.timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch { return new Date().toLocaleDateString('en-CA'); }
  })();
  // Historical date for timesheet review / adjustments. Live clock controls always use today.
  const [viewDateOverride, setViewDateOverride] = useState<string | null>(null);
  const viewDate = viewDateOverride ?? today;
  const isViewingToday = viewDate === today;
  const shiftViewDate = (days: number) => {
    const d = new Date(`${viewDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    const next = d.toLocaleDateString('en-CA');
    setViewDateOverride(next >= today ? null : next);
  };
  const viewDateLabel = isViewingToday ? 'Today' : new Date(`${viewDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(user?.id);
  const { data: staffUsers = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: canManageOffice } });

  const { data: masterClock } = useGetMasterClock({ query: { queryKey: getGetMasterClockQueryKey() } });
  const { data: schedule, isLoading: scheduleLoading } = useGetTodaySchedule(undefined, {
    query: { queryKey: getGetTodayScheduleQueryKey(), refetchInterval: 10000 },
  });
  const { data: todayEntries } = useListTimeEntries(
    { date: viewDate, ...(canManageOffice && selectedUserId ? { userId: selectedUserId } : {}) },
    { query: { queryKey: getListTimeEntriesQueryKey({ date: viewDate, ...(canManageOffice && selectedUserId ? { userId: selectedUserId } : {}) }) } }
  );
  const { data: subTimers } = useListSubTimers({
    query: { queryKey: getListSubTimersQueryKey(), refetchInterval: 15000 },
  });

  const { data: dailyTaskHours } = useQuery<DailyTaskHoursResponse>({
    queryKey: ['daily-task-hours', viewDate],
    queryFn: () => customFetch<DailyTaskHoursResponse>(`/api/time-tracking/daily-task-hours?date=${viewDate}`),
  });

  const startMaster = useStartMasterClock();
  const stopMaster = useStopMasterClock();
  const startSub = useStartSubTimer();
  const stopSub = useStopSubTimer();
  const updateJob = useUpdateJob();
  const updateVisit = useUpdateVisit();

  // After clocking out, optionally mark the job/visit complete
  const [completePrompt, setCompletePrompt] = useState<{
    timerId: number; label: string; kind: string; id: number;
  } | null>(null);

  // Track which schedule items recorded a late arrival after clock-out
  const [lateItemIds, setLateItemIds] = useState<Map<string, number>>(new Map()); // key=`${kind}-${id}`, val=lateByMinutes

  const [liveMasterSeconds, setLiveMasterSeconds] = useState(0);
  const [adjustingEntry, setAdjustingEntry] = useState<any | null>(null);
  const [adjustmentStart, setAdjustmentStart] = useState('');
  const [adjustmentEnd, setAdjustmentEnd] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  const openAdjustment = (entry: any) => {
    const toLocalInput = (value: string) => {
      const date = new Date(value);
      const offset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    };
    setAdjustingEntry(entry);
    setAdjustmentStart(toLocalInput(entry.effectiveClockedInAt ?? entry.clockedInAt));
    setAdjustmentEnd(toLocalInput(entry.effectiveClockedOutAt ?? entry.clockedOutAt));
    setAdjustmentReason('');
  };

  const saveAdjustment = async () => {
    if (!adjustingEntry || !adjustmentReason.trim()) return;
    setSavingAdjustment(true);
    try {
      await customFetch(`/api/time-tracking/entries/${adjustingEntry.id}/adjust`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustedClockedInAt: new Date(adjustmentStart).toISOString(),
          adjustedClockedOutAt: new Date(adjustmentEnd).toISOString(),
          reason: adjustmentReason.trim(),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey({ date: viewDate, ...(canManageOffice && selectedUserId ? { userId: selectedUserId } : {}) }) });
      await queryClient.invalidateQueries({ queryKey: ['daily-task-hours', viewDate] });
      await queryClient.invalidateQueries({ queryKey: getGetMasterClockQueryKey() });
      await queryClient.invalidateQueries({ queryKey: ['/api/time-tracking/clock-in-hours/summary'] });
      setAdjustingEntry(null);
      toast.success('Clocked time adjusted and audit history recorded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not adjust clocked time.');
    } finally {
      setSavingAdjustment(false);
    }
  };

  useEffect(() => {
    if (masterClock?.isClockedIn && masterClock.clockedInAt) {
      const start = new Date(masterClock.clockedInAt).getTime();
      const updateTimer = () => {
        setLiveMasterSeconds(Math.floor((Date.now() - start) / 1000));
      };
      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setLiveMasterSeconds(0);
      return undefined;
    }
  }, [masterClock]);

  const handleMasterToggle = () => {
    if (masterClock?.isClockedIn) {
      stopMaster.mutate({}, { onSuccess: invalidateAll });
    } else {
      startMaster.mutate({}, { onSuccess: invalidateAll });
    }
  };

  const handleClockIn = (item: { kind: string; id: number; label: string }) => {
    const label = item.kind === 'job'
      ? item.label
      : `visit:${item.id}:${item.label}`;
    const type = item.kind === 'job' ? 'job' : 'routine';
    const jobId = item.kind === 'job' ? item.id : undefined;
    startSub.mutate(
      { data: { label, type, ...(jobId !== undefined && { jobId }) } },
      { onSuccess: () => { invalidateAll(); toast.success(`Clocked in: ${item.label}`); } }
    );
  };

  // Clock out → prompt whether to also mark the job/visit complete
  const handleClockOut = (timerId: number, label: string, item: any) => {
    setCompletePrompt({ timerId, label, kind: item.kind, id: item.id });
  };

  const handleConfirmClockOut = (markComplete: boolean) => {
    if (!completePrompt) return;
    const { timerId, label, kind, id } = completePrompt;
    setCompletePrompt(null);
    stopSub.mutate(
      { id: timerId },
      {
        onSuccess: (data: SubTimer) => {
          invalidateAll();
          toast.success(`Clocked out: ${label}`);
          // Track late arrivals so we can surface the badge on the schedule row
          const d = data as SubTimer & { isLateArrival?: boolean; lateByMinutes?: number };
          if (d.isLateArrival && d.lateByMinutes != null) {
            setLateItemIds(prev => {
              const next = new Map(prev);
              next.set(`${kind}-${id}`, d.lateByMinutes!);
              return next;
            });
            toast.warning(`Late arrival detected — ${d.lateByMinutes} min past scheduled time`);
          }
          if (markComplete) {
            if (kind === 'job') {
              updateJob.mutate(
                { id, data: { status: 'completed' } as any },
                { onSuccess: () => { invalidateAll(); toast.success('Job marked complete'); } }
              );
            } else {
              updateVisit.mutate(
                { id, data: { completedAt: new Date().toISOString() } as any },
                { onSuccess: () => { invalidateAll(); toast.success('Visit marked complete'); } }
              );
            }
          }
        },
      }
    );
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetMasterClockQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSubTimersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayScheduleQueryKey() });
  };

  const isBusy = startSub.isPending || stopSub.isPending;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1>
        <p className="text-muted-foreground mt-1">Clock in for the day, then clock in/out of each job as you go.</p>
      </div>

      {/* ── Master clock ─────────────────────────────────────────────────────── */}
      <Card className={`border-2 ${masterClock?.isClockedIn ? 'border-primary shadow-primary/20 shadow-lg' : ''} transition-all`}>
        <CardContent className="p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white shadow-inner ${masterClock?.isClockedIn ? 'bg-primary' : 'bg-muted-foreground'}`}>
              <Clock className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Day Clock</h2>
              <p className="text-muted-foreground font-medium mt-1">
                {masterClock?.isClockedIn ? 'Currently Clocked In' : 'Currently Clocked Out'}
              </p>
              {masterClock?.isClockedIn && (
                <div className="mt-2 text-3xl font-mono tabular-nums tracking-tight">
                  {formatElapsedSeconds(liveMasterSeconds)}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <Button
              size="lg"
              className={`h-16 px-10 text-lg gap-3 rounded-full transition-transform active:scale-95 ${masterClock?.isClockedIn ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-primary hover:bg-primary/90 text-white'}`}
              onClick={handleMasterToggle}
              disabled={startMaster.isPending || stopMaster.isPending}
            >
              {masterClock?.isClockedIn ? (
                <><Square className="w-5 h-5 fill-current" /> CLOCK OUT</>
              ) : (
                <><Play className="w-5 h-5 fill-current" /> CLOCK IN</>
              )}
            </Button>
            <p className="text-sm text-muted-foreground font-medium mt-2">
              Total Today: {formatDuration(masterClock?.totalMinutesToday || 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Today's Schedule ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="w-5 h-5" /> Today's Schedule
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clock in to a job or visit — only one can be active at a time.
          </p>
        </CardHeader>
        <CardContent>
          {scheduleLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm border rounded-lg border-dashed">
              Loading schedule…
            </div>
          ) : !schedule || schedule.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm border rounded-lg border-dashed">
              No jobs or visits scheduled for today.
            </div>
          ) : (
            <div className="space-y-2">
              {[...(schedule as any[])].sort((a, b) => {
                // Active items first
                if (a.activeTimerId != null && b.activeTimerId == null) return -1;
                if (a.activeTimerId == null && b.activeTimerId != null) return 1;
                // Completed/cancelled/invoiced sink to the bottom
                const DONE = ['completed', 'cancelled', 'invoiced', 'no_show'];
                const aDone = DONE.includes(a.status);
                const bDone = DONE.includes(b.status);
                if (!aDone && bDone) return -1;
                if (aDone && !bDone) return 1;
                // Within same tier, sort by scheduled time
                return new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime();
              }).map((item: any) => {
                const isActive = item.activeTimerId != null;
                const isDone = ['completed', 'cancelled', 'invoiced', 'no_show'].includes(item.status);
                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                      isActive
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : isDone
                          ? 'border-border bg-muted/10 opacity-50'
                          : 'border-border bg-muted/20 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        isActive ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                      }`}>
                        {item.kind === 'job' ? 'J' : 'V'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{item.label}</p>
                          {isActive && (
                            <Badge variant="default" className="text-xs gap-1 animate-pulse">
                              <Timer className="w-3 h-3" />
                              Active
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs capitalize">
                            {item.status.replace(/_/g, ' ')}
                          </Badge>
                          {lateItemIds.has(`${item.kind}-${item.id}`) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="destructive" className="text-xs gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Late {lateItemIds.get(`${item.kind}-${item.id}`)}m
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Employee arrived late for this job</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime(item.scheduledAt)}
                          </span>
                          {item.customerName && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                              <User className="w-3 h-3 flex-shrink-0" />
                              {item.customerName}
                            </span>
                          )}
                          {item.propertyAddress && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {item.propertyAddress}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      {isActive && item.activeTimerStartedAt && (
                        <LiveTimer startedAt={item.activeTimerStartedAt} />
                      )}
                      {isActive ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1.5"
                          onClick={() => handleClockOut(item.activeTimerId!, item.label, item)}
                          disabled={isBusy}
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                          Clock Out
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-primary/50 text-primary hover:bg-primary/10"
                          onClick={() => handleClockIn(item)}
                          disabled={isBusy}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Clock In
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Clock-out completion prompt ──────────────────────────────────────── */}
      <Dialog open={!!completePrompt} onOpenChange={open => { if (!open) setCompletePrompt(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              Mark as Complete?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You've clocked out of <strong>{completePrompt?.label}</strong>. Do you want to mark it as complete?
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => handleConfirmClockOut(false)} disabled={stopSub.isPending}>
              No, just clock out
            </Button>
            <Button onClick={() => handleConfirmClockOut(true)} disabled={stopSub.isPending} className="gap-2">
              <CheckCircle2 className="w-4 h-4" /> Yes, mark complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Today's Entries ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg"><History className="w-5 h-5" /> {isViewingToday ? "Today's Entries" : `Entries for ${viewDateLabel}`}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Timesheet date">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftViewDate(-1)} aria-label="Previous day" title="Previous day">&lsaquo;</Button>
              <Input type="date" className="h-8 w-[150px]" value={viewDate} max={today} aria-label="Choose timesheet date"
                onChange={e => { const v = e.target.value; if (!v) return; setViewDateOverride(v >= today ? null : v); }} data-testid="input-timesheet-date" />
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftViewDate(1)} disabled={isViewingToday} aria-label="Next day" title="Next day">&rsaquo;</Button>
              {!isViewingToday && <Button variant="ghost" size="sm" className="h-8" onClick={() => setViewDateOverride(null)}>Today</Button>}
            </div>
            {canManageOffice && (
              <Select value={String(selectedUserId ?? user?.id ?? '')} onValueChange={value => setSelectedUserId(Number(value))}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                <SelectContent>
                  {staffUsers.map(staff => <SelectItem key={staff.id} value={String(staff.id)}>{staff.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            </div>
          </div>
          {!isViewingToday && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 w-fit">
              Reviewing a past day. Adjustments keep the original punches and record an audit entry. Live clock controls above still act on today.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                {canManageOffice && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayEntries?.map((entry: any) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    {entry.adjustedClockedInAt && <span className="line-through text-muted-foreground mr-2">{formatTime(entry.clockedInAt)}</span>}
                    <span className={entry.adjustedClockedInAt ? 'font-medium text-blue-600' : ''}>{formatTime(entry.effectiveClockedInAt ?? entry.clockedInAt)}</span>
                  </TableCell>
                  <TableCell>
                    {entry.clockedOutAt ? <>
                      {entry.adjustedClockedOutAt && <span className="line-through text-muted-foreground mr-2">{formatTime(entry.clockedOutAt)}</span>}
                      <span className={entry.adjustedClockedOutAt ? 'font-medium text-blue-600' : ''}>{formatTime(entry.effectiveClockedOutAt ?? entry.clockedOutAt)}</span>
                    </> : <span className="text-primary animate-pulse text-xs font-medium">ACTIVE</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatDuration(entry.totalMinutes)}</TableCell>
                  {canManageOffice && <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={!entry.clockedOutAt} onClick={() => openAdjustment(entry)}>Adjust</Button>
                  </TableCell>}
                </TableRow>
              ))}
              {(!todayEntries || todayEntries.length === 0) && (
                <TableRow>
                  <TableCell colSpan={canManageOffice ? 4 : 3} className="text-center py-6 text-muted-foreground text-sm">{isViewingToday ? 'No entries today.' : `No entries on ${viewDateLabel}.`}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!adjustingEntry} onOpenChange={(open) => !open && setAdjustingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust completed clock entry</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">The recorded timestamps remain unchanged. Payroll and reports will use the adjusted values.</p>
          {adjustingEntry && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium mb-1">Recorded time (unchanged)</div>
              <div>{formatTime(adjustingEntry.clockedInAt)} – {formatTime(adjustingEntry.clockedOutAt)}</div>
              {(adjustingEntry.adjustedClockedInAt || adjustingEntry.adjustedClockedOutAt) && (
                <div className="text-muted-foreground mt-1">Current effective time: {formatTime(adjustingEntry.effectiveClockedInAt)} – {formatTime(adjustingEntry.effectiveClockedOutAt)}</div>
              )}
            </div>
          )}
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label htmlFor="adjust-start">Adjusted clock-in</Label><Input id="adjust-start" type="datetime-local" value={adjustmentStart} onChange={e => setAdjustmentStart(e.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="adjust-end">Adjusted clock-out</Label><Input id="adjust-end" type="datetime-local" value={adjustmentEnd} onChange={e => setAdjustmentEnd(e.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="adjust-reason">Reason (required)</Label><Textarea id="adjust-reason" value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} placeholder="Explain why this correction is needed" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustingEntry(null)}>Cancel</Button>
            <Button onClick={saveAdjustment} disabled={savingAdjustment || !adjustmentStart || !adjustmentEnd || !adjustmentReason.trim()}>{savingAdjustment ? 'Saving…' : 'Save adjustment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sub-timer Log ────────────────────────────────────────────────────── */}
      {subTimers && subTimers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Timer className="w-5 h-5" /> Job / Visit Timers
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live: individual clock-in records for each job or visit today.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subTimers.map((st) => {
                  const hasLocation = (st as any).startLat != null || (st as any).endLat != null;
                  const isLate = st.isLateArrival;
                  const adjustedStart = (st as any).adjustedStartedAt as string | null | undefined;
                  const adjustedEnd = (st as any).adjustedStoppedAt as string | null | undefined;
                  return (
                    <TableRow key={st.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm">{st.label}</span>
                          {hasLocation && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <MapPin className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent>GPS location captured</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className={adjustedStart ? 'line-through text-muted-foreground mr-1.5' : ''}>
                          {formatTime(st.startedAt)}
                        </span>
                        {adjustedStart && (
                          <span className="text-blue-600 font-medium">{formatTime(adjustedStart)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {st.stoppedAt ? (
                          <>
                            <span className={adjustedEnd ? 'line-through text-muted-foreground mr-1.5' : ''}>
                              {formatTime(st.stoppedAt)}
                            </span>
                            {adjustedEnd && (
                              <span className="text-blue-600 font-medium">{formatTime(adjustedEnd)}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-primary animate-pulse text-xs font-medium">ACTIVE</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {st.elapsedSeconds != null ? formatElapsedSeconds(st.elapsedSeconds) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isLate && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="destructive" className="text-xs gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Late {st.lateByMinutes}m
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Arrived {st.lateByMinutes} min past scheduled time
                                  {adjustedStart ? ' · Time adjusted' : ''}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {!isLate && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Daily Task Time ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="w-5 h-5" /> Daily Task Time{!isViewingToday && <span className="text-sm font-normal text-muted-foreground"> · {viewDateLabel}</span>}
            </CardTitle>
            {(dailyTaskHours?.totalSeconds ?? 0) > 0 && (
              <span className="text-sm font-semibold text-primary">
                {formatDuration(dailyTaskHours?.totalMinutes ?? 0)} {isViewingToday ? 'today' : `on ${viewDateLabel}`}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Time spent completing Daily Task bundles — counted toward your total hours worked today.
          </p>
        </CardHeader>
        <CardContent>
          {(dailyTaskHours?.entries.length ?? 0) === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg border-dashed">
              {isViewingToday ? 'No daily task runs completed today.' : `No daily task runs on ${viewDateLabel}.`}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bundle</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyTaskHours?.entries.map(entry => (
                  <TableRow key={entry.completionId}>
                    <TableCell className="font-medium text-sm">{entry.bundleName ?? `Bundle #${entry.bundleId}`}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.completedAt
                        ? new Date(entry.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatElapsedSeconds(entry.durationSeconds)}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.hasFlags
                        ? <Badge variant="destructive" className="gap-1 text-xs"><AlertTriangle className="w-3 h-3" />Flagged</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="px-4 py-2 text-sm font-semibold" colSpan={2}>
                    {dailyTaskHours?.entries.length} run{(dailyTaskHours?.entries.length ?? 0) !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-2 text-right text-sm font-bold text-primary">
                    {formatDuration(dailyTaskHours?.totalMinutes ?? 0)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
