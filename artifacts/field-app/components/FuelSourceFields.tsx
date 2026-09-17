import React from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BulkFuelTank } from '@workspace/api-client-react';

export type FuelSource = 'purchased' | 'bulk_tank';

type Colors = ReturnType<typeof import('@/hooks/useColors').useColors>;

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
  gallonsError,
  costError,
  tankError,
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
  gallonsError?: string;
  costError?: string;
  tankError?: string;
}) {
  const gallonsValue = Number(gallons);
  const hasGallons = Number.isFinite(gallonsValue) && gallonsValue > 0;
  const selectedTank = tanks.find((tank) => tank.id === bulkFuelTankId) ?? null;
  const estimatedTotal = selectedTank && hasGallons ? gallonsValue * selectedTank.unitCostPerGallon : null;

  return (
    <View>
      <Text style={[styles.label, { color: colors.foreground }]}>Fuel source</Text>
      <View style={styles.sourceChoices}>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ selected: source === 'purchased' }}
          onPress={() => onSourceChange('purchased')}
          style={[
            styles.sourceChoice,
            { backgroundColor: source === 'purchased' ? colors.primary : colors.muted },
          ]}
          testID="fuel-source-purchased"
        >
          <Ionicons name="card-outline" size={17} color={source === 'purchased' ? '#fff' : colors.mutedForeground} />
          <Text style={[styles.choiceText, { color: source === 'purchased' ? '#fff' : colors.mutedForeground }]}>
            Purchased
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ selected: source === 'bulk_tank' }}
          onPress={() => onSourceChange('bulk_tank')}
          style={[
            styles.sourceChoice,
            { backgroundColor: source === 'bulk_tank' ? colors.primary : colors.muted },
          ]}
          testID="fuel-source-bulk-tank"
        >
          <Ionicons name="beaker-outline" size={17} color={source === 'bulk_tank' ? '#fff' : colors.mutedForeground} />
          <Text style={[styles.choiceText, { color: source === 'bulk_tank' ? '#fff' : colors.mutedForeground }]}>
            Bulk tank
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, { color: colors.foreground }]}>Gallons</Text>
      <TextInput
        value={gallons}
        onChangeText={onGallonsChange}
        placeholder="0.0"
        keyboardType="decimal-pad"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.muted,
            borderColor: gallonsError ? colors.destructive : colors.border,
          },
        ]}
        accessibilityLabel="Fuel gallons"
        testID="fuel-gallons-input"
      />
      {gallonsError ? <Text style={[styles.error, { color: colors.destructive }]}>{gallonsError}</Text> : null}

      {source === 'purchased' ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Cost</Text>
          <TextInput
            value={cost}
            onChangeText={onCostChange}
            placeholder="0.00"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.muted,
                borderColor: costError ? colors.destructive : colors.border,
              },
            ]}
            accessibilityLabel="Purchased fuel cost"
            testID="fuel-cost-input"
          />
          {costError ? <Text style={[styles.error, { color: colors.destructive }]}>{costError}</Text> : null}
        </>
      ) : (
        <View>
          <Text style={[styles.label, { color: colors.foreground }]}>Bulk tank</Text>
          {!hasGallons ? (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Enter gallons before selecting a tank. No tank is needed when no fuel is added.
            </Text>
          ) : tanksLoading ? (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading available tanks…</Text>
          ) : tanksError ? (
            <Text style={[styles.helper, { color: colors.destructive }]}>
              Available tanks could not be loaded. Try again before recording bulk fuel.
            </Text>
          ) : tanks.length === 0 ? (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              No active bulk tanks are available. Choose Purchased or leave fuel blank.
            </Text>
          ) : (
            <View style={styles.tankList}>
              {tanks.map((tank) => {
                const insufficient = tank.availableGallons < gallonsValue;
                const disabled = insufficient;
                const selected = tank.id === bulkFuelTankId;
                return (
                  <TouchableOpacity
                    key={tank.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => onBulkFuelTankChange(tank.id)}
                    style={[
                      styles.tank,
                      {
                        backgroundColor: selected ? colors.primary + '12' : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                        opacity: disabled ? 0.55 : 1,
                      },
                    ]}
                    testID={`bulk-fuel-tank-${tank.id}`}
                  >
                    <View style={styles.tankBody}>
                      <Text style={[styles.tankName, { color: colors.foreground }]}>{tank.name}</Text>
                      <Text style={[styles.tankMeta, { color: colors.mutedForeground }]}>
                        {tank.availableGallons.toFixed(1)} gal available · ${tank.unitCostPerGallon.toFixed(2)}/gal
                      </Text>
                      {insufficient ? (
                        <Text style={[styles.tankWarning, { color: colors.destructive }]}>
                          Not enough fuel for this fill
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? colors.primary : colors.mutedForeground}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {tankError ? <Text style={[styles.error, { color: colors.destructive }]}>{tankError}</Text> : null}
          {selectedTank && hasGallons ? (
            <View style={[styles.estimate, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.estimateTitle, { color: colors.foreground }]}>Estimated from tank average</Text>
              <Text style={[styles.estimateLine, { color: colors.mutedForeground }]}>
                Unit price ${selectedTank.unitCostPerGallon.toFixed(2)}/gal · Total ${estimatedTotal?.toFixed(2)}
              </Text>
              <Text style={[styles.estimateLine, { color: colors.mutedForeground }]}>
                Balance after fill: {Math.max(0, selectedTank.availableGallons - gallonsValue).toFixed(1)} gal
              </Text>
              <Text style={[styles.estimateNote, { color: colors.mutedForeground }]}>
                Final cost and availability are confirmed by the server.
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
  sourceChoice: {
    flex: 1,
    minHeight: 46,
    borderRadius: 9,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  choiceText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  error: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  tankList: { gap: 7 },
  tank: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tankBody: { flex: 1 },
  tankName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  tankMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  tankWarning: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 2 },
  estimate: { borderWidth: 1, borderRadius: 9, padding: 11, marginTop: 9 },
  estimateTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  estimateLine: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  estimateNote: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 6 },
});