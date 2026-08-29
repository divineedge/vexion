import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetJobQueryKey,
  getGetTodayScheduleQueryKey,
  getListJobsQueryKey,
  getListSubTimersQueryKey,
  getListTimeEntriesQueryKey,
  ScheduleItem,
  SubTimer,
  useAdjustSubTimer,
  useCreateGeofenceEntry,
  useGetTodaySchedule,
  useListSubTimers,
  useStartSubTimer,
  useStopSubTimer,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { formatElapsed, getClockLocation, haversineMetres } from '@/utils/timeTracking';
import { mergeFallbackJobs, optimisticClockIn, optimisticClockOut } from '@/utils/jobTimeClockState';
import { tenantDateKey } from '@/utils/schedule';

type ClockJob = ScheduleItem & { kind: 'job' };

function LiveElapsed({ startedAt, fallback }: { startedAt: string; fallback: number }) {
  const [seconds, setSeconds] = useState(fallback);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return <Text style={styles.elapsed}>{formatElapsed(seconds)}</Text>;
}

export function JobTimeClockModal({
  visible,
  date,
  timezone,
  isOffline,
  fallbackJobs,
  onClose,
}: {
  visible: boolean;
  date: string;
  timezone: string;
  isOffline: boolean;
  fallbackJobs: Array<{ id: number; title: string; scheduledAt: string; status: string; customerName?: string | null; propertyAddress?: string | null }>;
  onClose: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ date }), [date]);
  const scheduleKey = getGetTodayScheduleQueryKey(params);
  const { data, isLoading, isError } = useGetTodaySchedule(params, {
    query: { queryKey: scheduleKey, enabled: visible && !isOffline },
  });
  const { data: activeTimers } = useListSubTimers({
    query: { queryKey: getListSubTimersQueryKey(), enabled: visible && !isOffline },
  });
  const startTimer = useStartSubTimer();
  const stopTimer = useStopSubTimer();
  const adjustTimer = useAdjustSubTimer();
  const createGeofenceEntry = useCreateGeofenceEntry();
  const [busyJobId, setBusyJobId] = useState<number | null>(null);
  const [switchJob, setSwitchJob] = useState<ClockJob | null>(null);
  const reported = useRef<Set<number>>(new Set());

  const fallback = useMemo<ClockJob[]>(() => mergeFallbackJobs(fallbackJobs.map(job => ({
    kind: 'job',
    id: job.id,
    label: job.title,
    scheduledAt: job.scheduledAt,
    customerName: job.customerName ?? null,
    propertyAddress: job.propertyAddress ?? null,
    status: job.status,
    activeTimerId: null,
    activeTimerStartedAt: null,
    elapsedSeconds: 0,
  })), activeTimers as SubTimer[] | undefined), [fallbackJobs, activeTimers]);
  const jobs = useMemo(
    () => ((data as ScheduleItem[] | undefined)?.filter((item): item is ClockJob => item.kind === 'job') ?? fallback),
    [data, fallback],
  );
  const active = (activeTimers as SubTimer[] | undefined)?.[0] ?? null;

  const invalidate = useCallback((jobIds: number[]) => {
    // Invalidate all selected-day schedule variants; an active timer can be visible
    // in a cached previous or next day after the technician changes dates.
    void queryClient.invalidateQueries({ queryKey: getGetTodayScheduleQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSubTimersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    jobIds.forEach(id => void queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) }));
  }, [queryClient, scheduleKey]);

  useEffect(() => {
    if (!visible || isOffline || date !== tenantDateKey(new Date(), timezone)) return;
    void (async () => {
      const location = await getClockLocation();
      if (!location) return;
      for (const item of jobs) {
        if (item.propertyId == null || reported.current.has(item.propertyId)
          || item.propertyGeofenceLat == null || item.propertyGeofenceLng == null || item.propertyGeofenceRadius == null) continue;
        if (haversineMetres(location.lat, location.lng, item.propertyGeofenceLat, item.propertyGeofenceLng) > item.propertyGeofenceRadius) continue;
        reported.current.add(item.propertyId);
        createGeofenceEntry.mutate({ data: { propertyId: item.propertyId, jobId: item.id, lat: location.lat, lng: location.lng } });
      }
    })();
  }, [visible, isOffline, date, timezone, jobs, createGeofenceEntry]);

  const optimisticStart = useCallback(async (job: ClockJob) => {
    let previous: ScheduleItem[] | undefined;
    let optimisticApplied = false;
    try {
      const location = await getClockLocation();
      setBusyJobId(job.id);
      await queryClient.cancelQueries({ queryKey: scheduleKey });
      previous = queryClient.getQueryData<ScheduleItem[]>(scheduleKey);
      const now = new Date().toISOString();
      queryClient.setQueryData<ScheduleItem[]>(scheduleKey, old => optimisticClockIn(old, job.id, now));
      optimisticApplied = true;
      startTimer.mutate(
      { data: { label: job.label, type: 'job', jobId: job.id, ...(location ?? {}) } },
      {
        onSuccess: () => {
          const previousJob = active?.jobId ? jobs.find(item => item.id === active.jobId) : null;
          if (active?.isLateArrival && previousJob?.scheduledAt) {
            Alert.alert('Previous job was clocked out', `"${active.label}" was a late arrival. Keep the recorded time, or use its scheduled arrival time?`, [
              { text: 'Keep Recorded', style: 'cancel' },
              { text: 'Use Scheduled Time', onPress: () => adjustTimer.mutate({
                id: active.id, data: { adjustedStartedAt: previousJob.scheduledAt! },
              }, { onSettled: () => invalidate([previousJob.id]) }) },
            ]);
          }
        },
        onError: (error) => {
          queryClient.setQueryData(scheduleKey, previous);
          Alert.alert('Clock in failed', error.message || 'Your timer was not changed.');
        },
        onSettled: () => {
          setBusyJobId(null);
          invalidate([job.id, ...(active?.jobId ? [active.jobId] : [])]);
        },
      },
      );
    } catch (error) {
      if (optimisticApplied) queryClient.setQueryData(scheduleKey, previous);
      setBusyJobId(null);
      Alert.alert('Clock in failed', error instanceof Error ? error.message : 'Your timer was not changed.');
    }
  }, [active, adjustTimer, invalidate, jobs, queryClient, scheduleKey, startTimer]);

  const clockIn = useCallback((job: ClockJob) => {
    if (isOffline) { Alert.alert('Offline', 'Connect to the internet to clock in or out.'); return; }
    if (active && active.jobId !== job.id) {
      setSwitchJob(job);
      return;
    }
    void optimisticStart(job);
  }, [active, isOffline, optimisticStart]);

  const clockOut = useCallback(async (job: ClockJob) => {
    if (!job.activeTimerId || job.activeTimerId < 0) return;
    if (isOffline) { Alert.alert('Offline', 'Connect to the internet to clock in or out.'); return; }
    let previous: ScheduleItem[] | undefined;
    let optimisticApplied = false;
    try {
      const location = await getClockLocation();
      setBusyJobId(job.id);
      await queryClient.cancelQueries({ queryKey: scheduleKey });
      previous = queryClient.getQueryData<ScheduleItem[]>(scheduleKey);
      queryClient.setQueryData<ScheduleItem[]>(scheduleKey, old => optimisticClockOut(old, job.id));
      optimisticApplied = true;
      stopTimer.mutate(
      { id: job.activeTimerId, data: location ?? undefined },
      {
        onSuccess: (timer) => {
          const stopped = timer as SubTimer & { jobScheduledAt?: string | null };
          if (stopped.isLateArrival && stopped.jobScheduledAt && stopped.stoppedAt) {
            Alert.alert('Late arrival detected', 'Keep the recorded time, or adjust clock-in to the scheduled arrival time?', [
              { text: 'Keep Recorded', style: 'cancel' },
              { text: 'Use Scheduled Time', onPress: () => adjustTimer.mutate({
                id: stopped.id, data: { adjustedStartedAt: stopped.jobScheduledAt! },
              }, { onSettled: () => invalidate([job.id]) }) },
            ]);
          }
        },
        onError: (error) => {
          queryClient.setQueryData(scheduleKey, previous);
          Alert.alert('Clock out failed', error.message || 'Your timer was not changed.');
        },
        onSettled: () => { setBusyJobId(null); invalidate([job.id]); },
      },
      );
    } catch (error) {
      if (optimisticApplied) queryClient.setQueryData(scheduleKey, previous);
      setBusyJobId(null);
      Alert.alert('Clock out failed', error instanceof Error ? error.message : 'Your timer was not changed.');
    }
  }, [adjustTimer, invalidate, isOffline, queryClient, scheduleKey, stopTimer]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>Job Time Clock</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{date}</Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="job-time-clock-close"><Ionicons name="close" size={24} color={colors.foreground} /></TouchableOpacity>
          </View>
          {isOffline && <Text style={styles.offline}>Offline · Timers are disabled. Showing cached jobs.</Text>}
          {switchJob && active && (
            <View style={[styles.confirmation, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.confirmationTitle, { color: colors.foreground }]}>Switch job timer?</Text>
              <Text style={[styles.confirmationText, { color: colors.mutedForeground }]}>
                {active.jobId == null ? `The active routine timer "${active.label}"` : `"${active.label}"`} will stop before "{switchJob.label}" starts. Your day clock stays unchanged.
              </Text>
              <View style={styles.confirmationActions}>
                <TouchableOpacity testID="job-clock-switch-cancel" onPress={() => setSwitchJob(null)} style={[styles.confirmationButton, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="job-clock-switch-confirm" onPress={() => { const job = switchJob; setSwitchJob(null); void optimisticStart(job); }} style={[styles.confirmationButton, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryForeground }}>Switch &amp; Clock In</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <FlatList
            data={jobs}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={isLoading ? <ActivityIndicator color={colors.primary} /> : (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>{isError ? 'Could not refresh jobs.' : 'No jobs scheduled.'}</Text>
            )}
            renderItem={({ item }) => {
              const running = item.activeTimerId != null;
              const busy = busyJobId === item.id;
              return (
                <View style={[styles.row, { borderColor: running ? colors.primary : colors.border, backgroundColor: running ? colors.primary + '10' : colors.card }]}>
                  <View style={styles.info}>
                    <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>{item.label}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.scheduledAt ? new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}
                      {item.customerName ? ` · ${item.customerName}` : ''}
                    </Text>
                  </View>
                  {running && item.activeTimerStartedAt && <LiveElapsed startedAt={item.activeTimerStartedAt} fallback={item.elapsedSeconds ?? 0} />}
                  <TouchableOpacity
                    disabled={busyJobId !== null || isOffline}
                    testID={`job-clock-${running ? 'out' : 'in'}-${item.id}`}
                    onPress={() => running ? void clockOut(item) : clockIn(item)}
                    style={[styles.button, { backgroundColor: running ? '#ef444418' : colors.primary + '18', opacity: isOffline || (busyJobId !== null && !busy) ? 0.45 : 1 }]}
                  >
                    {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: running ? '#ef4444' : colors.primary, fontWeight: '600' }}>{running ? 'Clock Out' : 'Clock In'}</Text>}
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '76%', minHeight: 260, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1 },
  header: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  offline: { backgroundColor: '#92400e', color: '#fef3c7', paddingHorizontal: 16, paddingVertical: 8, fontSize: 12 },
  list: { padding: 12, gap: 8 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  info: { flex: 1, minWidth: 0 },
  jobTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  elapsed: { color: '#2563eb', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  button: { minWidth: 78, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  empty: { textAlign: 'center', paddingVertical: 36 },
  confirmation: { margin: 12, marginBottom: 0, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  confirmationTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  confirmationText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  confirmationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmationButton: { minHeight: 38, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});