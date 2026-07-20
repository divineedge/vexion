import React, { useCallback, useEffect, useState } from 'react';
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useListJobs,
  useGetMasterClock,
  useStartMasterClock,
  useStopMasterClock,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { useOffline } from '@/contexts/OfflineContext';

type Job = {
  id: number;
  title: string;
  status: string;
  scheduledAt: string;
  propertyAddress?: string | null;
  customerName?: string | null;
  assigneeName?: string | null;
  priority?: string | null;
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

function priorityIcon(priority?: string | null): string {
  switch (priority) {
    case 'urgent': return 'alert-circle';
    case 'high': return 'arrow-up-circle';
    case 'low': return 'arrow-down-circle';
    default: return 'remove-circle-outline';
  }
}

function JobCard({ job, onPress, colors }: { job: Job; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  const sc = statusColor(job.status, colors);
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
      testID={`job-card-${job.id}`}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.statusDot, { backgroundColor: sc }]} />
        <View style={styles.cardBody}>
          <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>
            {job.title}
          </Text>
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
        <View style={[styles.statusBadge, { backgroundColor: sc + '22' }]}>
          <Text style={[styles.statusText, { color: sc }]}>{statusLabel(job.status)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={{ marginTop: 8 }} />
      </View>
    </TouchableOpacity>
  );
}

export default function JobsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { isOffline, reportNetworkStatus, cacheJobs, getCachedJobs } = useOffline();

  const [cachedJobs, setCachedJobs] = useState<Job[] | null>(null);

  const { data: jobs, isLoading, isError, refetch, isFetching } = useListJobs(
    user?.role === 'technician' ? { assigneeId: user.id } : undefined
  );

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
      stopMasterClock.mutate(undefined, { onSuccess: () => refetchMasterClock() });
    } else {
      startMasterClock.mutate(undefined, { onSuccess: () => refetchMasterClock() });
    }
  }, [masterClock?.isClockedIn, startMasterClock, stopMasterClock, refetchMasterClock]);

  // When jobs load successfully, cache them and mark online
  useEffect(() => {
    if (jobs) {
      reportNetworkStatus(false);
      cacheJobs(jobs as unknown[]);
    }
  }, [jobs, reportNetworkStatus, cacheJobs]);

  // When the query errors, try to load from cache and mark offline
  useEffect(() => {
    if (isError) {
      reportNetworkStatus(true);
      getCachedJobs().then((cached) => {
        if (cached) setCachedJobs(cached as Job[]);
      });
    }
  }, [isError, reportNetworkStatus, getCachedJobs]);

  const displayJobs: Job[] = (isError ? cachedJobs : (jobs as Job[] | undefined)) ?? [];

  const handleJobPress = useCallback(async (id: number) => {
    await Haptics.selectionAsync();
    router.push(`/(app)/job/${id}`);
  }, []);

  const handleSignOut = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace('/');
  }, [signOut]);

  const handleEquipmentPress = useCallback(async () => {
    await Haptics.selectionAsync();
    router.push('/(app)/equipment');
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
          data={displayJobs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <JobCard job={item} onPress={() => handleJobPress(item.id)} colors={colors} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad },
            displayJobs.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={displayJobs.length > 0}
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
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
