import React, { useCallback, useState, useEffect } from 'react';
import { Linking } from 'react-native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useGetJob, useListJobChemicalApplications,
  useListSubTimers, useStartSubTimer, useStopSubTimer,
  useGetMasterClock, useStartMasterClock, useStopMasterClock,
  useUpdateJob, useCompleteJob, useSkipNextOccurrence, useGetRouteDayDetail,
  getGetJobQueryOptions,
  type GetJobQueryResult,
  customFetch,
  getGetJobMessageUnreadCountQueryKey,
  useGetJobMessageUnreadCount,
  useListJobMedia,
  useAddJobMedia,
  useDeleteJobMedia,
  getListJobMediaQueryKey,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useOffline } from '@/contexts/OfflineContext';
import { messagePollInterval } from '@/utils/messages';
import { MediaAttachments } from '@/components/MediaAttachments';
import { openDirections } from '@/utils/directions';
import { getClockLocation } from '@/utils/timeTracking';

type RecurringJob = {
  id: number;
  recurrenceParentId?: number | null;
  recurrenceDescription?: string | null;
  recurrenceIndex?: number | null;
};

function RecurringSeriesBanner({
  job,
  colors,
  onSkip,
}: {
  job: RecurringJob;
  colors: ReturnType<typeof useColors>;
  onSkip: () => void;
}) {
  const seriesId = job.recurrenceParentId ?? job.id;
  const occurrenceLabel =
    job.recurrenceIndex != null ? `Occurrence #${job.recurrenceIndex + 1}` : 'Recurring Job';

  return (
    <View style={[recurringStyles.banner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
      <View style={recurringStyles.bannerTop}>
        <View style={recurringStyles.bannerLeft}>
          <Text style={[recurringStyles.bannerIcon, { color: colors.primary }]}>↻</Text>
          <View>
            <Text style={[recurringStyles.bannerLabel, { color: colors.primary }]}>Recurring Series</Text>
            <Text style={[recurringStyles.bannerDesc, { color: colors.mutedForeground }]}>
              {job.recurrenceDescription ?? 'Repeating job'} · {occurrenceLabel}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[recurringStyles.manageBtn, { borderColor: colors.primary + '50' }]}
          onPress={() => router.push(`/(app)/series/${seriesId}` as any)}
          activeOpacity={0.75}
        >
          <Text style={[recurringStyles.manageBtnText, { color: colors.primary }]}>Manage Series</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[recurringStyles.skipBtn, { borderColor: '#ef4444' + '40', backgroundColor: '#ef444410' }]}
        onPress={onSkip}
        activeOpacity={0.75}
      >
        <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
        <Text style={[recurringStyles.skipBtnText, { color: '#ef4444' }]}>Skip next occurrence</Text>
      </TouchableOpacity>
    </View>
  );
}

const recurringStyles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  bannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  bannerIcon: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
  },
  bannerLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  bannerDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
  },
  manageBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  skipBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});

type RouteStop = {
  jobId: number;
  sequenceOrder: number;
  driveMinutesFromPrev: number;
  propertyAddress?: string | null;
};

function RouteSummaryCard({
  routeTemplateName,
  stops,
  currentJobId,
  colors,
}: {
  routeTemplateName: string;
  stops: RouteStop[];
  currentJobId: number;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const idx = stops.findIndex(s => s.jobId === currentJobId);
  if (idx === -1) return null;

  const stop = stops[idx];
  const nextStop = stops[idx + 1] ?? null;
  const total = stops.length;
  const position = idx + 1;

  const driveLabel = stop.driveMinutesFromPrev > 0
    ? `${stop.driveMinutesFromPrev} min drive from prev`
    : position === 1
    ? 'First stop on route'
    : null;

  return (
    <View style={[routeStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header: route name + position */}
      <TouchableOpacity
        style={routeStyles.headerRow}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.8}
      >
        <View style={[routeStyles.iconBox, { backgroundColor: colors.primary + '18' }]}>
          <Ionicons name="navigate-outline" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[routeStyles.routeName, { color: colors.foreground }]} numberOfLines={1}>
            {routeTemplateName}
          </Text>
          <Text style={[routeStyles.stopBadge, { color: colors.primary }]}>
            Stop {position} of {total}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {/* Mini summary: drive time + next stop */}
      {driveLabel ? (
        <View style={[routeStyles.infoRow, { borderTopColor: colors.border }]}>
          <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
          <Text style={[routeStyles.infoText, { color: colors.mutedForeground }]}>{driveLabel}</Text>
        </View>
      ) : null}

      {nextStop ? (
        <View style={[routeStyles.infoRow, { borderTopColor: colors.border }]}>
          <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.mutedForeground} />
          <Text style={[routeStyles.infoText, { color: colors.mutedForeground }]} numberOfLines={1}>
            Next: {nextStop.propertyAddress ?? `Stop ${idx + 2}`}
            {nextStop.driveMinutesFromPrev > 0 ? ` · ${nextStop.driveMinutesFromPrev} min` : ''}
          </Text>
        </View>
      ) : (
        <View style={[routeStyles.infoRow, { borderTopColor: colors.border }]}>
          <Ionicons name="flag-outline" size={14} color={colors.mutedForeground} />
          <Text style={[routeStyles.infoText, { color: colors.mutedForeground }]}>Last stop of the day</Text>
        </View>
      )}

      {/* Full sequence — shown when expanded */}
      {expanded && (
        <View style={[routeStyles.sequenceContainer, { borderTopColor: colors.border }]}>
          <Text style={[routeStyles.sequenceTitle, { color: colors.mutedForeground }]}>
            Full day sequence
          </Text>
          {stops.map((s, i) => {
            const isCurrent = s.jobId === currentJobId;
            return (
              <View
                key={s.jobId}
                style={[
                  routeStyles.sequenceRow,
                  isCurrent && { backgroundColor: colors.primary + '12' },
                ]}
              >
                {/* Stop number pill */}
                <View style={[
                  routeStyles.sequencePill,
                  { backgroundColor: isCurrent ? colors.primary : colors.muted },
                ]}>
                  <Text style={[
                    routeStyles.sequencePillText,
                    { color: isCurrent ? '#fff' : colors.mutedForeground },
                  ]}>
                    {i + 1}
                  </Text>
                </View>

                {/* Address + drive time */}
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      routeStyles.sequenceAddress,
                      { color: isCurrent ? colors.foreground : colors.mutedForeground },
                      isCurrent && { fontFamily: 'Inter_600SemiBold' },
                    ]}
                    numberOfLines={1}
                  >
                    {s.propertyAddress ?? `Stop ${i + 1}`}
                    {isCurrent ? '  ← you are here' : ''}
                  </Text>
                  {s.driveMinutesFromPrev > 0 && (
                    <Text style={[routeStyles.sequenceDrive, { color: colors.mutedForeground }]}>
                      {s.driveMinutesFromPrev} min drive
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const routeStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  stopBadge: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
  },
  sequenceContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sequenceTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  sequenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sequencePill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sequencePillText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  sequenceAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 1,
  },
  sequenceDrive: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
});

type BreakdownItem = {
  productName?: string | null;
  amountApplied?: number | null;
  unit?: string | null;
  ratePerAcre?: number | null;
  ratePer1000Sqft?: number | null;
  activeIngredients?: unknown;
  epaRegNumber?: string | null;
};

type ChemApp = {
  id: number;
  mixtureName?: string | null;
  productName?: string | null;
  volumeApplied: number;
  volumeUnit: string;
  targetPest?: string | null;
  applicationMethod?: string | null;
  windSpeed?: number | null;
  windDirection?: string | null;
  temperature?: number | null;
  appliedAt: string;
  applicatorName?: string | null;
  breakdown: BreakdownItem[];
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function JobNotesSection({ jobId, job, colors }: { jobId: number; job: { description?: string | null } | null; colors: ReturnType<typeof useColors> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(job?.description ?? '');
  const updateJob = useUpdateJob();

  React.useEffect(() => { setValue(job?.description ?? ''); }, [job?.description]);

  return (
    <View style={[styles.section, { marginBottom: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Job Notes</Text>
        {!editing && (
          <TouchableOpacity onPress={() => setEditing(true)}>
            <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
              {job?.description ? 'Edit' : '+ Add'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {editing ? (
        <View style={[{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 }]}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Add notes for this job…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_400Regular', minHeight: 80, textAlignVertical: 'top' }}
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 }}
              disabled={updateJob.isPending}
              onPress={() => {
                updateJob.mutate(
                  { id: jobId, data: { description: value || undefined } as any },
                  {
                    onSuccess: () => { setEditing(false); },
                    onError: () => Alert.alert('Error', 'Failed to save notes'),
                  },
                );
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                {updateJob.isPending ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 }}
              onPress={() => { setValue(job?.description ?? ''); setEditing(false); }}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : job?.description ? (
        <View style={[{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 }]}>
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 }}>{job.description}</Text>
        </View>
      ) : (
        <View style={[{ backgroundColor: colors.muted, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: 'center' }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular' }}>No notes for this job yet</Text>
        </View>
      )}
    </View>
  );
}

type StaffNote = {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
};

function InternalNotesSection({ jobId, colors }: { jobId: number; colors: ReturnType<typeof useColors> }) {
  const { data: notes = [], isLoading } = useQuery<StaffNote[]>({
    queryKey: ['staff-notes', 'job', jobId],
    queryFn: () =>
      customFetch<StaffNote[]>(`/api/staff-notes?entityType=job&entityId=${jobId}`),
    enabled: !!jobId,
  });

  if (isLoading || notes.length === 0) return null;

  return (
    <View style={[styles.section, { marginBottom: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>
          Internal Notes
        </Text>
        <View style={{
          backgroundColor: '#fef3c7',
          borderRadius: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderWidth: 1,
          borderColor: '#fde68a',
        }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#92400e' }}>
            Staff only
          </Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {notes.map(note => (
          <View
            key={note.id}
            style={{
              backgroundColor: colors.card,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.foreground }}>
                {note.authorName}
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.mutedForeground }}>
                {new Date(note.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {' · '}
                {new Date(note.createdAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.foreground, lineHeight: 20 }}>
              {note.body}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function JobDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const { isOffline, reportNetworkStatus, cacheJob, getCachedJob, cacheApplications, getCachedApplications } = useOffline();

  const [cachedJob, setCachedJob] = useState<unknown | null>(null);
  const [cachedApps, setCachedApps] = useState<ChemApp[] | null>(null);
  const [screenFocused, setScreenFocused] = useState(false);
  const { data: messageUnread, refetch: refetchMessageUnread } = useGetJobMessageUnreadCount(jobId, {
    query: {
      enabled: Number.isInteger(jobId),
      queryKey: getGetJobMessageUnreadCountQueryKey(jobId),
      refetchInterval: messagePollInterval(screenFocused, isOffline),
    },
  });
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    void refetchMessageUnread();
    return () => setScreenFocused(false);
  }, [refetchMessageUnread]));

  const cachedQueryJob = queryClient.getQueryData<GetJobQueryResult>(getGetJobQueryOptions(jobId).queryKey);
  const { data: job, isLoading: jobLoading, isError: jobError, refetch: refetchJob } = useGetJob(
    jobId,
    { query: { queryKey: getGetJobQueryOptions(jobId).queryKey, placeholderData: cachedQueryJob } },
  );
  const { data: jobMedia = [], isLoading: jobMediaLoading, refetch: refetchJobMedia } = useListJobMedia(
    jobId,
    { query: { queryKey: getListJobMediaQueryKey(jobId), enabled: Number.isInteger(jobId) && !isOffline } },
  );
  const addJobMedia = useAddJobMedia();
  const deleteJobMedia = useDeleteJobMedia();

  // Query-cache data and persisted offline data are both valid shells while
  // the network query refreshes.
  const availableJob = (job ?? cachedJob) as GetJobQueryResult | null;
  // Derive route context from the available job rather than waiting for refresh.
  const jobRouteTemplateId = availableJob?.routeTemplateId ?? null;
  const jobScheduledAt = availableJob?.scheduledAt;
  const jobDateStr = jobScheduledAt ? jobScheduledAt.slice(0, 10) : '';
  const fieldRequirements = availableJob?.fieldRequirements;
  const requiresChemicalApplication = fieldRequirements?.requiresChemicalApplication === true;
  const showMaterialsOrParts = fieldRequirements?.showMaterialsOrParts === true;

  const { data: routeDay } = useGetRouteDayDetail(
    jobRouteTemplateId ?? 0,
    { date: jobDateStr },
    { query: { enabled: !!jobRouteTemplateId && !!jobDateStr, queryKey: ['routeDay', jobRouteTemplateId, jobDateStr] } },
  );
  const {
    data: applications,
    isLoading: appsLoading,
    isError: appsError,
    refetch: refetchApps,
    isFetching,
  } = useListJobChemicalApplications(jobId, { query: { enabled: requiresChemicalApplication, queryKey: ['job-chemical-applications', jobId] } });
  const { data: subTimers, refetch: refetchSubTimers } = useListSubTimers();
  const { data: masterClock, refetch: refetchMasterClock } = useGetMasterClock();
  const startSubTimer = useStartSubTimer();
  const stopSubTimer = useStopSubTimer();
  const startMasterClock = useStartMasterClock();
  const stopMasterClock = useStopMasterClock();
  const updateJob = useUpdateJob();
  const completeJob = useCompleteJob();
  const skipOccurrence = useSkipNextOccurrence();
  const activeJobTimer = subTimers?.find(t => t.isActive && t.jobId === jobId) ?? null;
  const [liveSeconds, setLiveSeconds] = useState(0);
  useEffect(() => {
    if (!activeJobTimer) { setLiveSeconds(0); return; }
    const update = () => setLiveSeconds(Math.floor((Date.now() - new Date(activeJobTimer.startedAt).getTime()) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [activeJobTimer?.id]);

  // Cache job on successful fetch
  useEffect(() => {
    if (job) {
      reportNetworkStatus(false);
      cacheJob(jobId, job);
    }
  }, [job, jobId, reportNetworkStatus, cacheJob]);

  // Load cached job when fetch fails
  useEffect(() => {
    if (jobError) {
      reportNetworkStatus(true);
      getCachedJob(jobId).then((cached) => {
        if (cached) setCachedJob(cached);
      });
    }
  }, [jobError, jobId, reportNetworkStatus, getCachedJob]);

  // Cache applications on successful fetch
  useEffect(() => {
    if (applications) {
      cacheApplications(jobId, applications as unknown[]);
    }
  }, [applications, jobId, cacheApplications]);

  // Load cached applications when fetch fails
  useEffect(() => {
    if (appsError) {
      getCachedApplications(jobId).then((cached) => {
        if (cached) setCachedApps(cached as ChemApp[]);
      });
    }
  }, [appsError, jobId, getCachedApplications]);

  // React Query retains stale/prefetched data when a refresh fails. Never let
  // the error flag discard that usable job shell.
  const displayJob = job ?? cachedJob ?? cachedQueryJob;
  const displayApps: ChemApp[] = (appsError ? cachedApps : (applications as ChemApp[] | undefined)) ?? [];

  // A cached job is a complete loading shell. Only configured chemical work waits
  // for its application data; a background refresh must never blank the job.
  const isLoading = (!job && !cachedJob && jobLoading) || (requiresChemicalApplication && appsLoading && !displayJob);

  const handleLogApplication = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/log/${jobId}`);
  }, [jobId]);

  const refetch = useCallback(() => {
    refetchJob();
    if (requiresChemicalApplication) refetchApps();
  }, [refetchJob, refetchApps, requiresChemicalApplication]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;

  const showOfflineBanner = isOffline && (jobError || appsError);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!displayJob) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="wifi-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          {jobError ? 'No connection and no cached data' : 'Job not found'}
        </Text>
        {jobError && (
          <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={refetch}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const statusMap: Record<string, string> = {
    scheduled: colors.statusScheduled,
    in_progress: colors.statusInProgress,
    completed: colors.statusCompleted,
    cancelled: colors.statusCancelled,
    on_hold: colors.statusOnHold,
  };
  const statusColor = statusMap[(displayJob as { status: string }).status] ?? colors.mutedForeground;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Offline banner */}
      {showOfflineBanner && (
        <View style={[styles.offlineBanner, { backgroundColor: '#92400e' }]}>
          <Ionicons name="cloud-offline-outline" size={15} color="#fef3c7" />
          <Text style={styles.offlineBannerText}>No connection · Showing cached data</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Job info card */}
        <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.jobHeader}>
            <Text style={[styles.jobTitle, { color: colors.foreground }]}>{(displayJob as { title: string }).title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {(displayJob as { status: string }).status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          {(displayJob as { propertyAddress?: string | null }).propertyAddress ? (
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => void openDirections((displayJob as { propertyAddress: string }).propertyAddress)}
              accessibilityRole="link"
              accessibilityLabel={`Get directions to ${(displayJob as { propertyAddress: string }).propertyAddress}`}
            >
              <Ionicons name="navigate-outline" size={15} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                {(displayJob as { propertyAddress: string }).propertyAddress}
              </Text>
              <Text style={[styles.directionsLabel, { color: colors.primary }]}>Directions</Text>
            </TouchableOpacity>
          ) : null}
          {(displayJob as { customerName?: string | null }).customerName ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {(displayJob as { customerName: string }).customerName}
              </Text>
            </View>
          ) : null}
          {(displayJob as { customerPhone?: string | null }).customerPhone ? (
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => Linking.openURL(`tel:${(displayJob as { customerPhone: string }).customerPhone}`)}
            >
              <Ionicons name="call-outline" size={15} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                {(displayJob as { customerPhone: string }).customerPhone}
              </Text>
            </TouchableOpacity>
          ) : null}
          {(displayJob as { assignedToName?: string | null }).assignedToName ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-circle-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {(displayJob as { assignedToName: string }).assignedToName}
              </Text>
            </View>
          ) : null}
          {(displayJob as { crewName?: string | null }).crewName ? (
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {(displayJob as { crewName: string }).crewName}
              </Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {formatDate((displayJob as { scheduledAt: string }).scheduledAt)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.messagesCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push({ pathname: '/(app)/messages', params: { jobId: String(jobId), title: (displayJob as { title: string }).title } } as any)}
          activeOpacity={0.8}
          testID="job-messages-button"
        >
          <View style={styles.messagesCardLeft}>
            <Ionicons name="chatbubbles-outline" size={21} color={colors.primary} />
            <View>
              <Text style={[styles.messagesCardTitle, { color: colors.foreground }]}>Staff Messages</Text>
              <Text style={[styles.messagesCardHint, { color: colors.mutedForeground }]}>Open this job’s staff-only conversation</Text>
            </View>
          </View>
          <View style={styles.messagesCardRight}>
            {!!messageUnread?.count && <View style={styles.jobMessageBadge}><Text style={styles.jobMessageBadgeText}>{messageUnread.count}</Text></View>}
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>

        {/* Recurring series banner */}
        {(displayJob as RecurringJob).recurrenceDescription || (displayJob as RecurringJob).recurrenceParentId ? (
          <RecurringSeriesBanner job={displayJob as RecurringJob} colors={colors} onSkip={() => {
            const seriesId = (displayJob as RecurringJob).recurrenceParentId ?? (displayJob as RecurringJob).id;
            Alert.alert(
              'Skip this occurrence?',
              'The next scheduled occurrence of this series will be skipped.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Skip Occurrence',
                  style: 'destructive',
                  onPress: () =>
                    skipOccurrence.mutate({ id: seriesId }, {
                      onSuccess: () => {
                        refetchJob();
                        Alert.alert('Skipped', 'The next occurrence has been skipped.');
                      },
                    }),
                },
              ],
            );
          }} />
        ) : null}

        {/* Route summary card */}
        {routeDay && !isOffline && (
          <RouteSummaryCard
            routeTemplateName={routeDay.routeTemplateName}
            stops={routeDay.stops}
            currentJobId={jobId}
            colors={colors}
          />
        )}

        {/* Clock in / out card — hidden when offline since timers require network */}
        {!isOffline && (
          <View style={[styles.clockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 14 }]}>Time Tracking</Text>

            {/* Day clock (master) */}
            <View style={styles.clockRow}>
              <View>
                <Text style={[styles.clockLabel, { color: colors.mutedForeground }]}>Day Clock</Text>
                <Text style={[styles.clockValue, { color: masterClock?.isClockedIn ? colors.primary : colors.mutedForeground }]}>
                  {masterClock?.isClockedIn ? 'Clocked in for the day' : 'Not clocked in'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.clockBtn, { backgroundColor: masterClock?.isClockedIn ? '#ef444418' : colors.primary + '18' }]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const location = await getClockLocation();
                  if (masterClock?.isClockedIn) {
                    stopMasterClock.mutate({ data: location ?? undefined }, { onSuccess: () => refetchMasterClock() });
                  } else {
                    startMasterClock.mutate({ data: location ?? undefined }, { onSuccess: () => refetchMasterClock() });
                  }
                }}
              >
                <Ionicons
                  name={masterClock?.isClockedIn ? 'stop-circle-outline' : 'play-circle-outline'}
                  size={18}
                  color={masterClock?.isClockedIn ? '#ef4444' : colors.primary}
                />
                <Text style={[styles.clockBtnText, { color: masterClock?.isClockedIn ? '#ef4444' : colors.primary }]}>
                  {masterClock?.isClockedIn ? 'Clock Out' : 'Clock In'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.clockDivider, { backgroundColor: colors.border }]} />

            {/* Job sub-timer */}
            <View style={styles.clockRow}>
              <View>
                <Text style={[styles.clockLabel, { color: colors.mutedForeground }]}>Job Timer</Text>
                <Text style={[styles.clockValue, { color: activeJobTimer ? '#f59e0b' : colors.mutedForeground }]}>
                  {activeJobTimer
                    ? `${Math.floor(liveSeconds / 3600)}h ${String(Math.floor((liveSeconds % 3600) / 60)).padStart(2, '0')}m ${String(liveSeconds % 60).padStart(2, '0')}s`
                    : 'Not started'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.clockBtn, { backgroundColor: activeJobTimer ? '#f59e0b18' : colors.primary + '18' }]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (activeJobTimer) {
                    const location = await getClockLocation();
                    stopSubTimer.mutate({ id: activeJobTimer.id, data: location ?? undefined }, {
                      onSuccess: () => {
                        refetchSubTimers();
                        Alert.alert(
                          'Mark Job Complete?',
                          'Do you want to mark this job as completed?',
                          [
                            { text: 'Not yet', style: 'cancel' },
                            {
                              text: 'Mark Complete',
                              onPress: () => {
                                if (requiresChemicalApplication && displayApps.length === 0) {
                                  Alert.alert('Chemical application required', 'Log a chemical application before marking this job complete.');
                                  return;
                                }
                                completeJob.mutate(
                                  { id: jobId },
                                  {
                                    onSuccess: () => refetchJob(),
                                    onError: (error: any) => Alert.alert('Unable to complete job', error?.message ?? 'A chemical application must be logged before completing this job.'),
                                  },
                                );
                              },
                            },
                          ],
                        );
                      },
                    });
                  } else {
                    const location = await getClockLocation();
                    startSubTimer.mutate(
                      { data: { label: (displayJob as any).title, type: 'job', jobId, ...(location ?? {}) } },
                      { onSuccess: () => { refetchSubTimers(); refetchMasterClock(); } },
                    );
                  }
                }}
              >
                <Ionicons
                  name={activeJobTimer ? 'stop-circle-outline' : 'timer-outline'}
                  size={18}
                  color={activeJobTimer ? '#f59e0b' : colors.primary}
                />
                <Text style={[styles.clockBtnText, { color: activeJobTimer ? '#f59e0b' : colors.primary }]}>
                  {activeJobTimer ? 'Stop Timer' : 'Start Timer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {showMaterialsOrParts && (
          <View style={[styles.section, { marginBottom: 16 }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Materials, Parts & Supplies</Text>
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border, alignItems: 'flex-start' }]}>
              {(((displayJob as any).suppliesNeeded ?? []).length === 0 && ((displayJob as any).jobParts ?? []).length === 0) ? (
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No materials, parts, or supplies assigned</Text>
              ) : (
                [...((displayJob as any).suppliesNeeded ?? []), ...((displayJob as any).jobParts ?? [])].map((item: any, index: number) => (
                  <Text key={`${item.id ?? item.inventoryItemId ?? index}`} style={{ color: colors.foreground, fontFamily: 'Inter_400Regular', fontSize: 14, marginBottom: 5 }}>
                    {item.name ?? item.itemName ?? 'Material'}{item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                  </Text>
                ))
              )}
            </View>
          </View>
        )}

        {!requiresChemicalApplication && !showMaterialsOrParts && (
          <View style={[styles.section, { marginBottom: 16 }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>General Service</Text>
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 14 }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Follow the job notes and instructions from dispatch. This service has no configured chemical or materials requirements.
              </Text>
            </View>
          </View>
        )}

        {/* Customer / Property notes (read-only, from dispatch) */}
        {((displayJob as any)?.customerNotes || (displayJob as any)?.propertyNotes) && (
          <View style={[styles.section, { marginBottom: 8 }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes from Dispatch</Text>
            {(displayJob as any).customerNotes ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border, alignItems: 'flex-start', padding: 12 }]}>
                <Text style={[{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }]}>Customer</Text>
                <Text style={[{ fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground }]}>{(displayJob as any).customerNotes}</Text>
              </View>
            ) : null}
            {(displayJob as any).propertyNotes ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border, alignItems: 'flex-start', padding: 12, marginTop: 8 }]}>
                <Text style={[{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }]}>Property</Text>
                <Text style={[{ fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground }]}>{(displayJob as any).propertyNotes}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Internal staff notes — read-only, only shown when online */}
        {!isOffline && (
          <InternalNotesSection jobId={jobId} colors={colors} />
        )}

        {/* Job Notes section */}
        {!isOffline && (
          <JobNotesSection jobId={jobId} job={displayJob as any} colors={colors} />
        )}

        <MediaAttachments
          media={jobMedia}
          isLoading={jobMediaLoading}
          isOffline={isOffline}
          onAdd={data => addJobMedia.mutateAsync({ id: jobId, data })}
          onDelete={mediaId => deleteJobMedia.mutateAsync({ id: jobId, mediaId })}
          onRefresh={() => { void refetchJobMedia(); }}
          uploadScope="job_media"
        />

        {/* Applications section */}
        {requiresChemicalApplication && <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Chemical Applications
          </Text>
          {displayApps.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="flask-outline" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No applications logged yet
              </Text>
            </View>
          ) : (
            displayApps.map((app) => (
              <AppCard key={app.id} app={app} colors={colors} />
            ))
          )}
        </View>}
      </ScrollView>

      {/* Log Application FAB — disabled offline */}
      {requiresChemicalApplication && <View
        style={[
          styles.fabContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: isOffline ? colors.mutedForeground : colors.primary }]}
          onPress={isOffline ? undefined : handleLogApplication}
          activeOpacity={isOffline ? 1 : 0.85}
          testID="log-application-button"
        >
          <Ionicons name={isOffline ? 'cloud-offline-outline' : 'add-circle-outline'} size={22} color="#ffffff" />
          <Text style={styles.fabText}>{isOffline ? 'Offline' : 'Log Application'}</Text>
        </TouchableOpacity>
      </View>}
    </View>
  );
}

function AppCard({ app, colors }: { app: ChemApp; colors: ReturnType<typeof useColors> }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <TouchableOpacity
      style={[styles.appCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => setExpanded((v) => !v)}
      activeOpacity={0.85}
    >
      <View style={styles.appCardHeader}>
        <View style={[styles.flaskIcon, { backgroundColor: colors.primary + '18' }]}>
          <Ionicons name="flask" size={18} color={colors.primary} />
        </View>
        <View style={styles.appCardInfo}>
          <Text style={[styles.appCardName, { color: colors.foreground }]} numberOfLines={1}>
            {app.mixtureName ?? app.productName ?? 'Chemical Application'}
          </Text>
          <Text style={[styles.appCardMeta, { color: colors.mutedForeground }]}>
            {app.volumeApplied} {app.volumeUnit} · {formatDate(app.appliedAt)}
          </Text>
          {app.targetPest ? (
            <Text style={[styles.appCardMeta, { color: colors.mutedForeground }]}>
              Target: {app.targetPest}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </View>

      {expanded && app.breakdown.length > 0 && (
        <View style={[styles.breakdown, { borderTopColor: colors.border }]}>
          <Text style={[styles.breakdownTitle, { color: colors.mutedForeground }]}>Breakdown</Text>
          {app.breakdown.map((item, i) => (
            <View key={i} style={[styles.breakdownRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.productName, { color: colors.foreground }]}>
                {item.productName ?? 'Unknown Product'}
              </Text>
              <Text style={[styles.breakdownDetail, { color: colors.mutedForeground }]}>
                {item.amountApplied?.toFixed(2)} {item.unit}
              </Text>
              {item.ratePerAcre != null && (
                <Text style={[styles.breakdownDetail, { color: colors.mutedForeground }]}>
                  Rate: {item.ratePerAcre} / acre · {item.ratePer1000Sqft} / 1000 sqft
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
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
  jobCard: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  messagesCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  messagesCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  messagesCardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  messagesCardHint: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  messagesCardRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  jobMessageBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  jobMessageBadgeText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  jobTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    flex: 1,
    lineHeight: 24,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    flexShrink: 0,
  },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 12, textTransform: 'capitalize' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  infoText: { fontFamily: 'Inter_400Regular', fontSize: 14, flex: 1 },
  directionsLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  section: { paddingHorizontal: 16 },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    marginBottom: 12,
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  appCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  appCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  flaskIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appCardInfo: { flex: 1 },
  appCardName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 3 },
  appCardMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 1 },
  breakdown: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  breakdownTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  breakdownRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  productName: { fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: 2 },
  breakdownDetail: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  clockCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clockLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginBottom: 2,
  },
  clockValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  clockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clockBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  clockDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#ffffff',
  },
});
