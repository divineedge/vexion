import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Modal,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMasterClock, getGetMasterClockQueryKey,
  useStartMasterClock, useStopMasterClock,
  useStartSubTimer, useStopSubTimer, useAdjustSubTimer,
  useCreateGeofenceEntry,
  useGetTodaySchedule, getGetTodayScheduleQueryKey,
  getListSubTimersQueryKey,
  getListTimeEntriesQueryKey,
  SubTimer,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

type ScheduleItem = {
  kind: 'job' | 'visit';
  id: number;
  label: string;
  scheduledAt: string | null;
  customerName: string | null;
  propertyAddress: string | null;
  propertyId?: number | null;
  status: string;
  activeTimerId: number | null;
  activeTimerStartedAt: string | null;
  elapsedSeconds: number;
  propertyLat?: number | null;
  propertyLng?: number | null;
  propertyGeofenceLat?: number | null;
  propertyGeofenceLng?: number | null;
  propertyGeofenceRadius?: number | null;
};

type LateArrivalPrompt = {
  timerId: number;
  startedAt: string;
  stoppedAt: string;
  jobScheduledAt: string;
  lateByMinutes: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Request foreground location permission and return the current GPS fix, or null if unavailable. */
async function getLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null; // Don't block clock-in if GPS is unavailable
  }
}

/** Haversine distance in metres between two GPS points. */
function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDayTotal(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveTimer({ startedAt, initialElapsed }: { startedAt: string; initialElapsed: number }) {
  const [elapsed, setElapsed] = useState(initialElapsed);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>;
}

/** Modal shown when an employee clocked into a job late — lets them confirm or adjust the actual start/end times. */
function LateArrivalModal({
  prompt,
  onConfirm,
  onDismiss,
  colors,
}: {
  prompt: LateArrivalPrompt;
  onConfirm: (adjustedStartedAt: string | null, adjustedStoppedAt: string | null) => void;
  onDismiss: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [startTime, setStartTime] = useState(prompt.startedAt);
  const [endTime, setEndTime] = useState(prompt.stoppedAt);

  const isStartAdjusted = startTime !== prompt.startedAt;
  const isEndAdjusted = endTime !== prompt.stoppedAt;
  const hasAdjustment = isStartAdjusted || isEndAdjusted;

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <View style={[styles.modalHeader, { backgroundColor: '#f59e0b18', borderBottomColor: colors.border }]}>
            <Ionicons name="time-outline" size={20} color="#d97706" />
            <Text style={[styles.modalTitle, { color: '#92400e' }]}>Late Arrival Detected</Text>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Context row */}
            <View style={[styles.lateContextBox, { backgroundColor: colors.muted + '60', borderColor: colors.border }]}>
              <View style={styles.lateContextRow}>
                <Text style={[styles.lateContextLabel, { color: colors.mutedForeground }]}>Scheduled</Text>
                <Text style={[styles.lateContextValue, { color: colors.foreground }]}>{formatTime(prompt.jobScheduledAt)}</Text>
              </View>
              <View style={styles.lateContextRow}>
                <Text style={[styles.lateContextLabel, { color: colors.mutedForeground }]}>Clocked in</Text>
                <Text style={[styles.lateContextValue, { color: '#d97706' }]}>
                  {formatTime(prompt.startedAt)} ({prompt.lateByMinutes} min late)
                </Text>
              </View>
            </View>

            <Text style={[styles.modalSubTitle, { color: colors.mutedForeground }]}>
              Did you arrive at the scheduled time but forget to clock in? Adjust the times below if needed.
            </Text>

            {/* Start time adjuster */}
            <View style={[styles.timeAdjuster, { borderColor: colors.border }]}>
              <View style={styles.timeAdjusterHeader}>
                <Text style={[styles.timeAdjusterLabel, { color: colors.mutedForeground }]}>Start time</Text>
                {isStartAdjusted && (
                  <TouchableOpacity onPress={() => setStartTime(prompt.startedAt)}>
                    <Text style={{ fontSize: 11, color: colors.primary }}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.timeAdjusterRow}>
                <TouchableOpacity
                  style={[styles.adjBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => setStartTime(t => addMinutes(t, -5))}
                >
                  <Ionicons name="remove" size={16} color={colors.foreground} />
                  <Text style={[styles.adjBtnText, { color: colors.foreground }]}>5m</Text>
                </TouchableOpacity>
                <View style={[styles.timeDisplay, { backgroundColor: isStartAdjusted ? colors.primary + '18' : colors.muted + '40' }]}>
                  <Text style={[styles.timeDisplayText, { color: isStartAdjusted ? colors.primary : colors.foreground }]}>
                    {formatTime(startTime)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.adjBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => setStartTime(t => addMinutes(t, 5))}
                >
                  <Text style={[styles.adjBtnText, { color: colors.foreground }]}>5m</Text>
                  <Ionicons name="add" size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.useScheduledBtn, { borderColor: colors.primary + '60' }]}
                onPress={() => setStartTime(prompt.jobScheduledAt)}
              >
                <Text style={[styles.useScheduledBtnText, { color: colors.primary }]}>
                  Use scheduled time ({formatTime(prompt.jobScheduledAt)})
                </Text>
              </TouchableOpacity>
            </View>

            {/* End time adjuster */}
            <View style={[styles.timeAdjuster, { borderColor: colors.border }]}>
              <View style={styles.timeAdjusterHeader}>
                <Text style={[styles.timeAdjusterLabel, { color: colors.mutedForeground }]}>End time</Text>
                {isEndAdjusted && (
                  <TouchableOpacity onPress={() => setEndTime(prompt.stoppedAt)}>
                    <Text style={{ fontSize: 11, color: colors.primary }}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.timeAdjusterRow}>
                <TouchableOpacity
                  style={[styles.adjBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => setEndTime(t => addMinutes(t, -5))}
                >
                  <Ionicons name="remove" size={16} color={colors.foreground} />
                  <Text style={[styles.adjBtnText, { color: colors.foreground }]}>5m</Text>
                </TouchableOpacity>
                <View style={[styles.timeDisplay, { backgroundColor: isEndAdjusted ? colors.primary + '18' : colors.muted + '40' }]}>
                  <Text style={[styles.timeDisplayText, { color: isEndAdjusted ? colors.primary : colors.foreground }]}>
                    {formatTime(endTime)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.adjBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => setEndTime(t => addMinutes(t, 5))}
                >
                  <Text style={[styles.adjBtnText, { color: colors.foreground }]}>5m</Text>
                  <Ionicons name="add" size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.muted + '60', borderColor: colors.border }]}
              onPress={onDismiss}
            >
              <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Keep Original</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, {
                backgroundColor: hasAdjustment ? colors.primary : colors.muted,
                borderColor: hasAdjustment ? colors.primary : colors.border,
              }]}
              onPress={() => onConfirm(
                isStartAdjusted ? startTime : null,
                isEndAdjusted ? endTime : null,
              )}
              disabled={!hasAdjustment}
            >
              <Text style={[styles.modalBtnText, { color: hasAdjustment ? '#fff' : colors.mutedForeground }]}>
                Save Adjusted Times
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TimeTrackingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: masterClock, refetch: refetchClock } = useGetMasterClock({
    query: { queryKey: getGetMasterClockQueryKey() },
  });
  const { data: schedule, isLoading, refetch: refetchSchedule } = useGetTodaySchedule({
    query: { queryKey: getGetTodayScheduleQueryKey(), refetchInterval: 15000 },
  });

  const startMaster = useStartMasterClock();
  const stopMaster = useStopMasterClock();
  const startSub = useStartSubTimer();
  const stopSub = useStopSubTimer();
  const adjustSub = useAdjustSubTimer();
  const createGeofenceEntry = useCreateGeofenceEntry();

  const [masterElapsed, setMasterElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lateArrivalPrompt, setLateArrivalPrompt] = useState<LateArrivalPrompt | null>(null);
  // Local throttle complements the server's durable five-minute debounce. It is deliberately
  // unrelated to clock controls: merely arriving at a scheduled property records an event.
  const recentlyReportedGeofences = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const reportScheduledArrivals = async () => {
      const location = await getLocation();
      if (!location) return;
      const now = Date.now();
      for (const item of (schedule as ScheduleItem[] | undefined) ?? []) {
        if (item.propertyId == null || item.propertyGeofenceLat == null || item.propertyGeofenceLng == null || item.propertyGeofenceRadius == null) continue;
        if (haversineMetres(location.lat, location.lng, item.propertyGeofenceLat, item.propertyGeofenceLng) > item.propertyGeofenceRadius) continue;
        const lastReported = recentlyReportedGeofences.current.get(item.propertyId);
        if (lastReported != null && now - lastReported < 5 * 60 * 1000) continue;
        recentlyReportedGeofences.current.set(item.propertyId, now);
        createGeofenceEntry.mutate({
          data: {
            propertyId: item.propertyId,
            lat: location.lat,
            lng: location.lng,
            ...(item.kind === 'job' ? { jobId: item.id } : { visitId: item.id }),
          },
        });
      }
    };
    void reportScheduledArrivals();
  }, [schedule, createGeofenceEntry]);

  useEffect(() => {
    if (!masterClock?.isClockedIn || !masterClock?.clockedInAt) {
      setMasterElapsed(0);
      return;
    }
    const update = () =>
      setMasterElapsed(Math.floor((Date.now() - new Date(masterClock.clockedInAt as string).getTime()) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [masterClock?.isClockedIn, masterClock?.clockedInAt]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetMasterClockQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSubTimersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayScheduleQueryKey() });
  }, [queryClient]);

  const handleMasterToggle = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const loc = await getLocation();
    const locData = loc ? { lat: loc.lat, lng: loc.lng } : undefined;
    if (masterClock?.isClockedIn) {
      stopMaster.mutate({ data: locData }, { onSuccess: invalidateAll });
    } else {
      startMaster.mutate({ data: locData }, { onSuccess: invalidateAll });
    }
  }, [masterClock?.isClockedIn, startMaster, stopMaster, invalidateAll]);

  const handleClockIn = useCallback(async (item: ScheduleItem) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const busyKey = `${item.kind}-${item.id}`;
    setBusyId(busyKey);
    const loc = await getLocation();

    // Check geofence distance — inform the employee if they're outside the boundary
    if (loc && item.propertyGeofenceLat != null && item.propertyGeofenceLng != null && item.propertyGeofenceRadius != null) {
      const dist = haversineMetres(
        loc.lat, loc.lng,
        item.propertyGeofenceLat, item.propertyGeofenceLng,
      );
      if (dist > item.propertyGeofenceRadius * 2) {
        // Still allow clock-in — just note the distance; a future enhancement can prompt
        console.log(`[geofence] ${dist.toFixed(0)}m from property centre (radius: ${item.propertyGeofenceRadius}m)`);
      }
    }

    const label = item.kind === 'job' ? item.label : `visit:${item.id}:${item.label}`;
    const type = item.kind === 'job' ? 'job' : 'routine';
    const payload: Record<string, unknown> = { label, type };
    if (item.kind === 'job') payload.jobId = item.id;
    if (loc) { payload.lat = loc.lat; payload.lng = loc.lng; }

    startSub.mutate(
      { data: payload as any },
      {
        onSuccess: () => { invalidateAll(); setBusyId(null); },
        onError: () => setBusyId(null),
      }
    );
  }, [startSub, invalidateAll]);

  const handleClockOut = useCallback(async (item: ScheduleItem) => {
    if (!item.activeTimerId) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const busyKey = `${item.kind}-${item.id}`;
    setBusyId(busyKey);
    const loc = await getLocation();

    stopSub.mutate(
      { id: item.activeTimerId, data: loc ? { lat: loc.lat, lng: loc.lng } : undefined },
      {
        onSuccess: (data: SubTimer) => {
          invalidateAll();
          setBusyId(null);
          // If this job timer recorded a late arrival, prompt the employee to review the times
          const d = data as SubTimer & { jobScheduledAt?: string | null };
          if (d.isLateArrival && d.jobScheduledAt && d.stoppedAt && d.lateByMinutes != null) {
            setLateArrivalPrompt({
              timerId: d.id,
              startedAt: d.startedAt,
              stoppedAt: d.stoppedAt,
              jobScheduledAt: d.jobScheduledAt,
              lateByMinutes: d.lateByMinutes,
            });
          }
        },
        onError: () => setBusyId(null),
      }
    );
  }, [stopSub, invalidateAll]);

  const handleLateArrivalConfirm = useCallback((
    adjustedStartedAt: string | null,
    adjustedStoppedAt: string | null,
  ) => {
    if (!lateArrivalPrompt) return;
    if (adjustedStartedAt || adjustedStoppedAt) {
      adjustSub.mutate(
        {
          id: lateArrivalPrompt.timerId,
          data: {
            ...(adjustedStartedAt ? { adjustedStartedAt } : {}),
            ...(adjustedStoppedAt ? { adjustedStoppedAt } : {}),
          },
        },
        { onSettled: () => setLateArrivalPrompt(null) }
      );
    } else {
      setLateArrivalPrompt(null);
    }
  }, [lateArrivalPrompt, adjustSub]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchClock(), refetchSchedule()]);
    setRefreshing(false);
  }, [refetchClock, refetchSchedule]);

  const isClockedIn = masterClock?.isClockedIn ?? false;
  const scheduleItems = (schedule as ScheduleItem[] | undefined) ?? [];
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16;

  const renderItem = useCallback(({ item }: { item: ScheduleItem }) => {
    const isActive = item.activeTimerId != null;
    const busyKey = `${item.kind}-${item.id}`;
    const isBusy = busyId === busyKey;

    return (
      <View style={[
        styles.scheduleRow,
        {
          backgroundColor: isActive ? colors.primary + '12' : colors.card,
          borderColor: isActive ? colors.primary : colors.border,
        },
      ]}>
        {/* Kind badge */}
        <View style={[
          styles.kindBadge,
          { backgroundColor: isActive ? colors.primary : colors.muted },
        ]}>
          <Text style={[styles.kindBadgeText, { color: isActive ? '#fff' : colors.mutedForeground }]}>
            {item.kind === 'job' ? 'J' : 'V'}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.scheduleInfo}>
          <Text style={[styles.scheduleLabel, { color: colors.foreground }]} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={[styles.scheduleMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {formatTime(item.scheduledAt)}
            {item.customerName ? `  ·  ${item.customerName}` : ''}
          </Text>
          {item.propertyAddress ? (
            <Text style={[styles.scheduleAddress, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.propertyAddress}
            </Text>
          ) : null}
        </View>

        {/* Timer + toggle */}
        <View style={styles.scheduleActions}>
          {isActive && item.activeTimerStartedAt ? (
            <LiveTimer startedAt={item.activeTimerStartedAt} initialElapsed={item.elapsedSeconds} />
          ) : null}
          {isBusy ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.actionBtn} />
          ) : isActive ? (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#ef444418', borderColor: '#ef4444' }]}
              onPress={() => handleClockOut(item)}
              activeOpacity={0.75}
            >
              <Ionicons name="stop-circle" size={14} color="#ef4444" />
              <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Out</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}
              onPress={() => handleClockIn(item)}
              activeOpacity={0.75}
            >
              <Ionicons name="play-circle" size={14} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>In</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }, [colors, busyId, handleClockIn, handleClockOut]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Day clock banner */}
      <TouchableOpacity
        style={[
          styles.clockBanner,
          { backgroundColor: isClockedIn ? colors.primary + '14' : colors.card, borderBottomColor: colors.border },
        ]}
        onPress={handleMasterToggle}
        activeOpacity={0.8}
      >
        <View style={styles.clockBannerLeft}>
          <View style={[styles.clockDot, { backgroundColor: isClockedIn ? colors.primary : colors.mutedForeground }]} />
          <View>
            <Text style={[styles.clockBannerTitle, { color: isClockedIn ? colors.primary : colors.foreground }]}>
              {isClockedIn ? 'Clocked In for the Day' : 'Not Clocked In'}
            </Text>
            {isClockedIn && masterElapsed > 0 && (
              <Text style={[styles.clockBannerSub, { color: colors.primary }]}>
                {formatElapsed(masterElapsed)}
                {'  ·  '}
                Total: {formatDayTotal(masterClock?.totalMinutesToday ?? 0)}
              </Text>
            )}
          </View>
        </View>
        <View style={[
          styles.clockToggle,
          { backgroundColor: isClockedIn ? '#ef444418' : colors.primary + '18' },
        ]}>
          <Ionicons
            name={isClockedIn ? 'stop-circle-outline' : 'play-circle-outline'}
            size={16}
            color={isClockedIn ? '#ef4444' : colors.primary}
          />
          <Text style={[styles.clockToggleText, { color: isClockedIn ? '#ef4444' : colors.primary }]}>
            {isClockedIn ? 'Clock Out' : 'Clock In'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Schedule list */}
      <FlatList
        data={scheduleItems}
        keyExtractor={item => `${item.kind}-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 8 }}
        ListHeaderComponent={
          <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
            TODAY'S SCHEDULE
          </Text>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading…</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No jobs or visits scheduled for today.
              </Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      />

      {/* Late arrival confirmation modal */}
      {lateArrivalPrompt && (
        <LateArrivalModal
          prompt={lateArrivalPrompt}
          colors={colors}
          onConfirm={handleLateArrivalConfirm}
          onDismiss={() => setLateArrivalPrompt(null)}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  clockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  clockBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  clockDot: { width: 10, height: 10, borderRadius: 5 },
  clockBannerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  clockBannerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  clockToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  clockToggleText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  sectionHeader: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  kindBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  kindBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  scheduleInfo: { flex: 1, minWidth: 0 },
  scheduleLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  scheduleMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  scheduleAddress: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  scheduleActions: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  timerText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#2563eb', letterSpacing: 0.5 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 52,
    justifyContent: 'center',
  },
  actionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 32 },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  modalBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  modalSubTitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
    marginBottom: 16,
  },

  lateContextBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
    gap: 6,
  },
  lateContextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lateContextLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  lateContextValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  timeAdjuster: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  timeAdjusterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeAdjusterLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.4 },
  timeAdjusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adjBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  adjBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  timeDisplay: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  timeDisplayText: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  useScheduledBtn: {
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  useScheduledBtnText: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
