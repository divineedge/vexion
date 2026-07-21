import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useListRecurringSeries,
  useSkipNextOccurrence,
  useListJobs,
  usePauseRecurringSeries,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Return true if the string looks like a parseable date (YYYY-MM-DD or similar) */
function isValidDateString(value: string): boolean {
  if (!value.trim()) return false;
  const d = new Date(value.trim());
  return !isNaN(d.getTime());
}

type RawJob = {
  id: number;
  title: string;
  status: string;
  scheduledAt: string;
  recurrenceParentId?: number | null;
  recurrenceIndex?: number | null;
};

export default function SeriesDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const seriesId = Number(id);

  const [pauseModalVisible, setPauseModalVisible] = useState(false);
  const [resumeDateInput, setResumeDateInput] = useState('');
  const [dateError, setDateError] = useState('');

  const {
    data: allSeries,
    isLoading: seriesLoading,
    refetch: refetchSeries,
    isFetching: seriesFetching,
  } = useListRecurringSeries();

  // Scope jobs to the current user when they are a technician, matching the
  // same access-control pattern used in the jobs list screen.
  const {
    data: allJobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isFetching: jobsFetching,
  } = useListJobs(
    user?.role === 'technician' ? { assigneeId: user.id } : undefined,
  );

  const skipOccurrence = useSkipNextOccurrence();
  const pauseSeries = usePauseRecurringSeries();

  const series = allSeries?.find((s) => s.id === seriesId);

  // Collect all instances in this series: root (seriesId itself) + generated children
  const seriesJobs = (allJobs as RawJob[] | undefined)
    ?.filter((j) => j.id === seriesId || j.recurrenceParentId === seriesId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    ?? [];

  const upcomingJobs = seriesJobs.filter(
    (j) => j.status !== 'completed' && j.status !== 'cancelled',
  );
  const pastJobs = seriesJobs.filter(
    (j) => j.status === 'completed' || j.status === 'cancelled',
  );

  const isLoading = seriesLoading || jobsLoading;
  const isFetching = seriesFetching || jobsFetching;

  const refetch = useCallback(() => {
    refetchSeries();
    refetchJobs();
  }, [refetchSeries, refetchJobs]);

  const handleSkip = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Skip next occurrence?',
      series?.nextScheduledAt
        ? `The occurrence on ${formatDate(series.nextScheduledAt)} will be skipped.`
        : 'The next scheduled occurrence will be skipped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () =>
            skipOccurrence.mutate(
              { id: seriesId },
              {
                onSuccess: () => {
                  refetch();
                  Alert.alert('Skipped', 'The next occurrence has been skipped.');
                },
              },
            ),
        },
      ],
    );
  }, [seriesId, series, skipOccurrence, refetch]);

  const openPauseModal = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setResumeDateInput('');
    setDateError('');
    setPauseModalVisible(true);
  }, []);

  const confirmPause = useCallback(() => {
    const trimmed = resumeDateInput.trim();
    if (trimmed && !isValidDateString(trimmed)) {
      setDateError('Enter a valid date, e.g. 2025-03-01, or leave it blank.');
      return;
    }
    setPauseModalVisible(false);
    pauseSeries.mutate(
      {
        id: seriesId,
        data: {
          paused: true,
          ...(trimmed ? { resumeAt: new Date(trimmed).toISOString() } : {}),
        },
      },
      {
        onSuccess: () => {
          refetch();
          Alert.alert(
            'Series paused',
            trimmed
              ? `This series has been paused and will resume on ${formatDate(new Date(trimmed).toISOString())}.`
              : 'This series has been paused. Resume it manually when ready.',
          );
        },
        onError: () => {
          Alert.alert('Error', 'Could not pause this series. Please try again.');
        },
      },
    );
  }, [seriesId, resumeDateInput, pauseSeries, refetch]);

  const handleResume = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Resume series?',
      'Scheduling will restart from the next occurrence date.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () =>
            pauseSeries.mutate(
              { id: seriesId, data: { paused: false } },
              {
                onSuccess: () => {
                  refetch();
                  Alert.alert('Series resumed', 'This series is now active again.');
                },
                onError: () => {
                  Alert.alert('Error', 'Could not resume this series. Please try again.');
                },
              },
            ),
        },
      ],
    );
  }, [seriesId, pauseSeries, refetch]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 80;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!series) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="refresh-circle-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Series not found</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
          This recurring series may have been cancelled.
        </Text>
      </View>
    );
  }

  const isPaused = series.isRecurrencePaused;
  const isMutating = skipOccurrence.isPending || pauseSeries.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Series info card */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoHeader}>
            <View style={[styles.recurIcon, { backgroundColor: colors.primary + '18' }]}>
              <Text style={[styles.recurIconText, { color: colors.primary }]}>↻</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.seriesTitle, { color: colors.foreground }]} numberOfLines={2}>
                {series.title}
              </Text>
              <Text style={[styles.seriesPattern, { color: colors.primary }]}>
                {series.recurrenceDescription}
              </Text>
            </View>
            {isPaused ? (
              <View style={[styles.pausedBadge, { backgroundColor: '#f59e0b18' }]}>
                <Text style={[styles.pausedBadgeText, { color: '#f59e0b' }]}>Paused</Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {series.completedCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Completed</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {upcomingJobs.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Upcoming</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: series.nextScheduledAt ? colors.primary : colors.mutedForeground }]}>
                {series.nextScheduledAt ? formatShortDate(series.nextScheduledAt) : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Next date</Text>
            </View>
          </View>

          {series.customerName ? (
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{series.customerName}</Text>
            </View>
          ) : null}

          {series.assigneeName ? (
            <View style={styles.metaRow}>
              <Ionicons name="hammer-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{series.assigneeName}</Text>
            </View>
          ) : null}

          {series.crewName ? (
            <View style={styles.metaRow}>
              <Ionicons name="people-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{series.crewName}</Text>
            </View>
          ) : null}

          {series.resumeAt ? (
            <View style={[styles.resumeRow, { backgroundColor: '#f59e0b10', borderColor: '#f59e0b30' }]}>
              <Ionicons name="time-outline" size={14} color="#f59e0b" />
              <Text style={[styles.resumeText, { color: '#f59e0b' }]}>
                Resumes {formatDate(series.resumeAt)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Upcoming occurrences */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Upcoming Dates
          </Text>
          {upcomingJobs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="calendar-outline" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No upcoming occurrences scheduled
              </Text>
            </View>
          ) : (
            upcomingJobs.map((job, idx) => (
              <OccurrenceRow
                key={job.id}
                job={job}
                isNext={idx === 0}
                colors={colors}
              />
            ))
          )}
        </View>

        {/* Past occurrences */}
        {pastJobs.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Past Occurrences
            </Text>
            {pastJobs.slice(-5).reverse().map((job) => (
              <OccurrenceRow
                key={job.id}
                job={job}
                isNext={false}
                colors={colors}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Action FABs */}
      <View
        style={[
          styles.fabContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        {isPaused ? (
          /* Resume button */
          <TouchableOpacity
            style={[styles.resumeFab, { backgroundColor: '#16a34a', opacity: isMutating ? 0.6 : 1 }]}
            onPress={handleResume}
            disabled={isMutating}
            activeOpacity={0.85}
          >
            {pauseSeries.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="play-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.fabText}>Resume Series</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          /* Active series: skip + pause */
          <View style={styles.fabRow}>
            {series.nextScheduledAt ? (
              <TouchableOpacity
                style={[styles.skipFab, { opacity: isMutating ? 0.6 : 1 }]}
                onPress={handleSkip}
                disabled={isMutating}
                activeOpacity={0.85}
              >
                {skipOccurrence.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={20} color="#ffffff" />
                    <Text style={styles.fabText}>Skip Next</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.pauseFab, { opacity: isMutating ? 0.6 : 1 }]}
              onPress={openPauseModal}
              disabled={isMutating}
              activeOpacity={0.85}
            >
              {pauseSeries.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="pause-circle-outline" size={20} color="#ffffff" />
                  <Text style={styles.fabText}>Pause Series</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Pause modal – resume date input */}
      <Modal
        visible={pauseModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPauseModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="pause-circle-outline" size={24} color="#f59e0b" />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Pause Series</Text>
            </View>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              No new occurrences will be scheduled while this series is paused.
              {'\n\n'}Optionally set a date when it should automatically resume (e.g. start of next season).
            </Text>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Resume date (optional)</Text>
            <TextInput
              style={[
                styles.dateInput,
                {
                  backgroundColor: colors.background,
                  borderColor: dateError ? '#ef4444' : colors.border,
                  color: colors.foreground,
                },
              ]}
              placeholder="YYYY-MM-DD  or  Month DD, YYYY"
              placeholderTextColor={colors.mutedForeground}
              value={resumeDateInput}
              onChangeText={(t) => {
                setResumeDateInput(t);
                if (dateError) setDateError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={confirmPause}
            />
            {dateError ? (
              <Text style={styles.inputError}>{dateError}</Text>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: colors.border }]}
                onPress={() => setPauseModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={confirmPause}
              >
                <Text style={[styles.modalBtnText, { color: '#ffffff' }]}>Pause Series</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function OccurrenceRow({
  job,
  isNext,
  colors,
}: {
  job: RawJob;
  isNext: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const statusColorMap: Record<string, string> = {
    scheduled: colors.statusScheduled,
    in_progress: colors.statusInProgress,
    completed: colors.statusCompleted,
    cancelled: colors.statusCancelled,
    on_hold: colors.statusOnHold,
    skipped: colors.mutedForeground,
  };
  const sc = statusColorMap[job.status] ?? colors.mutedForeground;

  return (
    <View
      style={[
        styles.occurrenceRow,
        {
          backgroundColor: isNext ? colors.primary + '08' : colors.card,
          borderColor: isNext ? colors.primary + '30' : colors.border,
        },
      ]}
    >
      <View style={[styles.occurrenceDot, { backgroundColor: sc }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.occurrenceDate, { color: colors.foreground }]}>
          {formatShortDate(job.scheduledAt)}
          {isNext ? (
            <Text style={{ color: colors.primary }}> · Next</Text>
          ) : null}
        </Text>
        {job.recurrenceIndex != null ? (
          <Text style={[styles.occurrenceIdx, { color: colors.mutedForeground }]}>
            Occurrence #{job.recurrenceIndex + 1}
          </Text>
        ) : null}
      </View>
      <View style={[styles.statusPill, { backgroundColor: sc + '22' }]}>
        <Text style={[styles.statusPillText, { color: sc }]}>
          {job.status.replace('_', ' ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  infoCard: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  recurIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recurIconText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  seriesTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    marginBottom: 3,
  },
  seriesPattern: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  pausedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexShrink: 0,
  },
  pausedBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 14 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 2 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  metaText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    padding: 8,
    borderRadius: 7,
    borderWidth: 1,
  },
  resumeText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    marginBottom: 10,
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  occurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  occurrenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  occurrenceDate: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 2 },
  occurrenceIdx: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  fabRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skipFab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 8,
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  pauseFab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 8,
    backgroundColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  resumeFab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 8,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#ffffff',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  modalBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  inputLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginBottom: -4,
  },
  dateInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  inputError: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#ef4444',
    marginTop: -4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimary: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  modalBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
