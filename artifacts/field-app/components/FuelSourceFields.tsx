import React, { useCallback, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BulkFuelTank } from '@workspace/api-client-react';

export type FuelSource = 'purchased' | 'bulk_tank';
export type MeterMode = 'meter' | 'manual';

type Colors = ReturnType<typeof import('@/hooks/useColors').useColors>;

function fmtMeter(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/** Gallons implied by a meter reading against the confirmed prior snapshot, or null if not positive. */
export function meterDelta(reading: string, expected: number | null): number | null {
  if (expected == null || !reading.trim()) return null;
  const value = Number(reading);
  if (!Number.isFinite(value)) return null;
  const delta = Math.round((value - expected) * 1000) / 1000;
  return delta > 0 ? delta : null;
}

/**
 * Line-meter entry state. The prior reading is snapshotted when the tank is selected
 * and is only replaced by an explicit user action (resetForTank / confirmLatest),
 * never by a background refetch.
 */
export function useBulkMeterEntry() {
  const [meterReading, setMeterReading] = useState('');
  const [expectedMeterReading, setExpectedMeterReading] = useState<number | null>(null);
  const [meterMode, setMeterMode] = useState<MeterMode>('meter');

  const resetForTank = useCallback((tank: BulkFuelTank | null) => {
    setMeterReading('');
    setExpectedMeterReading(tank?.currentMeterReading ?? null);
    setMeterMode(tank && tank.currentMeterReading != null ? 'meter' : 'manual');
  }, []);

  return { meterReading, setMeterReading, expectedMeterReading, setExpectedMeterReading, meterMode, setMeterMode, resetForTank };
}

export type BulkMeterEntry = ReturnType<typeof useBulkMeterEntry>;

/** True when meter entry is the active way of measuring this bulk fill. */
export function isMeterActive(source: FuelSource, meter: BulkMeterEntry) {
  return source === 'bulk_tank' && meter.meterMode === 'meter' && meter.expectedMeterReading != null;
}

/** True when the server-known tank reading has moved past the snapshot the user confirmed. */
export function isMeterStale(tank: BulkFuelTank | null | undefined, meter: BulkMeterEntry) {
  return !!tank && tank.currentMeterReading != null && meter.expectedMeterReading != null && tank.currentMeterReading !== meter.expectedMeterReading;
}

export function meterValidationError(meter: BulkMeterEntry): string | null {
  if (!meter.meterReading.trim()) return 'Enter the current line meter reading';
  const value = Number(meter.meterReading);
  if (!Number.isFinite(value)) return 'Enter a valid meter reading';
  if (value < 0 || value > 2000000 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001) return 'Use up to 3 decimal places, between 0 and 2,000,000 gallons';
  if (meter.expectedMeterReading != null && value <= meter.expectedMeterReading) {
    return `Must be greater than the previous reading (${fmtMeter(meter.expectedMeterReading)})`;
  }
  return null;
}

/** Optional request fields for a meter-measured bulk fill. */
export function meterPayload(source: FuelSource, meter: BulkMeterEntry): { meterReading?: number; expectedMeterReading?: number } {
  if (!isMeterActive(source, meter) || !meter.meterReading.trim()) return {};
  return { meterReading: Number(meter.meterReading), expectedMeterReading: meter.expectedMeterReading as number };
}

export function FuelSourceFields({
  source,
  onSourceChange,
  gallons,
  onGallonsChange,
  cost,
  onCostChange,
  bulkFuelTankId,
  onBulkFuelTankChange,
  tanks,
  tanksLoading,
  tanksError,
  colors,
  meter,
  onRefreshTanks,
  gallonsError,
  costError,
  tankError,
  meterError,
}: {
  source: FuelSource;
  onSourceChange: (source: FuelSource) => void;
  gallons: string;
  onGallonsChange: (value: string) => void;
  cost: string;
  onCostChange: (value: string) => void;
  bulkFuelTankId: number | null;
  onBulkFuelTankChange: (tankId: number | null) => void;
  tanks: BulkFuelTank[];
  tanksLoading: boolean;
  tanksError: boolean;
  colors: Colors;
  meter: BulkMeterEntry;
  onRefreshTanks?: () => void;
  gallonsError?: string;
  costError?: string;
  tankError?: string;
  meterError?: string;
}) {
  const gallonsValue = Number(gallons);
  const hasGallons = Number.isFinite(gallonsValue) && gallonsValue > 0;
  const selectedTank = tanks.find((tank) => tank.id === bulkFuelTankId) ?? null;
  const estimatedTotal = selectedTank && hasGallons ? gallonsValue * selectedTank.unitCostPerGallon : null;
  const meterActive = isMeterActive(source, meter);
  const stale = isMeterStale(selectedTank, meter);
  const readingValue = Number(meter.meterReading);
  const readingTooLow =
    meterActive && meter.meterReading.trim() !== '' && Number.isFinite(readingValue) && readingValue <= (meter.expectedMeterReading as number);

  const handleMeterChange = (value: string) => {
    meter.setMeterReading(value);
    const delta = meterDelta(value, meter.expectedMeterReading);
    onGallonsChange(delta != null ? String(delta) : '');
  };

  const confirmLatest = () => {
    if (!selectedTank || selectedTank.currentMeterReading == null) return;
    meter.setExpectedMeterReading(selectedTank.currentMeterReading);
    const delta = meterDelta(meter.meterReading, selectedTank.currentMeterReading);
    onGallonsChange(delta != null ? String(delta) : '');
  };

  const switchMode = (mode: MeterMode) => {
    meter.setMeterMode(mode);
    meter.setMeterReading('');
    if (mode === 'meter' && selectedTank) meter.setExpectedMeterReading(selectedTank.currentMeterReading ?? null);
    onGallonsChange('');
  };

  const gallonsInput = (
    <>
      <Text style={[styles.label, { color: colors.foreground }]}>Gallons</Text>
      <TextInput
        value={gallons}
        onChangeText={onGallonsChange}
        placeholder="0.0"
        keyboardType="decimal-pad"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.muted, borderColor: gallonsError ? colors.destructive : colors.border },
        ]}
        accessibilityLabel="Fuel gallons"
        testID="fuel-gallons-input"
      />
      {gallonsError ? <Text style={[styles.error, { color: colors.destructive }]}>{gallonsError}</Text> : null}
    </>
  );

  return (
    <View>
      <Text style={[styles.label, { color: colors.foreground }]}>Fuel source</Text>
      <View style={styles.sourceChoices}>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ selected: source === 'purchased' }}
          onPress={() => onSourceChange('purchased')}
          style={[styles.sourceChoice, { backgroundColor: source === 'purchased' ? colors.primary : colors.muted }]}
          testID="fuel-source-purchased"
        >
          <Ionicons name="card-outline" size={17} color={source === 'purchased' ? '#fff' : colors.mutedForeground} />
          <Text style={[styles.choiceText, { color: source === 'purchased' ? '#fff' : colors.mutedForeground }]}>Purchased</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ selected: source === 'bulk_tank' }}
          onPress={() => onSourceChange('bulk_tank')}
          style={[styles.sourceChoice, { backgroundColor: source === 'bulk_tank' ? colors.primary : colors.muted }]}
          testID="fuel-source-bulk-tank"
        >
          <Ionicons name="beaker-outline" size={17} color={source === 'bulk_tank' ? '#fff' : colors.mutedForeground} />
          <Text style={[styles.choiceText, { color: source === 'bulk_tank' ? '#fff' : colors.mutedForeground }]}>Bulk tank</Text>
        </TouchableOpacity>
      </View>

      {source === 'purchased' ? (
        <>
          {gallonsInput}
          <Text style={[styles.label, { color: colors.foreground }]}>Cost</Text>
          <TextInput
            value={cost}
            onChangeText={onCostChange}
            placeholder="0.00"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, backgroundColor: colors.muted, borderColor: costError ? colors.destructive : colors.border },
            ]}
            accessibilityLabel="Purchased fuel cost"
            testID="fuel-cost-input"
          />
          {costError ? <Text style={[styles.error, { color: colors.destructive }]}>{costError}</Text> : null}
        </>
      ) : (
        <View>
          <Text style={[styles.label, { color: colors.foreground }]}>Bulk tank</Text>
          {tanksLoading ? (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading available tanks…</Text>
          ) : tanksError ? (
            <Text style={[styles.helper, { color: colors.destructive }]}>Available tanks could not be loaded. Try again before recording bulk fuel.</Text>
          ) : tanks.length === 0 ? (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>No active bulk tanks are available. Choose Purchased or leave fuel blank.</Text>
          ) : (
            <View style={styles.tankList}>
              {tanks.map((tank) => {
                const insufficient = hasGallons && tank.availableGallons < gallonsValue;
                const selected = tank.id === bulkFuelTankId;
                return (
                  <TouchableOpacity
                    key={tank.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: insufficient && !selected }}
                    disabled={insufficient && !selected}
                    onPress={() => onBulkFuelTankChange(selected ? null : tank.id)}
                    style={[
                      styles.tank,
                      {
                        backgroundColor: selected ? colors.primary + '12' : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                        opacity: insufficient && !selected ? 0.55 : 1,
                      },
                    ]}
                    testID={`bulk-fuel-tank-${tank.id}`}
                  >
                    <View style={styles.tankBody}>
                      <Text style={[styles.tankName, { color: colors.foreground }]}>{tank.name}</Text>
                      <Text style={[styles.tankMeta, { color: colors.mutedForeground }]}>
                        {tank.availableGallons.toFixed(1)} gal available · ${tank.unitCostPerGallon.toFixed(2)}/gal
                      </Text>
                      <Text style={[styles.tankMeta, { color: colors.mutedForeground }]}>
                        {tank.currentMeterReading != null ? `Line meter ${fmtMeter(tank.currentMeterReading)}` : 'No line meter baseline'}
                      </Text>
                      {insufficient ? <Text style={[styles.tankWarning, { color: colors.destructive }]}>Not enough fuel for this fill</Text> : null}
                    </View>
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {tankError ? <Text style={[styles.error, { color: colors.destructive }]}>{tankError}</Text> : null}

          {selectedTank ? (
            selectedTank.currentMeterReading == null && meter.expectedMeterReading == null ? (
              <>
                <View style={[styles.notice, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
                    This tank has no starting line meter reading yet. Office staff can set it in Equipment, Bulk Fuel, tank settings. Enter gallons manually for now.
                  </Text>
                </View>
                {gallonsInput}
              </>
            ) : meterActive ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Line meter reading now</Text>
                <TextInput
                  value={meter.meterReading}
                  onChangeText={handleMeterChange}
                  placeholder={`More than ${fmtMeter(meter.expectedMeterReading as number)}`}
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.muted,
                      borderColor: meterError || readingTooLow ? colors.destructive : colors.border,
                    },
                  ]}
                  accessibilityLabel="Bulk tank line meter reading"
                  testID="fuel-meter-reading-input"
                />
                {readingTooLow ? (
                  <Text style={[styles.error, { color: colors.destructive }]}>
                    Must be greater than the previous reading ({fmtMeter(meter.expectedMeterReading as number)}).
                  </Text>
                ) : meterError ? (
                  <Text style={[styles.error, { color: colors.destructive }]}>{meterError}</Text>
                ) : null}

                <View style={[styles.meterGrid, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <View style={styles.meterCell}>
                    <Text style={[styles.meterCaption, { color: colors.mutedForeground }]}>Previous</Text>
                    <Text style={[styles.meterValue, { color: colors.foreground }]}>{fmtMeter(meter.expectedMeterReading as number)}</Text>
                  </View>
                  <View style={styles.meterCell}>
                    <Text style={[styles.meterCaption, { color: colors.mutedForeground }]}>Gallons</Text>
                    <Text style={[styles.meterValue, { color: hasGallons ? colors.primary : colors.mutedForeground }]}>
                      {hasGallons ? gallonsValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}
                    </Text>
                  </View>
                  <View style={styles.meterCell}>
                    <Text style={[styles.meterCaption, { color: colors.mutedForeground }]}>Est. cost</Text>
                    <Text style={[styles.meterValue, { color: colors.foreground }]}>{estimatedTotal != null ? `$${estimatedTotal.toFixed(2)}` : '—'}</Text>
                  </View>
                </View>

                {stale ? (
                  <View style={[styles.notice, { backgroundColor: colors.destructive + '10', borderColor: colors.destructive + '40' }]}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.noticeText, { color: colors.foreground }]}>
                        Someone recorded fuel from this tank. The line meter is now {fmtMeter(selectedTank.currentMeterReading as number)}, not {fmtMeter(meter.expectedMeterReading as number)}. Check your reading, then confirm the new previous reading.
                      </Text>
                      <TouchableOpacity onPress={confirmLatest} style={[styles.inlineBtn, { borderColor: colors.primary }]} testID="fuel-meter-confirm-latest">
                        <Text style={[styles.inlineBtnText, { color: colors.primary }]}>Use {fmtMeter(selectedTank.currentMeterReading as number)} as previous</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : onRefreshTanks ? (
                  <TouchableOpacity onPress={onRefreshTanks} style={styles.linkRow} testID="fuel-meter-refresh">
                    <Ionicons name="refresh-outline" size={14} color={colors.primary} />
                    <Text style={[styles.linkText, { color: colors.primary }]}>Check for a newer previous reading</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity onPress={() => switchMode('manual')} style={styles.linkRow} testID="fuel-meter-use-manual">
                  <Ionicons name="create-outline" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Meter not readable? Enter gallons instead</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {gallonsInput}
                <TouchableOpacity onPress={() => switchMode('meter')} style={styles.linkRow} testID="fuel-meter-use-meter">
                  <Ionicons name="speedometer-outline" size={14} color={colors.primary} />
                  <Text style={[styles.linkText, { color: colors.primary }]}>Use the line meter reading instead</Text>
                </TouchableOpacity>
              </>
            )
          ) : (
            <Text style={[styles.helper, { color: colors.mutedForeground, marginTop: 8 }]}>
              Choose the tank supplying this fuel. No tank is needed when no fuel is added.
            </Text>
          )}

          {selectedTank && hasGallons ? (
            <View style={[styles.estimate, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.estimateTitle, { color: colors.foreground }]}>Estimated from tank average</Text>
              <Text style={[styles.estimateLine, { color: colors.mutedForeground }]}>
                Unit price ${selectedTank.unitCostPerGallon.toFixed(2)}/gal · Est. total ${estimatedTotal?.toFixed(2)}
              </Text>
              <Text style={[styles.estimateLine, { color: colors.mutedForeground }]}>
                Balance after fill: {Math.max(0, selectedTank.availableGallons - gallonsValue).toFixed(1)} gal
              </Text>
              <Text style={[styles.estimateNote, { color: colors.mutedForeground }]}>
                This is an estimate. Final gallons, cost, and availability are confirmed by the server.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 8, marginTop: 14 },
  sourceChoices: { flexDirection: 'row', gap: 8 },
  sourceChoice: { flex: 1, minHeight: 46, borderRadius: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  choiceText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  input: { height: 46, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  error: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  tankList: { gap: 7 },
  tank: { minHeight: 58, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tankBody: { flex: 1 },
  tankName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  tankMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  tankWarning: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 2 },
  notice: { flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 10 },
  noticeText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  meterGrid: { flexDirection: 'row', borderWidth: 1, borderRadius: 9, marginTop: 10, paddingVertical: 9 },
  meterCell: { flex: 1, alignItems: 'center' },
  meterCaption: { fontFamily: 'Inter_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  meterValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginTop: 3 },
  inlineBtn: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8 },
  inlineBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 28 },
  linkText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  estimate: { borderWidth: 1, borderRadius: 9, padding: 11, marginTop: 9 },
  estimateTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  estimateLine: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  estimateNote: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 6 },
});
