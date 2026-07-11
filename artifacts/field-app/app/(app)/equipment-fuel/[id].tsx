import React, { useState, useCallback } from 'react';
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
import {
  useGetEquipment,
  useCreateEquipmentFuelLog,
  type EquipmentFuelLogInput,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const equipmentId = Number(id);

  const { data: equipment } = useGetEquipment(equipmentId);
  const eq = equipment as Equipment | undefined;
  const createMutation = useCreateEquipmentFuelLog();

  const [gallons, setGallons] = useState('');
  const [cost, setCost] = useState('');
  const [hoursReading, setHoursReading] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!gallons || isNaN(Number(gallons)) || Number(gallons) <= 0) {
      e.gallons = 'Enter a valid amount of gallons';
    }
    if (cost && isNaN(Number(cost))) {
      e.cost = 'Enter a valid cost';
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
  }, [gallons, cost, hoursReading, eq]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const body: EquipmentFuelLogInput = {
        date: new Date().toISOString(),
        gallons: Number(gallons),
      };
      if (cost.trim()) body.cost = Number(cost);
      if (hoursReading.trim()) body.odometerReading = Number(hoursReading);

      await createMutation.mutateAsync({ id: equipmentId, data: body });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to log fuel fill. Please try again.');
    }
  }, [validate, gallons, cost, hoursReading, createMutation, equipmentId]);

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

          <Field label="Gallons" required colors={colors}>
            <StyledInput
              value={gallons}
              onChangeText={setGallons}
              placeholder="0.0"
              colors={colors}
              error={!!errors.gallons}
            />
            {errors.gallons && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.gallons}</Text>
            )}
          </Field>

          <Field label="Cost" colors={colors}>
            <StyledInput
              value={cost}
              onChangeText={setCost}
              placeholder="0.00"
              colors={colors}
              error={!!errors.cost}
            />
            {errors.cost && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.cost}</Text>
            )}
          </Field>

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
