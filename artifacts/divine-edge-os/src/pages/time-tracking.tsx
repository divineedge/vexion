import React, { useState, useEffect } from 'react';
import { 
  useGetMasterClock, getGetMasterClockQueryKey,
  useStartMasterClock, useStopMasterClock,
  useListSubTimers, getListSubTimersQueryKey,
  useStopSubTimer,
  useListTimeEntries, getListTimeEntriesQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, Square, Timer, History, ClipboardList, AlertTriangle } from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

export default function TimeTrackingPage() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];
  
  const { data: masterClock } = useGetMasterClock({ query: { queryKey: getGetMasterClockQueryKey() }});
  const { data: subTimers } = useListSubTimers({ query: { queryKey: getListSubTimersQueryKey() }});
  const { data: todayEntries } = useListTimeEntries(
    { date: today },
    { query: { queryKey: getListTimeEntriesQueryKey({ date: today }) }}
  );

  const { data: dailyTaskHours } = useQuery<DailyTaskHoursResponse>({
    queryKey: ['daily-task-hours', today],
    queryFn: () => customFetch<DailyTaskHoursResponse>(`/api/time-tracking/daily-task-hours?date=${today}`),
  });

  const startMaster = useStartMasterClock();
  const stopMaster = useStopMasterClock();
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

  const handleStopSub = (id: number) => {
    stopSub.mutate({ id }, { onSuccess: invalidateAll });
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetMasterClockQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSubTimersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
  };

  const activeSubTimers = subTimers?.filter(t => t.isActive) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1>
        <p className="text-muted-foreground mt-1">Clock in for the day and track time to specific jobs.</p>
      </div>

      <Card className={`border-2 ${masterClock?.isClockedIn ? 'border-primary shadow-primary/20 shadow-lg' : ''} transition-all`}>
        <CardContent className="p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white shadow-inner ${masterClock?.isClockedIn ? 'bg-primary' : 'bg-muted-foreground'}`}>
              <Clock className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Master Clock</h2>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Timer className="w-5 h-5" /> Active Job Timers</CardTitle>
          </CardHeader>
          <CardContent>
            {activeSubTimers.length > 0 ? (
              <div className="space-y-3">
                {activeSubTimers.map(timer => (
                  <div key={timer.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                    <div>
                      <p className="font-semibold text-sm">{timer.label}</p>
                      <p className="text-xs text-muted-foreground capitalize mt-0.5">{timer.type}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm bg-background px-2 py-1 rounded border shadow-sm">
                        {formatElapsedSeconds(timer.elapsedSeconds || 0)}
                      </span>
                      <Button size="sm" variant="destructive" className="h-8 w-8 p-0 rounded-full" onClick={() => handleStopSub(timer.id)}>
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground text-sm border rounded-lg border-dashed">
                No active sub-timers.<br/>Start one from a Job or Routine.
              </div>
            )}
          </CardContent>
        </Card>

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
                    <TableCell>{new Date(entry.clockedInAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</TableCell>
                    <TableCell>{entry.clockedOutAt ? new Date(entry.clockedOutAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : <span className="text-primary animate-pulse text-xs font-medium">ACTIVE</span>}</TableCell>
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
      </div>

      {/* Daily Task Time ─────────────────────────────────────────────────── */}
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
