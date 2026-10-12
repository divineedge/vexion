import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetJobQueryKey,
  getGetMasterClockQueryKey,
  getGetTodayScheduleQueryKey,
  getListJobsQueryKey,
  getListSubTimersQueryKey,
  getListTimeEntriesQueryKey,
  ScheduleItem,
  SubTimer,
  useCompleteJob,
  useCreateGeofenceEntry,
  useGetTodaySchedule,
  useListSubTimers,
  useReopenJob,
  useStartSubTimer,
  useStopSubTimer,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { formatElapsed, getClockLocation, haversineMetres } from '@/utils/timeTracking';
import { mergeFallbackJobs, optimisticClockIn, optimisticClockOut } from '@/utils/jobTimeClockState';
import { tenantDateKey } from '@/utils/schedule';
import { openDirections } from '@/utils/directions';

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
  fallbackJobs: Array<{ id: number; title: string; scheduledAt: string; status: string; customerName?: string | null; propertyAddress?: string | null; serviceName?: string | null }>;
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
  const completeJob = useCompleteJob();
  const reopenJob = useReopenJob();
  const createGeofenceEntry = useCreateGeofenceEntry();
  const [busyJobId, setBusyJobId] = useState<number | null>(null);
  const [switchJob, setSwitchJob] = useState<ClockJob | null>(null);
  const [completionJob, setCompletionJob] = useState<ClockJob | null>(null);
  const [reopenCandidate, setReopenCandidate] = useState<ClockJob | null>(null);
  const reported = useRef<Set<number>>(new Set());

  const fallback = useMemo<ClockJob[]>(() => mergeFallbackJobs(fallbackJobs.map(job => ({
    kind: 'job',
    id: job.id,
    label: job.title,
    scheduledAt: job.scheduledAt,
    customerName: job.customerName ?? null,
    propertyAddress: job.propertyAddress ?? null,
    serviceName: job.serviceName ?? null,
    status: job.status,
    activeTimerId: null,
    activeTimerStartedAt: null,
    elapsedSeconds: 0,
  })), activeTimers as SubTimer[] | undefined), [fallbackJobs, activeTimers]);
  const jobs = useMemo(
    () => [...((data as ScheduleItem[] | undefined)?.filter((item): item is ClockJob => item.kind === 'job') ?? fallback)]
      .sort((a, b) => {
        const completionOrder = Number(a.status === 'completed') - Number(b.status === 'completed');
        if (completionOrder) return completionOrder;
        return new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime();
      }),
    [data, fallback],
  );
  const active = (activeTimers as SubTimer[] | undefined)?.[0] ?? null;

  const invalidate = useCallback((jobIds: number[]) => {
    // Invalidate all selected-day schedule variants; an active timer can be visible
    // in a cached previous or next day after the technician changes dates.
    void queryClient.invalidateQueries({ queryKey: getGetTodayScheduleQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSubTimersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMasterClockQueryKey() });
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
  }, [active, invalidate, queryClient, scheduleKey, startTimer]);

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
        onSuccess: () => setCompletionJob(job),
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
  }, [completeJob, invalidate, isOffline, queryClient, scheduleKey, stopTimer]);

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
          {completionJob && (
            <View style={[styles.confirmation, { borderColor: colors.statusCompleted + '50', backgroundColor: colors.statusCompleted + '0D' }]}>
              <Text style={[styles.confirmationTitle, { color: colors.foreground }]}>Mark Job Complete?</Text>
              <Text style={[styles.confirmationText, { color: colors.mutedForeground }]}>
                The recorded clock-in and clock-out times for “{completionJob.label}” have been saved. Is this job complete?
              </Text>
              <View style={styles.confirmationActions}>
                <TouchableOpacity
                  testID="job-clock-complete-not-yet"
                  onPress={() => setCompletionJob(null)}
                  style={[styles.confirmationButton, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground }}>Not yet</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="job-clock-complete-confirm"
                  disabled={completeJob.isPending}
                  onPress={() => {
                    const job = completionJob;
                    completeJob.mutate(
                      { id: job.id },
                      {
                        onSuccess: () => {
                          setCompletionJob(null);
                          invalidate([job.id]);
                        },
                        onError: (error) => Alert.alert('Unable to complete job', error.message || 'The job was not marked complete.'),
                      },
                    );
                  }}
                  style={[styles.confirmationButton, { backgroundColor: colors.statusCompleted, opacity: completeJob.isPending ? 0.55 : 1 }]}
                >
                  {completeJob.isPending
                    ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                    : <Text style={{ color: colors.primaryForeground }}>Mark Complete</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
          {reopenCandidate && (
            <View style={[styles.confirmation, { borderColor: colors.primary + '50', backgroundColor: colors.primary + '0D' }]}>
              <Text style={[styles.confirmationTitle, { color: colors.foreground }]}>Return Job to Scheduled?</Text>
              <Text style={[styles.confirmationText, { color: colors.mutedForeground }]}>
                Use this when “{reopenCandidate.label}” was marked complete by mistake. Existing time records and any draft invoice are kept.
              </Text>
              <View style={styles.confirmationActions}>
                <TouchableOpacity onPress={() => setReopenCandidate(null)} style={[styles.confirmationButton, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={reopenJob.isPending}
                  onPress={() => {
                    const job = reopenCandidate;
                    reopenJob.mutate({ id: job.id }, {
                      onSuccess: () => { setReopenCandidate(null); invalidate([job.id]); },
                      onError: (error) => Alert.alert('Unable to reopen job', error.message || 'The job was not changed.'),
                    });
                  }}
                  style={[styles.confirmationButton, { backgroundColor: colors.primary }]}
                >
                  <Text style={{ color: colors.primaryForeground }}>Return to Scheduled</Text>
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
              const completed = item.status === 'completed';
              return (
                <View style={[styles.row, { borderColor: running ? colors.primary : colors.border, backgroundColor: running ? colors.primary + '10' : colors.card, opacity: completed ? 0.68 : 1 }]}>
                  <View style={styles.info}>
                    <View style={styles.titleRow}>
                      <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>{item.label}</Text>
                      {completed ? (
                        <View style={[styles.completedBadge, { backgroundColor: colors.statusCompleted + '20' }]}>
                          <Ionicons name="checkmark-circle" size={12} color={colors.statusCompleted} />
                          <Text style={[styles.completedText, { color: colors.statusCompleted }]}>Completed</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.scheduledAt ? new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}
                      {item.customerName ? ` · ${item.customerName}` : ''}
                    </Text>
                    {item.serviceName ? (
                      <View style={styles.serviceRow}>
                        <Ionicons name="pricetag-outline" size={12} color={colors.mutedForeground} />
                        <Text style={[styles.serviceText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.serviceName}</Text>
                      </View>
                    ) : null}
                    {item.propertyAddress ? (
                      <TouchableOpacity
                        style={styles.addressRow}
                        onPress={() => void openDirections(item.propertyAddress!, (item as any).propertyLat, (item as any).propertyLng)}
                        accessibilityRole="link"
                        accessibilityLabel={`Get directions to ${item.propertyAddress}`}
                      >
                        <Ionicons name="navigate-outline" size={12} color={colors.primary} />
                        <Text style={[styles.addressText, { color: colors.primary }]} numberOfLines={1}>{item.propertyAddress}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {running && item.activeTimerStartedAt && <LiveElapsed startedAt={item.activeTimerStartedAt} fallback={item.elapsedSeconds ?? 0} />}
                  <TouchableOpacity
                    disabled={busyJobId !== null || isOffline}
                    testID={`job-clock-${running ? 'out' : 'in'}-${item.id}`}
                    onPress={() => running ? void clockOut(item) : completed ? setReopenCandidate(item) : clockIn(item)}
                    style={[styles.button, { backgroundColor: running ? '#ef444418' : completed ? colors.statusCompleted + '18' : colors.primary + '18', opacity: isOffline || (busyJobId !== null && !busy) ? 0.45 : 1 }]}
                  >
                    {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: running ? '#ef4444' : completed ? colors.statusCompleted : colors.primary, fontWeight: '600' }}>{running ? 'Clock Out' : completed ? 'Reopen' : 'Clock In'}</Text>}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  completedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  completedText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  serviceText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  addressText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11 },
  elapsed: { color: '#2563eb', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  button: { minWidth: 78, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  empty: { textAlign: 'center', paddingVertical: 36 },
  confirmation: { margin: 12, marginBottom: 0, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  confirmationTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  confirmationText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  confirmationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmationButton: { minHeight: 38, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});