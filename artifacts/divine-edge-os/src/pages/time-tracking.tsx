import React, { useState, useEffect } from 'react';
import {
  useGetMasterClock, getGetMasterClockQueryKey,
  useStartMasterClock, useStopMasterClock,
  useListSubTimers, getListSubTimersQueryKey,
  useStartSubTimer, useStopSubTimer,
  useListTimeEntries, getListTimeEntriesQueryKey,
  useGetTodaySchedule, getGetTodayScheduleQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Clock, Play, Square, Timer, History, ClipboardList, AlertTriangle,
  MapPin, User, CalendarClock,
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

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
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];

  const { data: masterClock } = useGetMasterClock({ query: { queryKey: getGetMasterClockQueryKey() } });
  const { data: schedule, isLoading: scheduleLoading } = useGetTodaySchedule({
    query: { queryKey: getGetTodayScheduleQueryKey(), refetchInterval: 10000 },
  });
  const { data: todayEntries } = useListTimeEntries(
    { date: today },
    { query: { queryKey: getListTimeEntriesQueryKey({ date: today }) } }
  );

  const { data: dailyTaskHours } = useQuery<DailyTaskHoursResponse>({
    queryKey: ['daily-task-hours', today],
    queryFn: () => customFetch<DailyTaskHoursResponse>(`/api/time-tracking/daily-task-hours?date=${today}`),
  });

  const startMaster = useStartMasterClock();
  const stopMaster = useStopMasterClock();
  const startSub = useStartSubTimer();
  const stopSub = useStopSubTimer();

  const [liveMasterSeconds, setLiveMasterSeconds] = useState(0);

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
      stopMaster.mutate(undefined, { onSuccess: invalidateAll });
    } else {
      startMaster.mutate(undefined, { onSuccess: invalidateAll });
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

  const handleClockOut = (timerId: number, label: string) => {
    stopSub.mutate(
      { id: timerId },
      { onSuccess: () => { invalidateAll(); toast.success(`Clocked out: ${label}`); } }
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
              {schedule.map((item: any) => {
                const isActive = item.activeTimerId != null;
                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                      isActive
                        ? 'border-primary bg-primary/5 shadow-sm'
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
                          onClick={() => handleClockOut(item.activeTimerId!, item.label)}
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

      {/* ── Today's Entries ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><History className="w-5 h-5" /> Today's Entries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayEntries?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{new Date(entry.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                  <TableCell>{entry.clockedOutAt ? new Date(entry.clockedOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="text-primary animate-pulse text-xs font-medium">ACTIVE</span>}</TableCell>
                  <TableCell className="text-right font-medium">{formatDuration(entry.totalMinutes)}</TableCell>
                </TableRow>
              ))}
              {(!todayEntries || todayEntries.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-6 text-muted-foreground text-sm">No entries today.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Daily Task Time ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="w-5 h-5" /> Daily Task Time
            </CardTitle>
            {(dailyTaskHours?.totalSeconds ?? 0) > 0 && (
              <span className="text-sm font-semibold text-primary">
                {formatDuration(dailyTaskHours?.totalMinutes ?? 0)} today
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
              No daily task runs completed today.
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
