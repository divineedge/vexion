import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMasterClock, getGetMasterClockQueryKey,
  useStartMasterClock, useStopMasterClock,
  useStartSubTimer, useStopSubTimer,
  useGetTodaySchedule, getGetTodayScheduleQueryKey,
  getListSubTimersQueryKey,
  getListTimeEntriesQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';

type ScheduleItem = {
  kind: 'job' | 'visit';
  id: number;
  label: string;
  scheduledAt: string | null;
  customerName: string | null;
  propertyAddress: string | null;
  status: string;
  activeTimerId: number | null;
  activeTimerStartedAt: string | null;
  elapsedSeconds: number;
};

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

  const [masterElapsed, setMasterElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    if (masterClock?.isClockedIn) {
      stopMaster.mutate(undefined, { onSuccess: invalidateAll });
    } else {
      startMaster.mutate(undefined, { onSuccess: invalidateAll });
    }
  }, [masterClock?.isClockedIn, startMaster, stopMaster, invalidateAll]);

  const handleClockIn = useCallback(async (item: ScheduleItem) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const busyKey = `${item.kind}-${item.id}`;
    setBusyId(busyKey);
    const label = item.kind === 'job'
      ? item.label
      : `visit:${item.id}:${item.label}`;
    const type = item.kind === 'job' ? 'job' : 'routine';
    const payload: any = { label, type };
    if (item.kind === 'job') payload.jobId = item.id;

    startSub.mutate(
      { data: payload },
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
    stopSub.mutate(
      { id: item.activeTimerId },
      {
        onSuccess: () => { invalidateAll(); setBusyId(null); },
        onError: () => setBusyId(null),
      }
    );
  }, [stopSub, invalidateAll]);

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
    </View>
  );
}

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
});
