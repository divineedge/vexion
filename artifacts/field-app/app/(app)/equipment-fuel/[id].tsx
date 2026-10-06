import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetEquipment,
  useCreateEquipmentFuelLog,
  useListBulkFuelTanks,
  getListBulkFuelTanksQueryKey,
  getGetEquipmentQueryKey,
  getListEquipmentFuelLogsQueryKey,
  getGetEquipmentLedgerQueryKey,
  getGetEquipmentFuelUsageQueryKey,
  type EquipmentFuelLogInput,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { FuelSourceFields, type FuelSource, useBulkMeterEntry, isMeterActive, isMeterStale, meterValidationError, meterPayload } from '@/components/FuelSourceFields';
import { tenantDateKey } from '@/utils/schedule';

type Equipment = { id: number; name: string; currentHours: number };

function Field({
  label,
  children,
  required,
  colors,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
        {required && <Text style={{ color: colors.destructive }}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

function StyledInput({
  value,
  onChangeText,
  placeholder,
  colors,
  error,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
  error?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType="decimal-pad"
      style={[
        styles.input,
        {
          color: colors.foreground,
          backgroundColor: colors.muted,
          borderColor: error ? colors.destructive : colors.border,
        },
      ]}
    />
  );
}

export default function LogFuelFillScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tenantTimezone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const [submissionDate] = useState(() => tenantDateKey(new Date(), tenantTimezone));
  const { id, jobId } = useLocalSearchParams<{ id: string; jobId?: string }>();
  const equipmentId = Number(id);
  const linkedJobId = jobId ? Number(jobId) : null;

  const { data: equipment } = useGetEquipment(equipmentId);
  const eq = equipment as Equipment | undefined;
  const createMutation = useCreateEquipmentFuelLog();
  const queryClient = useQueryClient();
  const bulkTanksQuery = useListBulkFuelTanks({ includeInactive: false });
  const bulkTanks = bulkTanksQuery.data ?? [];

  const [gallons, setGallons] = useState('');
  const [cost, setCost] = useState('');
  const [fuelSource, setFuelSource] = useState<FuelSource>('purchased');
  const [bulkFuelTankId, setBulkFuelTankId] = useState<number | null>(null);
  const [hoursReading, setHoursReading] = useState('');
  const meter = useBulkMeterEntry();
  const { resetForTank, meterReading, expectedMeterReading, meterMode } = meter;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idempotencyKey = useRef(`fuel-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    idempotencyKey.current = `fuel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [gallons, cost, fuelSource, bulkFuelTankId, meterReading, expectedMeterReading, meterMode, hoursReading, linkedJobId]);

  const handleFuelSourceChange = useCallback((source: FuelSource) => {
    setFuelSource(source);
    setBulkFuelTankId(null);
    setGallons('');
    resetForTank(null);
    if (source === 'bulk_tank') setCost('');
  }, [resetForTank]);

  const handleTankChange = useCallback((tankId: number | null) => {
    setBulkFuelTankId(tankId);
    setGallons('');
    // Snapshot the prior meter reading at selection; refetches never silently replace it.
    resetForTank(bulkTanks.find(tank => tank.id === tankId) ?? null);
  }, [bulkTanks, resetForTank]);

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    const meterTank = bulkTanks.find(tank => tank.id === bulkFuelTankId);
    if (isMeterActive(fuelSource, meter) && meterTank) {
      const meterError = meterValidationError(meter);
      if (meterError) e.meter = meterError;
      else if (isMeterStale(meterTank, meter)) e.meter = 'The previous reading changed. Confirm the new previous reading before saving.';
    }
    if (!gallons || isNaN(Number(gallons)) || Number(gallons) <= 0) {
      e.gallons = 'Enter a valid amount of gallons';
    }
    if (cost && (isNaN(Number(cost)) || Number(cost) < 0)) {
      e.cost = 'Enter a non-negative cost';
    }
    const selectedTank = bulkTanks.find(tank => tank.id === bulkFuelTankId);
    if (fuelSource === 'bulk_tank' && (bulkFuelTankId == null || !selectedTank)) {
      e.tank = 'Choose an available bulk tank';
    }
    if (fuelSource === 'bulk_tank' && selectedTank && selectedTank.availableGallons < Number(gallons)) {
      e.tank = 'This tank does not have enough fuel for this fill';
    }
    if (hoursReading && isNaN(Number(hoursReading))) {
      e.hoursReading = 'Enter a valid hours reading';
    }
    if (
      hoursReading &&
      !isNaN(Number(hoursReading)) &&
      eq &&
      Number(hoursReading) < eq.currentHours
    ) {
      e.hoursReading = `Must be at least the current reading (${eq.currentHours.toLocaleString()} hrs)`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [gallons, cost, hoursReading, eq, fuelSource, bulkFuelTankId, bulkTanks, meter]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const body: EquipmentFuelLogInput = {
        date: submissionDate,
        gallons: Number(gallons),
        fuelSource,
      };
      if (fuelSource === 'bulk_tank') {
        const selectedTank = bulkTanks.find(tank => tank.id === bulkFuelTankId);
        if (!selectedTank) return;
        body.bulkFuelTankId = selectedTank.id;
        body.idempotencyKey = idempotencyKey.current;
        Object.assign(body, meterPayload(fuelSource, meter));
      } else if (cost.trim()) {
        body.cost = Number(cost);
      }
      if (hoursReading.trim()) body.odometerReading = Number(hoursReading);
      if (linkedJobId != null) body.jobId = linkedJobId;

      const result = await createMutation.mutateAsync({ id: equipmentId, data: body });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListBulkFuelTanksQueryKey({ includeInactive: false }) }),
        queryClient.invalidateQueries({ queryKey: getGetEquipmentQueryKey(equipmentId) }),
        queryClient.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipmentId) }),
        queryClient.invalidateQueries({ queryKey: getGetEquipmentLedgerQueryKey(equipmentId) }),
        queryClient.invalidateQueries({ queryKey: getGetEquipmentFuelUsageQueryKey() }),
      ]);
      idempotencyKey.current = `fuel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      Alert.alert(
        'Fuel fill recorded',
        `${result.gallons} gallons recorded on the selected equipment for $${result.cost.toFixed(2)}${result.fuelSource === 'bulk_tank' && result.bulkFuelTankName ? ` from ${result.bulkFuelTankName}` : ''}.`,
        [{ text: 'Done', onPress: () => router.back() }],
        { cancelable: false },
      );
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Keep the entry; refresh tanks so a changed previous reading is surfaced for explicit confirmation.
      void bulkTanksQuery.refetch();
      Alert.alert('Could not confirm fuel fill', 'Your entry is kept. Retry without changing it; a repeat will not record fuel twice. If the tank meter changed, confirm the new previous reading first.');
    }
  }, [validate, gallons, cost, fuelSource, bulkFuelTankId, bulkTanks, meter, bulkTanksQuery, hoursReading, createMutation, equipmentId, linkedJobId, queryClient, submissionDate]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        <View style={styles.form}>
          {eq ? (
            <Text style={[styles.equipmentName, { color: colors.foreground }]}>{eq.name}</Text>
          ) : null}

          {linkedJobId != null && (
            <View style={[styles.jobBanner, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
              <Ionicons name="briefcase-outline" size={15} color={colors.primary} />
              <Text style={[styles.jobBannerText, { color: colors.primary }]}>
                Fuel cost will be attributed to this job
              </Text>
            </View>
          )}

          <FuelSourceFields
            source={fuelSource}
            onSourceChange={handleFuelSourceChange}
            gallons={gallons}
            onGallonsChange={setGallons}
            cost={cost}
            onCostChange={setCost}
            bulkFuelTankId={bulkFuelTankId}
            onBulkFuelTankChange={handleTankChange}
            meter={meter}
            onRefreshTanks={() => void bulkTanksQuery.refetch()}
            meterError={errors.meter}
            tanks={bulkTanks}
            tanksLoading={bulkTanksQuery.isLoading}
            tanksError={!!bulkTanksQuery.error}
            colors={colors}
            gallonsError={errors.gallons}
            costError={errors.cost}
            tankError={errors.tank}
          />

          <Field label="Current Hours Reading" colors={colors}>
            <StyledInput
              value={hoursReading}
              onChangeText={setHoursReading}
              placeholder={eq ? String(eq.currentHours) : '0'}
              colors={colors}
              error={!!errors.hoursReading}
            />
            {errors.hoursReading ? (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.hoursReading}</Text>
            ) : (
              <Text style={[styles.hintMsg, { color: colors.mutedForeground }]}>
                Updates the equipment's running hours and cost-per-hour if higher than the current reading
              </Text>
            )}
          </Field>
        </View>
      </KeyboardAwareScrollViewCompat>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: createMutation.isPending ? 0.7 : 1 },
          ]}
          onPress={handleSubmit}
          disabled={createMutation.isPending}
          activeOpacity={0.85}
          testID="submit-fuel-log-button"
        >
          {createMutation.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="#ffffff" />
              <Text style={styles.submitText}>Log Fuel Fill</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { paddingHorizontal: 16, paddingTop: 16 },
  equipmentName: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 20 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    height: 46,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  errMsg: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  hintMsg: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  jobBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  jobBannerText: { fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  submitBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#ffffff' },
});
