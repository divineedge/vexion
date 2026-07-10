import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useGetJob, useListJobChemicalApplications } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

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

export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);

  const { data: job, isLoading: jobLoading, refetch: refetchJob } = useGetJob(jobId);
  const {
    data: applications,
    isLoading: appsLoading,
    refetch: refetchApps,
    isFetching,
  } = useListJobChemicalApplications(jobId);

  const isLoading = jobLoading || appsLoading;

  const handleLogApplication = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/log/${jobId}`);
  }, [jobId]);

  const refetch = useCallback(() => {
    refetchJob();
    refetchApps();
  }, [refetchJob, refetchApps]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.destructive }]}>Job not found</Text>
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
  const statusColor = statusMap[(job as { status: string }).status] ?? colors.mutedForeground;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
            <Text style={[styles.jobTitle, { color: colors.foreground }]}>{(job as { title: string }).title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {(job as { status: string }).status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          {(job as { propertyAddress?: string | null }).propertyAddress ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {(job as { propertyAddress: string }).propertyAddress}
              </Text>
            </View>
          ) : null}
          {(job as { customerName?: string | null }).customerName ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {(job as { customerName: string }).customerName}
              </Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {formatDate((job as { scheduledAt: string }).scheduledAt)}
            </Text>
          </View>
        </View>

        {/* Applications section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Chemical Applications
          </Text>
          {!applications || (applications as ChemApp[]).length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="flask-outline" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No applications logged yet
              </Text>
            </View>
          ) : (
            (applications as ChemApp[]).map((app) => (
              <AppCard key={app.id} app={app} colors={colors} />
            ))
          )}
        </View>
      </ScrollView>

      {/* Log Application FAB */}
      <View
        style={[
          styles.fabContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handleLogApplication}
          activeOpacity={0.85}
          testID="log-application-button"
        >
          <Ionicons name="add-circle-outline" size={22} color="#ffffff" />
          <Text style={styles.fabText}>Log Application</Text>
        </TouchableOpacity>
      </View>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  jobCard: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
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
