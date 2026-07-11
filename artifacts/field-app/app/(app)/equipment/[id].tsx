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
import { useGetEquipment, useListEquipmentFuelLogs } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Equipment = {
  id: number;
  name: string;
  type: string;
  currentHours: number;
  currentMiles?: number | null;
  totalFuelCost: number;
  costPerHour?: number | null;
};

type FuelLog = {
  id: number;
  date: string;
  gallons: number;
  cost: number;
  odometerReading?: number | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatBox({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.statBox, { backgroundColor: colors.muted }]}>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

export default function EquipmentDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const equipmentId = Number(id);

  const { data: equipment, isLoading: eqLoading, refetch: refetchEq } = useGetEquipment(equipmentId);
  const {
    data: fuelLogs,
    isLoading: logsLoading,
    refetch: refetchLogs,
    isFetching,
  } = useListEquipmentFuelLogs(equipmentId);

  const isLoading = eqLoading || logsLoading;

  const handleLogFuel = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/equipment-fuel/${equipmentId}`);
  }, [equipmentId]);

  const refetch = useCallback(() => {
    refetchEq();
    refetchLogs();
  }, [refetchEq, refetchLogs]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const eq = equipment as Equipment | undefined;
  const logs = (fuelLogs as FuelLog[] | undefined) ?? [];

  if (!eq) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.destructive }]}>Equipment not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Equipment info card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{eq.name}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{eq.type}</Text>

          <View style={styles.statsRow}>
            <StatBox label="Current Hours" value={eq.currentHours.toLocaleString()} colors={colors} />
            <StatBox
              label="Cost / Hour"
              value={eq.costPerHour != null ? `$${eq.costPerHour.toFixed(2)}` : 'N/A'}
              colors={colors}
            />
            <StatBox label="Total Fuel Cost" value={`$${eq.totalFuelCost.toFixed(2)}`} colors={colors} />
          </View>
        </View>

        {/* Fuel log history */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Fuel Fills</Text>
          {logs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="water-outline" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No fuel fills logged yet</Text>
            </View>
          ) : (
            logs.map((log) => (
              <View
                key={log.id}
                style={[styles.logRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                testID={`fuel-log-${log.id}`}
              >
                <View style={[styles.logIcon, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons name="water" size={16} color={colors.primary} />
                </View>
                <View style={styles.logBody}>
                  <Text style={[styles.logGallons, { color: colors.foreground }]}>
                    {log.gallons} gal · ${log.cost.toFixed(2)}
                  </Text>
                  <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
                    {formatDate(log.date)}
                    {log.odometerReading != null ? `  ·  ${log.odometerReading.toLocaleString()} hrs` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Log Fuel FAB */}
      <View
        style={[
          styles.fabContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handleLogFuel}
          activeOpacity={0.85}
          testID="log-fuel-button"
        >
          <Ionicons name="add-circle-outline" size={22} color="#ffffff" />
          <Text style={styles.fabText}>Log Fuel Fill</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  card: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 4 },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textTransform: 'capitalize',
    marginBottom: 16,
  },
  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: {
    flex: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
    textAlign: 'center',
  },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 12 },
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
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  logIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logBody: { flex: 1 },
  logGallons: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 2 },
  logMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
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
  fabText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#ffffff' },
});
