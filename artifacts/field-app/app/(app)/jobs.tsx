import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  useListJobs,
  useGetMasterClock,
  useStartMasterClock,
  useStopMasterClock,
  getGetRouteDayDetailQueryOptions,
  getGetJobQueryOptions,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { useOffline } from '@/contexts/OfflineContext';
import {
  addLocalDays,
  dateFromLocalKey,
  groupJobsByDay,
  localDateKey,
  schedulePeriod,
  type ScheduleMode,
} from '@/utils/schedule';

type Job = {
  id: number;
  title: string;
  status: string;
  scheduledAt: string;
  propertyAddress?: string | null;
  customerName?: string | null;
  assigneeName?: string | null;
  priority?: string | null;
  recurrenceDescription?: string | null;
  recurrenceParentId?: number | null;
  routeTemplateId?: number | null;
  sequenceOrder?: number | null;
};

type RouteStopInfo = {
  sequenceOrder: number;
  driveMinutesFromPrev: number;
  routeTemplateName: string;
  totalStops: number;
};

function statusColor(status: string, colors: ReturnType<typeof useColors>): string {
  switch (status) {
    case 'scheduled': return colors.statusScheduled;
    case 'in_progress': return colors.statusInProgress;
    case 'completed': return colors.statusCompleted;
    case 'cancelled': return colors.statusCancelled;
    case 'on_hold': return colors.statusOnHold;
    default: return colors.mutedForeground;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'scheduled': return 'Scheduled';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'on_hold': return 'On Hold';
    default: return status;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDriveTime(minutes: number): string {
  if (minutes < 1) return '< 1 min drive';
  if (minutes < 60) return `${Math.round(minutes)} min drive`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m drive` : `${h}h drive`;
}

function JobCard({
  job,
  onPress,
  onPressIn,
  colors,
  routeStopInfo,
}: {
  job: Job;
  onPress: () => void;
  onPressIn: () => void;
  colors: ReturnType<typeof useColors>;
  routeStopInfo?: RouteStopInfo;
}) {
  const sc = statusColor(job.status, colors);
  const isRecurring = !!(job.recurrenceDescription || job.recurrenceParentId);
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      onPressIn={onPressIn}
      activeOpacity={0.8}
      testID={`job-card-${job.id}`}
    >
      {/* Route stop header row */}
      {routeStopInfo ? (
        <View style={[styles.routeStopHeader, { borderBottomColor: colors.border }]}>
          <View style={[styles.stopNumberBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.stopNumberText}>
              {routeStopInfo.sequenceOrder} / {routeStopInfo.totalStops}
            </Text>
          </View>
          <Text style={[styles.routeNameText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {routeStopInfo.routeTemplateName}
          </Text>
          {routeStopInfo.driveMinutesFromPrev > 0 ? (
            <View style={[styles.driveChip, { backgroundColor: colors.mutedForeground + '18' }]}>
              <Ionicons name="car-outline" size={11} color={colors.mutedForeground} />
              <Text style={[styles.driveChipText, { color: colors.mutedForeground }]}>
                {formatDriveTime(routeStopInfo.driveMinutesFromPrev)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.cardMain}>
        <View style={styles.cardLeft}>
          <View style={[styles.statusDot, { backgroundColor: sc }]} />
          <View style={styles.cardBody}>
            <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>
              {job.title}
            </Text>
            {isRecurring ? (
              <View style={[styles.recurringBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.recurringBadgeText, { color: colors.primary }]}>
                  ↻ {job.recurrenceDescription ?? 'Recurring'}
                </Text>
              </View>
            ) : null}
            {job.propertyAddress ? (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {job.propertyAddress}
                </Text>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {formatDate(job.scheduledAt)}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.cardRight}>
          {job.priority && job.priority !== 'normal' && (
            <View style={[styles.statusBadge, { backgroundColor: job.priority === 'urgent' ? '#fef2f2' : job.priority === 'high' ? '#fff7ed' : '#f8fafc', marginBottom: 4 }]}>
              <Text style={[styles.statusText, { color: job.priority === 'urgent' ? '#dc2626' : job.priority === 'high' ? '#ea580c' : '#64748b', textTransform: 'capitalize' }]}>{job.priority}</Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: sc + '22' }]}>
            <Text style={[styles.statusText, { color: sc }]}>{statusLabel(job.status)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={{ marginTop: 8 }} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function JobsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { isOffline, reportNetworkStatus, cacheJobs, getCachedJobs } = useOffline();
  const params = useLocalSearchParams<{ scheduleMode?: string; scheduleDate?: string }>();

  const [cachedJobs, setCachedJobs] = useState<Job[] | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    params.scheduleMode === 'week' ? 'week' : 'day',
  );
  const [selectedDate, setSelectedDate] = useState<Date>(() => dateFromLocalKey(params.scheduleDate));
  const period = useMemo(() => schedulePeriod(scheduleMode, selectedDate), [scheduleMode, selectedDate]);

  const { data: jobs, isLoading, isError, refetch, isFetching } = useListJobs(
    { startDate: period.startDate, endDate: period.endDate }
  );

  // A failed request must never show cached jobs from a different calendar range.
  useEffect(() => {
    setCachedJobs(null);
  }, [period.rangeKey]);

  // Master clock (day clock banner) — from Task #42
  const { data: masterClock, refetch: refetchMasterClock } = useGetMasterClock();
  const startMasterClock = useStartMasterClock();
  const stopMasterClock = useStopMasterClock();

  // Live elapsed time for the day clock
  const [clockedInSeconds, setClockedInSeconds] = useState(0);
  useEffect(() => {
    if (!masterClock?.isClockedIn || !masterClock?.clockedInAt) {
      setClockedInSeconds(0);
      return;
    }
    const update = () =>
      setClockedInSeconds(Math.floor((Date.now() - new Date(masterClock.clockedInAt as string).getTime()) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [masterClock?.isClockedIn, masterClock?.clockedInAt]);

  const handleClockToggle = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (masterClock?.isClockedIn) {
      stopMasterClock.mutate({}, { onSuccess: () => refetchMasterClock() });
    } else {
      startMasterClock.mutate({}, { onSuccess: () => refetchMasterClock() });
    }
  }, [masterClock?.isClockedIn, startMasterClock, stopMasterClock, refetchMasterClock]);

  // When jobs load successfully, cache them and mark online
  useEffect(() => {
    if (jobs) {
      reportNetworkStatus(false);
      cacheJobs(jobs as unknown[], period.rangeKey);
    }
  }, [jobs, reportNetworkStatus, cacheJobs, period.rangeKey]);

  // When the query errors, try to load from cache and mark offline
  useEffect(() => {
    if (isError) {
      reportNetworkStatus(true);
      getCachedJobs(period.rangeKey).then((cached) => {
        if (cached) setCachedJobs(cached as Job[]);
      });
    }
  }, [isError, reportNetworkStatus, getCachedJobs, period.rangeKey]);

  const displayJobs: Job[] = (isError ? cachedJobs : (jobs as Job[] | undefined)) ?? [];

  // Collect unique (routeTemplateId, date) pairs from jobs that belong to a route
  const routeQueries = useMemo(() => {
    const seen = new Map<string, { id: number; date: string }>();
    for (const job of displayJobs) {
      if (job.routeTemplateId != null) {
        const date = localDateKey(new Date(job.scheduledAt));
        const key = `${job.routeTemplateId}::${date}`;
        if (!seen.has(key)) {
          seen.set(key, { id: job.routeTemplateId, date });
        }
      }
    }
    return Array.from(seen.values());
  }, [displayJobs]);

  // Batch-fetch route day detail for every unique route+date in the job list
  const routeDayResults = useQueries({
    queries: routeQueries.map(({ id, date }) =>
      getGetRouteDayDetailQueryOptions(id, { date })
    ),
  });

  // Build a jobId → RouteStopInfo lookup from all fetched route day details
  const routeStopMap = useMemo(() => {
    const map = new Map<number, RouteStopInfo>();
    for (const result of routeDayResults) {
      const detail = result.data;
      if (!detail) continue;
      const totalStops = detail.stops.length;
      for (const stop of detail.stops) {
        map.set(stop.jobId, {
          sequenceOrder: stop.sequenceOrder,
          driveMinutesFromPrev: stop.driveMinutesFromPrev,
          routeTemplateName: detail.routeTemplateName,
          totalStops,
        });
      }
    }
    return map;
  }, [routeDayResults]);

  const searchedJobs = useMemo(() => {
    let result = displayJobs;
    if (jobSearch.trim()) {
      const q = jobSearch.toLowerCase();
      result = result.filter(j =>
        j.title.toLowerCase().includes(q) ||
        (j.customerName ?? '').toLowerCase().includes(q) ||
        (j.propertyAddress ?? '').toLowerCase().includes(q),
      );
    }
    if (jobStatusFilter !== 'all') {
      result = result.filter(j => j.status === jobStatusFilter);
    }
    return result;
  }, [displayJobs, jobSearch, jobStatusFilter]);

  const groupedJobs = useMemo(() => {
    const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return groupJobsByDay(searchedJobs, period.days).map(group => ({
      ...group,
      jobs: [...group.jobs].sort((a, b) => {
        const aStop = routeStopMap.get(a.id);
        const bStop = routeStopMap.get(b.id);
        if (!!aStop !== !!bStop) return aStop ? -1 : 1;
        if (aStop && bStop && aStop.sequenceOrder !== bStop.sequenceOrder) {
          return aStop.sequenceOrder - bStop.sequenceOrder;
        }
        const priority = (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2);
        return priority || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      }),
    }));
  }, [searchedJobs, period.days, routeStopMap]);
  const sortedJobs = groupedJobs.flatMap(group => group.jobs);

  const setSchedule = useCallback((mode: ScheduleMode, date: Date) => {
    setScheduleMode(mode);
    setSelectedDate(date);
    router.setParams({ scheduleMode: mode, scheduleDate: localDateKey(date) });
  }, []);
  const movePeriod = useCallback((direction: -1 | 1) => {
    setSchedule(scheduleMode, addLocalDays(selectedDate, direction * (scheduleMode === 'week' ? 7 : 1)));
  }, [scheduleMode, selectedDate, setSchedule]);
  const periodLabel = scheduleMode === 'day'
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : `${period.days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${period.days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const prefetchJobDetail = useCallback((id: number) => {
    void queryClient.prefetchQuery(getGetJobQueryOptions(id));
  }, [queryClient]);

  const handleJobPress = useCallback(async (id: number) => {
    await Haptics.selectionAsync();
    router.push({
      pathname: '/(app)/job/[id]',
      params: { id: String(id), scheduleMode, scheduleDate: localDateKey(selectedDate) },
    });
  }, [scheduleMode, selectedDate]);

  const handleSignOut = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace('/');
  }, [signOut]);

  const handleEquipmentPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/equipment');
  }, []);

  const handlePreTripPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/pre-trip' as any);
  }, []);

  const handleTimeTrackingPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/time-tracking' as any);
  }, []);

  const handleRecurringPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/recurring');
  }, []);
  const handleJobRequestPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/job-request');
  }, []);
  const handleMyRequestsPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/my-requests');
  }, []);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16;

  const isClockedIn = masterClock?.isClockedIn ?? false;
  const elapsedHours = Math.floor(clockedInSeconds / 3600);
  const elapsedMins = Math.floor((clockedInSeconds % 3600) / 60);
  const elapsedLabel = clockedInSeconds > 0
    ? `${elapsedHours}h ${String(elapsedMins).padStart(2, '0')}m`
    : '';

  const showOfflineBanner = isOffline && isError;
  const showEmptyError = isError && !cachedJobs;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* User greeting bar */}
      <View style={[styles.greeting, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <View>
          <Text style={[styles.greetingName, { color: colors.foreground }]}>
            {user?.name || 'Field Staff'}
          </Text>
          <Text style={[styles.greetingRole, { color: colors.mutedForeground }]}>
            {user?.role ?? 'technician'} · {displayJobs.length} jobs
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleTimeTrackingPress}
            style={styles.headerBtn}
            testID="time-tracking-nav-button"
          >
            <Ionicons name="timer-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleJobRequestPress}
            style={styles.headerBtn}
            testID="job-request-nav-button"
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMyRequestsPress} style={styles.headerBtn} testID="my-job-requests-nav-button">
            <Ionicons name="clipboard-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRecurringPress}
            style={styles.headerBtn}
            testID="recurring-nav-button"
          >
            <Ionicons name="repeat-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleEquipmentPress}
            style={styles.headerBtn}
            testID="equipment-nav-button"
          >
            <Ionicons name="construct-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={styles.headerBtn} testID="sign-out-button">
            <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Day clock banner */}
      <TouchableOpacity
        style={[
          styles.clockBanner,
          {
            backgroundColor: isClockedIn ? colors.primary + '14' : colors.card,
            borderBottomColor: colors.border,
          },
        ]}
        onPress={handleClockToggle}
        activeOpacity={0.75}
        testID="master-clock-banner"
      >
        <View style={styles.clockBannerLeft}>
          <View style={[styles.clockDot, { backgroundColor: isClockedIn ? colors.primary : colors.mutedForeground }]} />
          <Text style={[styles.clockBannerLabel, { color: isClockedIn ? colors.primary : colors.mutedForeground }]}>
            {isClockedIn
              ? elapsedLabel
                ? `Clocked in · ${elapsedLabel}`
                : 'Clocked in for the day'
              : 'Not clocked in'}
          </Text>
        </View>
        <View style={[styles.clockToggleBtn, { backgroundColor: isClockedIn ? '#ef444418' : colors.primary + '18' }]}>
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

      <View style={[styles.scheduleControls, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.preTripButton, { borderColor: colors.primary + '45', backgroundColor: colors.primary + '10' }]}
          onPress={handlePreTripPress}
          activeOpacity={0.8}
          testID="pre-trip-entry-button"
        >
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.preTripTitle, { color: colors.primary }]}>Pre-trip equipment check</Text>
            <Text style={[styles.preTripSubtitle, { color: colors.mutedForeground }]}>Condition, fuel, meter readings, and concerns</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.segmentedControl, { backgroundColor: colors.muted }]}>
          {(['day', 'week'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              testID={`schedule-mode-${mode}`}
              onPress={() => setSchedule(mode, selectedDate)}
              style={[styles.segment, scheduleMode === mode && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.segmentText, { color: scheduleMode === mode ? colors.primaryForeground : colors.mutedForeground }]}>
                {mode === 'day' ? 'Day' : 'Week'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.periodNav}>
          <TouchableOpacity testID="schedule-previous" onPress={() => movePeriod(-1)} style={styles.periodButton}>
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.periodLabel, { color: colors.foreground }]} numberOfLines={1}>{periodLabel}</Text>
          <TouchableOpacity testID="schedule-next" onPress={() => movePeriod(1)} style={styles.periodButton}>
            <Ionicons name="chevron-forward" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity testID="schedule-today" onPress={() => setSchedule(scheduleMode, new Date())} style={styles.todayButton}>
            <Text style={[styles.todayText, { color: colors.primary }]}>Today</Text>
          </TouchableOpacity>
        </View>
        {scheduleMode === 'week' && (
          <View style={styles.weekSummary}>
            {groupedJobs.map(group => (
              <TouchableOpacity key={group.key} onPress={() => setSchedule('day', group.date)} style={styles.weekDay}>
                <Text style={[styles.weekDayName, { color: colors.mutedForeground }]}>{group.date.toLocaleDateString('en-US', { weekday: 'narrow' })}</Text>
                <Text style={[styles.weekDayCount, { color: group.jobs.length ? colors.primary : colors.mutedForeground }]}>{group.jobs.length}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Search bar */}
      {!isLoading && !showEmptyError && (
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            value={jobSearch}
            onChangeText={setJobSearch}
            placeholder="Search jobs…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {/* Status filter pills */}
      {!isLoading && !showEmptyError && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          {(['all', 'scheduled', 'completed'] as const).map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => setJobStatusFilter(s)}
              style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: jobStatusFilter === s ? colors.primary : colors.muted }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: jobStatusFilter === s ? colors.primaryForeground : colors.mutedForeground, textTransform: 'capitalize' }}>
                {s === 'all' ? 'All' : s === 'scheduled' ? 'Scheduled' : 'Completed'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Offline banner */}
      {showOfflineBanner && (
        <View style={[styles.offlineBanner, { backgroundColor: '#92400e' }]}>
          <Ionicons name="cloud-offline-outline" size={15} color="#fef3c7" />
          <Text style={styles.offlineBannerText}>No connection · Showing cached data</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading jobs…</Text>
        </View>
      ) : showEmptyError ? (
        <View style={styles.centered}>
          <Ionicons name="wifi-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load jobs</Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={scheduleMode === 'week'
            ? groupedJobs.flatMap(group => [{ type: 'heading' as const, key: group.key, date: group.date, count: group.jobs.length }, ...group.jobs.map(job => ({ type: 'job' as const, job }))])
            : sortedJobs.map(job => ({ type: 'job' as const, job }))}
          keyExtractor={(item) => item.type === 'heading' ? `heading-${item.key}` : String(item.job.id)}
          renderItem={({ item }) => item.type === 'heading' ? (
            <View style={styles.dayHeading}>
              <Text style={[styles.dayHeadingText, { color: colors.foreground }]}>{item.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
              <Text style={[styles.dayHeadingCount, { color: colors.mutedForeground }]}>{item.count} {item.count === 1 ? 'job' : 'jobs'}</Text>
            </View>
          ) : (
            <JobCard job={item.job} onPress={() => handleJobPress(item.job.id)} onPressIn={() => prefetchJobDetail(item.job.id)} colors={colors} routeStopInfo={routeStopMap.get(item.job.id)} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad },
            sortedJobs.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={scheduleMode === 'week' || sortedJobs.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="briefcase-outline" size={52} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No jobs assigned</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Check back when jobs have been scheduled
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  greetingName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  greetingRole: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerBtn: { padding: 6 },
  clockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  clockBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  clockBannerLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  clockToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  clockToggleText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  scheduleControls: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 9,
  },
  preTripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  preTripTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  preTripSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 1 },
  segmentedControl: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    minWidth: 66,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  periodButton: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  periodLabel: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  todayButton: {
    paddingVertical: 5,
    paddingLeft: 10,
  },
  todayText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  weekSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekDay: {
    alignItems: 'center',
    minWidth: 30,
    paddingVertical: 2,
  },
  weekDayName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginBottom: 2,
  },
  weekDayCount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    paddingVertical: 4,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#fef3c7',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 8,
  },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  listEmpty: { flex: 1 },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 7,
  },
  dayHeadingText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  dayHeadingCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  routeStopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  stopNumberBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  stopNumberText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  routeNameText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    flex: 1,
  },
  driveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  driveChipText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 12 },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    flexShrink: 0,
  },
  cardBody: { flex: 1 },
  jobTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
  },
  recurringBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    marginBottom: 5,
  },
  recurringBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  cardRight: { alignItems: 'flex-end', marginLeft: 8 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
});
