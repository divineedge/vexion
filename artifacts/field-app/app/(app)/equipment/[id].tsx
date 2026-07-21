import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useGetEquipment,
  useListEquipmentFuelLogs,
  useListEquipmentMaintenance,
  useCreateEquipmentReadingLog,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Equipment = {
  id: number;
  name: string;
  type: string;
  currentHours: number;
  currentMiles?: number | null;
  totalFuelCost: number;
  costPerHour?: number | null;
  maintenanceDue: boolean;
  nextServiceDueDate?: string | null;
  nextServiceDueHours?: number | null;
  nextServiceDueMiles?: number | null;
  hoursUntilService?: number | null;
  milesUntilService?: number | null;
};

type FuelLog = {
  id: number;
  date: string;
  gallons: number;
  cost: number;
  odometerReading?: number | null;
};

type MaintenanceRecord = {
  id: number;
  date: string;
  description: string;
  cost?: number | null;
  vendor?: string | null;
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

function MaintenanceBanner({
  eq,
  colors,
}: {
  eq: Equipment;
  colors: ReturnType<typeof useColors>;
}) {
  const isOverdue = eq.maintenanceDue;
  const hoursRemaining = eq.hoursUntilService;
  const milesRemaining = eq.milesUntilService;

  // Near-due: within 10 hours or 50 miles
  const isNearDueHours = !isOverdue && hoursRemaining != null && hoursRemaining <= 10;
  const isNearDueMiles = !isOverdue && milesRemaining != null && milesRemaining <= 50;
  const isNearDue = isNearDueHours || isNearDueMiles;

  if (!isOverdue && !isNearDue) return null;

  const bgColor = isOverdue ? '#fef2f2' : '#fffbeb';
  const borderColor = isOverdue ? '#fca5a5' : '#fcd34d';
  const iconColor = isOverdue ? '#ef4444' : '#f59e0b';
  const textColor = isOverdue ? '#991b1b' : '#92400e';

  const lines: string[] = [];
  if (isOverdue) {
    lines.push('Maintenance is overdue — notify the office.');
  } else {
    lines.push('Service coming up soon.');
  }

  if (hoursRemaining != null) {
    if (hoursRemaining < 0) {
      lines.push(`${Math.abs(Math.floor(hoursRemaining))} hrs past due (hours)`);
    } else {
      lines.push(`${Math.ceil(hoursRemaining)} hrs until next service`);
    }
  }
  if (milesRemaining != null) {
    if (milesRemaining < 0) {
      lines.push(`${Math.abs(Math.floor(milesRemaining))} mi past due (miles)`);
    } else {
      lines.push(`${Math.ceil(milesRemaining)} mi until next service`);
    }
  }
  if (eq.nextServiceDueDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (eq.nextServiceDueDate <= today) {
      lines.push(`Date threshold: ${formatDate(eq.nextServiceDueDate)} (passed)`);
    } else {
      lines.push(`Date threshold: ${formatDate(eq.nextServiceDueDate)}`);
    }
  }

  return (
    <View style={[styles.banner, { backgroundColor: bgColor, borderColor }]}>
      <Ionicons name={isOverdue ? 'alert-circle' : 'warning'} size={20} color={iconColor} />
      <View style={styles.bannerBody}>
        {lines.map((line, i) => (
          <Text
            key={i}
            style={[
              i === 0 ? styles.bannerTitle : styles.bannerLine,
              { color: textColor },
            ]}
          >
            {line}
          </Text>
        ))}
      </View>
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
  const {
    data: maintenanceLogs,
    isLoading: maintLoading,
    refetch: refetchMaint,
  } = useListEquipmentMaintenance(equipmentId);

  const isLoading = eqLoading || logsLoading || maintLoading;

  // Log Hours modal state
  const [showLogHours, setShowLogHours] = useState(false);
  const [hoursValue, setHoursValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { mutateAsync: createReadingLog } = useCreateEquipmentReadingLog();

  const handleLogFuel = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/equipment-fuel/${equipmentId}`);
  }, [equipmentId]);

  const handleLogMaintenance = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/equipment-maintenance/${equipmentId}` as any);
  }, [equipmentId]);

  const handleOpenLogHours = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const eq = equipment as Equipment | undefined;
    setHoursValue(eq ? String(eq.currentHours) : '');
    setShowLogHours(true);
  }, [equipment]);

  const handleSubmitHours = useCallback(async () => {
    const parsed = parseFloat(hoursValue);
    if (isNaN(parsed) || parsed < 0) {
      Alert.alert('Invalid', 'Please enter a valid hour reading.');
      return;
    }
    setSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await createReadingLog({ id: equipmentId, data: { date: today, readingType: 'hours', value: parsed } });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowLogHours(false);
      setHoursValue('');
      refetchEq();
    } catch {
      Alert.alert('Error', 'Failed to save reading. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [hoursValue, equipmentId, createReadingLog, refetchEq]);

  const refetch = useCallback(() => {
    refetchEq();
    refetchLogs();
    refetchMaint();
  }, [refetchEq, refetchLogs, refetchMaint]);

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
  const maint = (maintenanceLogs as MaintenanceRecord[] | undefined) ?? [];

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
        {/* Maintenance warning banner */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <MaintenanceBanner eq={eq} colors={colors} />
        </View>

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

        {/* Next service info */}
        {(eq.nextServiceDueHours != null || eq.nextServiceDueMiles != null || eq.nextServiceDueDate) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Next Scheduled Service</Text>
            <View style={[styles.serviceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {eq.nextServiceDueHours != null && (
                <View style={styles.serviceRow}>
                  <Ionicons name="time-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.serviceLabel, { color: colors.mutedForeground }]}>Hours threshold</Text>
                  <Text style={[styles.serviceValue, { color: colors.foreground }]}>
                    {eq.nextServiceDueHours.toLocaleString()} hrs
                  </Text>
                </View>
              )}
              {eq.nextServiceDueMiles != null && (
                <View style={styles.serviceRow}>
                  <Ionicons name="speedometer-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.serviceLabel, { color: colors.mutedForeground }]}>Miles threshold</Text>
                  <Text style={[styles.serviceValue, { color: colors.foreground }]}>
                    {eq.nextServiceDueMiles.toLocaleString()} mi
                  </Text>
                </View>
              )}
              {eq.nextServiceDueDate && (
                <View style={styles.serviceRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.serviceLabel, { color: colors.mutedForeground }]}>Date</Text>
                  <Text style={[styles.serviceValue, { color: colors.foreground }]}>
                    {formatDate(eq.nextServiceDueDate)}
                  </Text>
                </View>
              )}
              {eq.hoursUntilService != null && (
                <View style={[styles.serviceRow, styles.serviceRowHighlight]}>
                  <Ionicons
                    name={eq.hoursUntilService < 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                    size={16}
                    color={eq.hoursUntilService < 0 ? '#ef4444' : '#22c55e'}
                  />
                  <Text style={[styles.serviceLabel, { color: colors.mutedForeground }]}>Hours remaining</Text>
                  <Text
                    style={[
                      styles.serviceValue,
                      { color: eq.hoursUntilService < 0 ? '#ef4444' : '#22c55e' },
                    ]}
                  >
                    {eq.hoursUntilService < 0
                      ? `${Math.abs(Math.floor(eq.hoursUntilService))} hrs overdue`
                      : `${Math.ceil(eq.hoursUntilService)} hrs`}
                  </Text>
                </View>
              )}
              {eq.milesUntilService != null && (
                <View style={[styles.serviceRow, styles.serviceRowHighlight]}>
                  <Ionicons
                    name={eq.milesUntilService < 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                    size={16}
                    color={eq.milesUntilService < 0 ? '#ef4444' : '#22c55e'}
                  />
                  <Text style={[styles.serviceLabel, { color: colors.mutedForeground }]}>Miles remaining</Text>
                  <Text
                    style={[
                      styles.serviceValue,
                      { color: eq.milesUntilService < 0 ? '#ef4444' : '#22c55e' },
                    ]}
                  >
                    {eq.milesUntilService < 0
                      ? `${Math.abs(Math.floor(eq.milesUntilService))} mi overdue`
                      : `${Math.ceil(eq.milesUntilService)} mi`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Maintenance history */}
        <View style={[styles.section, { marginBottom: 8 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Maintenance</Text>
          {maint.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="construct-outline" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No maintenance records yet</Text>
            </View>
          ) : (
            maint.map((record) => (
              <View
                key={record.id}
                style={[styles.logRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                testID={`maintenance-record-${record.id}`}
              >
                <View style={[styles.logIcon, { backgroundColor: '#f59e0b18' }]}>
                  <Ionicons name="construct" size={16} color="#f59e0b" />
                </View>
                <View style={styles.logBody}>
                  <Text style={[styles.logGallons, { color: colors.foreground }]} numberOfLines={1}>
                    {record.description}
                  </Text>
                  <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
                    {formatDate(record.date)}
                    {record.cost != null ? `  ·  ${record.cost.toFixed(2)}` : ''}
                    {record.vendor ? `  ·  ${record.vendor}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
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

      {/* Action FABs */}
      <View
        style={[
          styles.fabContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: '#f59e0b' }]}
          onPress={handleLogMaintenance}
          activeOpacity={0.85}
          testID="log-maintenance-button"
        >
          <Ionicons name="construct-outline" size={20} color="#ffffff" />
          <Text style={styles.fabText}>Log Maintenance</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: '#6366f1' }]}
          onPress={handleOpenLogHours}
          activeOpacity={0.85}
          testID="log-hours-button"
        >
          <Ionicons name="time-outline" size={20} color="#ffffff" />
          <Text style={styles.fabText}>Log Hours</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handleLogFuel}
          activeOpacity={0.85}
          testID="log-fuel-button"
        >
          <Ionicons name="water-outline" size={20} color="#ffffff" />
          <Text style={styles.fabText}>Log Fuel Fill</Text>
        </TouchableOpacity>
      </View>

      {/* Log Hours Modal */}
      <Modal
        visible={showLogHours}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogHours(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log Hour-Meter Reading</Text>
              <TouchableOpacity onPress={() => setShowLogHours(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>
              Current hours on the meter
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
              value={hoursValue}
              onChangeText={setHoursValue}
              keyboardType="decimal-pad"
              placeholder="e.g. 1234.5"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              selectTextOnFocus
              testID="log-hours-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                onPress={() => setShowLogHours(false)}
                disabled={submitting}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#6366f1', opacity: submitting ? 0.6 : 1 }]}
                onPress={handleSubmitHours}
                disabled={submitting}
                testID="log-hours-submit"
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>Save Reading</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginBottom: 4,
  },
  bannerBody: { flex: 1, gap: 2 },
  bannerTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  bannerLine: { fontFamily: 'Inter_400Regular', fontSize: 12 },
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
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 12 },
  serviceCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  serviceRowHighlight: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  serviceLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  serviceValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
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
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 10,
  },
  fab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#ffffff' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  modalLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  modalInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 17,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
