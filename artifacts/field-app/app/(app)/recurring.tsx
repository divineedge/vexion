import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useListRecurringSeries } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Series = {
  id: number;
  title: string;
  recurrenceDescription?: string | null;
  nextScheduledAt?: string | null;
  isRecurrencePaused?: boolean | null;
  customerName?: string | null;
  assigneeName?: string | null;
  completedCount?: number | null;
};

function formatNextDate(iso: string | null | undefined): string {
  if (!iso) return 'No upcoming date';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function SeriesCard({
  series,
  onPress,
  colors,
}: {
  series: Series;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isPaused = series.isRecurrencePaused;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
      testID={`series-card-${series.id}`}
    >
      <View style={styles.cardMain}>
        <View style={[styles.recurIcon, { backgroundColor: colors.primary + '18' }]}>
          <Text style={[styles.recurIconText, { color: colors.primary }]}>↻</Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={[styles.seriesTitle, { color: colors.foreground }]} numberOfLines={1}>
              {series.title}
            </Text>
            {isPaused ? (
              <View style={[styles.pausedBadge, { backgroundColor: '#f59e0b18' }]}>
                <Text style={[styles.pausedBadgeText, { color: '#f59e0b' }]}>Paused</Text>
              </View>
            ) : (
              <View style={[styles.activeBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.activeBadgeText, { color: colors.primary }]}>Active</Text>
              </View>
            )}
          </View>

          {series.recurrenceDescription ? (
            <Text style={[styles.pattern, { color: colors.primary }]} numberOfLines={1}>
              {series.recurrenceDescription}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {isPaused ? 'Paused · ' : 'Next: '}
              {formatNextDate(series.nextScheduledAt)}
            </Text>
          </View>

          {series.customerName ? (
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {series.customerName}
              </Text>
            </View>
          ) : null}

          {series.completedCount != null && series.completedCount > 0 ? (
            <View style={styles.metaRow}>
              <Ionicons name="checkmark-circle-outline" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {series.completedCount} completed
              </Text>
            </View>
          ) : null}
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

export default function RecurringScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: seriesList, isLoading, isError, refetch, isFetching } =
    useListRecurringSeries();

  const handleSeriesPress = useCallback(async (id: number) => {
    await Haptics.selectionAsync();
    router.push(`/(app)/series/${id}`);
  }, []);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16;

  const activeSeries = (seriesList as Series[] | undefined)?.filter(
    (s) => !s.isRecurrencePaused,
  ) ?? [];
  const pausedSeries = (seriesList as Series[] | undefined)?.filter(
    (s) => s.isRecurrencePaused,
  ) ?? [];

  // Active first, then paused; within each group sort by next date (soonest first)
  const sorted = [
    ...activeSeries.sort((a, b) => {
      if (!a.nextScheduledAt) return 1;
      if (!b.nextScheduledAt) return -1;
      return new Date(a.nextScheduledAt).getTime() - new Date(b.nextScheduledAt).getTime();
    }),
    ...pausedSeries.sort((a, b) => a.title.localeCompare(b.title)),
  ];

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
          Loading recurring series…
        </Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="wifi-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Couldn't load series
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { borderColor: colors.border }]}
          onPress={() => refetch()}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={sorted}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <SeriesCard
            series={item}
            onPress={() => handleSeriesPress(item.id)}
            colors={colors}
          />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad },
          sorted.length === 0 && styles.listEmpty,
        ]}
        scrollEnabled={sorted.length > 0}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => { void refetch(); }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          sorted.length > 0 ? (
            <View style={styles.summaryRow}>
              <View style={[styles.summaryChip, { backgroundColor: colors.primary + '14' }]}>
                <Text style={[styles.summaryChipText, { color: colors.primary }]}>
                  {activeSeries.length} active
                </Text>
              </View>
              {pausedSeries.length > 0 ? (
                <View style={[styles.summaryChip, { backgroundColor: '#f59e0b14' }]}>
                  <Text style={[styles.summaryChipText, { color: '#f59e0b' }]}>
                    {pausedSeries.length} paused
                  </Text>
                </View>
              ) : null}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="refresh-circle-outline" size={52} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No recurring series
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Recurring schedules created from jobs will appear here
            </Text>
          </View>
        }
      />
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
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 8,
  },
  list: { padding: 16, gap: 10 },
  listEmpty: { flex: 1 },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  summaryChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  summaryChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recurIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recurIconText: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seriesTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    flex: 1,
  },
  pausedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
  },
  pausedBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  activeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
  },
  activeBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  pattern: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    flex: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
    marginTop: 4,
  },
  retryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
});
