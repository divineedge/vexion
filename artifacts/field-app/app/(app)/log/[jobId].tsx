import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useListChemicalMixtures,
  useListChemicalProducts,
  useCreateJobChemicalApplication,
  useGetJob,
  useGetProperty,
  getGetPropertyQueryKey,
  type ChemicalApplicationInput,
  type MeasurementZone,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type ChemMixture = { id: number; name: string; items?: unknown[] };
type ChemProduct = { id: number; name: string; unit?: string };

type BreakdownItem = {
  productId?: number | null;
  productName?: string | null;
  amountApplied?: number | null;
  unit?: string | null;
  activeIngredients?: unknown;
  epaRegNumber?: string | null;
  ratePerAcre?: number | null;
  ratePer1000Sqft?: number | null;
};

type ChemApp = {
  id: number;
  mixtureName?: string | null;
  productName?: string | null;
  volumeApplied: number;
  volumeUnit: string;
  breakdown: BreakdownItem[];
  appliedAt: string;
};

const VOLUME_UNITS = ['gal', 'oz', 'L', 'mL'];
const APPLICATION_METHODS = ['Spray', 'Granular', 'Injection', 'Fog', 'Broadcast', 'Drench'];
const WIND_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Calm'];

// ─── Picker Modal ────────────────────────────────────────────────────────────

function PickerModal<T extends { id?: number; name?: string; label?: string }>({
  visible,
  title,
  items,
  onSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  title: string;
  items: T[];
  onSelect: (item: T) => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pickerStyles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            pickerStyles.sheet,
            {
              backgroundColor: colors.card,
              paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16,
            },
          ]}
        >
          <View style={[pickerStyles.handle, { backgroundColor: colors.border }]} />
          <View style={[pickerStyles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[pickerStyles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={pickerStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={items}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[pickerStyles.option, { borderBottomColor: colors.border }]}
                onPress={() => { onSelect(item); onClose(); }}
                activeOpacity={0.7}
              >
                <Text style={[pickerStyles.optionText, { color: colors.foreground }]}>
                  {item.name ?? item.label ?? ''}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
            style={{ maxHeight: 360 }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

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
    <View style={fieldStyles.wrap}>
      <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>
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
  keyboardType,
  multiline,
  colors,
  error,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  colors: ReturnType<typeof useColors>;
  error?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      style={[
        fieldStyles.input,
        {
          color: colors.foreground,
          backgroundColor: colors.muted,
          borderColor: error ? colors.destructive : colors.border,
          height: multiline ? 80 : 46,
          textAlignVertical: multiline ? 'top' : 'center',
          paddingTop: multiline ? 12 : 0,
        },
      ]}
    />
  );
}

function SelectButton({
  value,
  placeholder,
  onPress,
  colors,
}: {
  value: string;
  placeholder: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[fieldStyles.select, { backgroundColor: colors.muted, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text
        style={[
          fieldStyles.selectText,
          { color: value ? colors.foreground : colors.mutedForeground },
        ]}
        numberOfLines={1}
      >
        {value || placeholder}
      </Text>
      <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ─── Breakdown Result ─────────────────────────────────────────────────────────

function BreakdownResult({
  app,
  colors,
  onDone,
}: {
  app: ChemApp;
  colors: ReturnType<typeof useColors>;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={[
        breakStyles.container,
        { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Success banner */}
      <View style={[breakStyles.banner, { backgroundColor: '#22c55e18' }]}>
        <View style={[breakStyles.checkCircle, { backgroundColor: '#22c55e' }]}>
          <Ionicons name="checkmark" size={28} color="#ffffff" />
        </View>
        <Text style={[breakStyles.bannerTitle, { color: colors.foreground }]}>
          Application Logged
        </Text>
        <Text style={[breakStyles.bannerSub, { color: colors.mutedForeground }]}>
          {app.mixtureName ?? app.productName ?? 'Chemical Application'} ·{' '}
          {app.volumeApplied} {app.volumeUnit}
        </Text>
      </View>

      {/* Breakdown table */}
      {app.breakdown.length > 0 && (
        <View style={[breakStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[breakStyles.cardTitle, { color: colors.foreground }]}>
            Ingredient Breakdown
          </Text>
          {app.breakdown.map((item, i) => (
            <View key={i} style={[breakStyles.row, { borderTopColor: colors.border }]}>
              <View style={breakStyles.rowHeader}>
                <View style={[breakStyles.dotIcon, { backgroundColor: colors.primary + '22' }]}>
                  <Ionicons name="flask-outline" size={14} color={colors.primary} />
                </View>
                <Text style={[breakStyles.productName, { color: colors.foreground }]}>
                  {item.productName ?? 'Product'}
                </Text>
              </View>
              {item.epaRegNumber && (
                <Text style={[breakStyles.detail, { color: colors.mutedForeground }]}>
                  EPA: {item.epaRegNumber}
                </Text>
              )}
              <View style={breakStyles.statsRow}>
                <View style={[breakStyles.stat, { backgroundColor: colors.muted }]}>
                  <Text style={[breakStyles.statLabel, { color: colors.mutedForeground }]}>Applied</Text>
                  <Text style={[breakStyles.statVal, { color: colors.foreground }]}>
                    {item.amountApplied?.toFixed(2)} {item.unit}
                  </Text>
                </View>
                {item.ratePerAcre != null && (
                  <View style={[breakStyles.stat, { backgroundColor: colors.muted }]}>
                    <Text style={[breakStyles.statLabel, { color: colors.mutedForeground }]}>
                      / acre
                    </Text>
                    <Text style={[breakStyles.statVal, { color: colors.foreground }]}>
                      {item.ratePerAcre}
                    </Text>
                  </View>
                )}
                {item.ratePer1000Sqft != null && (
                  <View style={[breakStyles.stat, { backgroundColor: colors.muted }]}>
                    <Text style={[breakStyles.statLabel, { color: colors.mutedForeground }]}>
                      / 1k sqft
                    </Text>
                    <Text style={[breakStyles.statVal, { color: colors.foreground }]}>
                      {item.ratePer1000Sqft}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[breakStyles.doneBtn, { backgroundColor: colors.primary }]}
        onPress={onDone}
        activeOpacity={0.85}
      >
        <Text style={breakStyles.doneBtnText}>Back to Job</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LogApplicationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const numJobId = Number(jobId);

  // Fetch job → property chain
  const { data: job } = useGetJob(numJobId);
  const propertyId = (job as { propertyId?: number | null } | undefined)?.propertyId ?? null;
  const { data: property } = useGetProperty(propertyId ?? 0, {
    query: {
      queryKey: getGetPropertyQueryKey(propertyId ?? 0),
      enabled: propertyId != null && propertyId > 0,
    },
  });
  const propSize = (property as { size?: number | null; sizeUnit?: string | null } | undefined)?.size ?? null;
  const propSizeUnit = (property as { size?: number | null; sizeUnit?: string | null } | undefined)?.sizeUnit ?? 'sqft';
  const measurementZones = ((property as { measurementPolygons?: MeasurementZone[] } | undefined)?.measurementPolygons ?? []).filter(z => z.enabled && z.areaSqft > 0);

  // Picker state
  const [mode, setMode] = useState<'mixture' | 'product'>('mixture');
  const [selectedMixture, setSelectedMixture] = useState<ChemMixture | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ChemProduct | null>(null);

  // Form fields
  const [volumeApplied, setVolumeApplied] = useState('');
  const [volumeUnit, setVolumeUnit] = useState('gal');
  const [treatedArea, setTreatedArea] = useState('');
  const [areaUnit, setAreaUnit] = useState('sqft');
  const [selectedZone, setSelectedZone] = useState<MeasurementZone | null>(null);
  const [targetPest, setTargetPest] = useState('');
  const [applicationMethod, setApplicationMethod] = useState('');
  const [windSpeed, setWindSpeed] = useState('');
  const [windDirection, setWindDirection] = useState('');
  const [temperature, setTemperature] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [notes, setNotes] = useState('');

  // Pre-fill treated area from property size when it loads (only if still blank)
  useEffect(() => {
    if (propSize != null && treatedArea === '') {
      setTreatedArea(String(propSize));
      setAreaUnit(propSizeUnit === 'acres' ? 'acres' : 'sqft');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propSize, propSizeUnit]);

  // Live rate preview (client-side, mirrors server logic)
  const liveRates = (() => {
    const vol = Number(volumeApplied);
    const area = Number(treatedArea);
    if (!vol || vol <= 0 || !area || area <= 0) return null;
    const areaSqft = areaUnit === 'acres' ? area * 43560 : area;
    const ratePer1000Sqft = (vol / areaSqft) * 1000;
    const ratePerAcre = ratePer1000Sqft * 43.56;
    return {
      ratePer1000Sqft: Math.round(ratePer1000Sqft * 1000) / 1000,
      ratePerAcre: Math.round(ratePerAcre * 1000) / 1000,
    };
  })();

  // Modal state
  const [showMixturePicker, setShowMixturePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [showAreaUnitPicker, setShowAreaUnitPicker] = useState(false);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [showWindDirPicker, setShowWindDirPicker] = useState(false);
  const [showZonePicker, setShowZonePicker] = useState(false);

  // Result
  const [result, setResult] = useState<ChemApp | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: mixtures, isLoading: mixturesLoading } = useListChemicalMixtures();
  const { data: products, isLoading: productsLoading } = useListChemicalProducts();
  const createMutation = useCreateJobChemicalApplication();

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!volumeApplied || isNaN(Number(volumeApplied)) || Number(volumeApplied) <= 0) {
      e.volumeApplied = 'Enter a valid volume';
    }
    if (mode === 'mixture' && !selectedMixture) e.mixture = 'Select a mixture';
    if (mode === 'product' && !selectedProduct) e.product = 'Select a product';
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [volumeApplied, mode, selectedMixture, selectedProduct]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const body: ChemicalApplicationInput = {
        volumeApplied: Number(volumeApplied),
        volumeUnit,
      };
      if (mode === 'mixture' && selectedMixture) body.mixtureId = selectedMixture.id;
      if (mode === 'product' && selectedProduct) body.productId = selectedProduct.id;
      if (treatedArea && !isNaN(Number(treatedArea)) && Number(treatedArea) > 0) {
        body.treatedArea = Number(treatedArea);
        body.areaUnit = areaUnit;
      }
      if (selectedZone) body.treatedZoneName = selectedZone.label;
      if (targetPest.trim()) body.targetPest = targetPest.trim();
      if (applicationMethod) body.applicationMethod = applicationMethod;
      if (windSpeed && !isNaN(Number(windSpeed))) body.windSpeed = Number(windSpeed);
      if (windDirection) body.windDirection = windDirection;
      if (temperature && !isNaN(Number(temperature))) body.temperature = Number(temperature);
      if (licenseNumber.trim()) body.applicatorLicenseNumber = licenseNumber.trim();
      if (notes.trim()) body.notes = notes.trim();

      const created = await createMutation.mutateAsync({
        id: numJobId,
        data: body,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(created as ChemApp);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to log application. Please try again.');
    }
  }, [validate, volumeApplied, volumeUnit, treatedArea, areaUnit, mode, selectedMixture, selectedProduct,
      targetPest, applicationMethod, windSpeed, windDirection, temperature, licenseNumber, notes,
      numJobId, createMutation, selectedZone]);

  const handleDone = useCallback(() => {
    router.back();
  }, []);

  // ─── Breakdown Result view ────────────────────────────────────
  if (result) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <BreakdownResult app={result} colors={colors} onDone={handleDone} />
      </View>
    );
  }

  const isLoading = mixturesLoading || productsLoading;
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        {/* Mode toggle */}
        <View style={[styles.modeToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'mixture' && { backgroundColor: colors.primary }]}
            onPress={() => { setMode('mixture'); setSelectedMixture(null); setSelectedProduct(null); }}
          >
            <Text style={[styles.modeBtnText, { color: mode === 'mixture' ? '#ffffff' : colors.mutedForeground }]}>
              Mixture
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'product' && { backgroundColor: colors.primary }]}
            onPress={() => { setMode('product'); setSelectedMixture(null); setSelectedProduct(null); }}
          >
            <Text style={[styles.modeBtnText, { color: mode === 'product' ? '#ffffff' : colors.mutedForeground }]}>
              Product
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {/* Mixture/Product Picker */}
          {mode === 'mixture' ? (
            <Field label="Mixture / Tank Mix" required colors={colors}>
              {isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
              ) : (
                <SelectButton
                  value={selectedMixture?.name ?? ''}
                  placeholder="Select a mixture…"
                  onPress={() => setShowMixturePicker(true)}
                  colors={colors}
                />
              )}
              {errors.mixture && (
                <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.mixture}</Text>
              )}
            </Field>
          ) : (
            <Field label="Chemical Product" required colors={colors}>
              {isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
              ) : (
                <SelectButton
                  value={selectedProduct?.name ?? ''}
                  placeholder="Select a product…"
                  onPress={() => setShowProductPicker(true)}
                  colors={colors}
                />
              )}
              {errors.product && (
                <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.product}</Text>
              )}
            </Field>
          )}

          {/* Volume Applied */}
          <Field label="Volume Applied" required colors={colors}>
            <View style={styles.splitRow}>
              <View style={{ flex: 2 }}>
                <StyledInput
                  value={volumeApplied}
                  onChangeText={setVolumeApplied}
                  placeholder="0.0"
                  keyboardType="decimal-pad"
                  colors={colors}
                  error={!!errors.volumeApplied}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SelectButton
                  value={volumeUnit}
                  placeholder="Unit"
                  onPress={() => setShowUnitPicker(true)}
                  colors={colors}
                />
              </View>
            </View>
            {errors.volumeApplied && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.volumeApplied}</Text>
            )}
          </Field>

          {/* Treated Area */}
          <Field label="Treated Area" colors={colors}>
            {/* Zone picker — only shown when the property has named measurement zones */}
            {measurementZones.length > 0 && (
              <View style={areaStyles.zonePicker}>
                <SelectButton
                  value={selectedZone ? selectedZone.label : ''}
                  placeholder="Pick a zone (optional)…"
                  onPress={() => setShowZonePicker(true)}
                  colors={colors}
                />
                {selectedZone && (
                  <TouchableOpacity
                    style={[areaStyles.clearZone, { backgroundColor: colors.muted, borderColor: colors.border }]}
                    onPress={() => setSelectedZone(null)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={15} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            {propSize != null && !selectedZone && (
              <View style={[areaStyles.propertyBadge, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
                <Ionicons name="home-outline" size={13} color={colors.primary} />
                <Text style={[areaStyles.propertyBadgeText, { color: colors.primary }]}>
                  Property size: {propSize.toLocaleString()} {propSizeUnit}
                </Text>
              </View>
            )}
            {selectedZone && (
              <View style={[areaStyles.propertyBadge, { backgroundColor: '#22c55e15', borderColor: '#22c55e40' }]}>
                <Ionicons name="map-outline" size={13} color="#22c55e" />
                <Text style={[areaStyles.propertyBadgeText, { color: '#22c55e' }]}>
                  Zone area: {selectedZone.areaSqft.toLocaleString()} sqft
                </Text>
              </View>
            )}
            <View style={styles.splitRow}>
              <View style={{ flex: 2 }}>
                <StyledInput
                  value={treatedArea}
                  onChangeText={setTreatedArea}
                  placeholder="e.g. 5000"
                  keyboardType="decimal-pad"
                  colors={colors}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SelectButton
                  value={areaUnit}
                  placeholder="Unit"
                  onPress={() => setShowAreaUnitPicker(true)}
                  colors={colors}
                />
              </View>
            </View>
            {liveRates && (
              <View style={[areaStyles.rateRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={areaStyles.ratePill}>
                  <Text style={[areaStyles.rateLabel, { color: colors.mutedForeground }]}>/ 1k sqft</Text>
                  <Text style={[areaStyles.rateVal, { color: colors.foreground }]}>
                    {liveRates.ratePer1000Sqft} {volumeUnit}
                  </Text>
                </View>
                <View style={[areaStyles.rateDivider, { backgroundColor: colors.border }]} />
                <View style={areaStyles.ratePill}>
                  <Text style={[areaStyles.rateLabel, { color: colors.mutedForeground }]}>/ acre</Text>
                  <Text style={[areaStyles.rateVal, { color: colors.foreground }]}>
                    {liveRates.ratePerAcre} {volumeUnit}
                  </Text>
                </View>
              </View>
            )}
          </Field>

          {/* Target Pest */}
          <Field label="Target Pest" colors={colors}>
            <StyledInput
              value={targetPest}
              onChangeText={setTargetPest}
              placeholder="e.g. Grubs, Crabgrass, Ants…"
              colors={colors}
            />
          </Field>

          {/* Application Method */}
          <Field label="Application Method" colors={colors}>
            <SelectButton
              value={applicationMethod}
              placeholder="Select method…"
              onPress={() => setShowMethodPicker(true)}
              colors={colors}
            />
          </Field>

          {/* Environmental Conditions */}
          <View style={[styles.sectionDivider, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Environmental Conditions
            </Text>
          </View>

          <View style={styles.splitRow}>
            <View style={{ flex: 1 }}>
              <Field label="Wind Speed (mph)" colors={colors}>
                <StyledInput
                  value={windSpeed}
                  onChangeText={setWindSpeed}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  colors={colors}
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Wind Direction" colors={colors}>
                <SelectButton
                  value={windDirection}
                  placeholder="N/A"
                  onPress={() => setShowWindDirPicker(true)}
                  colors={colors}
                />
              </Field>
            </View>
          </View>

          <Field label="Temperature (°F)" colors={colors}>
            <StyledInput
              value={temperature}
              onChangeText={setTemperature}
              placeholder="72"
              keyboardType="decimal-pad"
              colors={colors}
            />
          </Field>

          {/* Applicator Info */}
          <View style={[styles.sectionDivider, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Applicator Info
            </Text>
          </View>

          <Field label="License Number" colors={colors}>
            <StyledInput
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="State pesticide license #"
              colors={colors}
            />
          </Field>

          <Field label="Notes" colors={colors}>
            <StyledInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes…"
              multiline
              colors={colors}
            />
          </Field>
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* Submit button */}
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
          testID="submit-button"
        >
          {createMutation.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="#ffffff" />
              <Text style={styles.submitText}>Submit Application</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Modals */}
      <PickerModal
        visible={showMixturePicker}
        title="Select Mixture"
        items={(mixtures as ChemMixture[] | undefined) ?? []}
        onSelect={setSelectedMixture}
        onClose={() => setShowMixturePicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showProductPicker}
        title="Select Product"
        items={(products as ChemProduct[] | undefined) ?? []}
        onSelect={setSelectedProduct}
        onClose={() => setShowProductPicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showUnitPicker}
        title="Volume Unit"
        items={VOLUME_UNITS.map((u) => ({ name: u }))}
        onSelect={(item) => setVolumeUnit(item.name ?? 'gal')}
        onClose={() => setShowUnitPicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showAreaUnitPicker}
        title="Area Unit"
        items={[{ name: 'sqft' }, { name: 'acres' }]}
        onSelect={(item) => setAreaUnit(item.name ?? 'sqft')}
        onClose={() => setShowAreaUnitPicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showMethodPicker}
        title="Application Method"
        items={APPLICATION_METHODS.map((m) => ({ name: m }))}
        onSelect={(item) => setApplicationMethod(item.name ?? '')}
        onClose={() => setShowMethodPicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showWindDirPicker}
        title="Wind Direction"
        items={WIND_DIRECTIONS.map((d) => ({ name: d }))}
        onSelect={(item) => setWindDirection(item.name ?? '')}
        onClose={() => setShowWindDirPicker(false)}
        colors={colors}
      />
      <PickerModal
        visible={showZonePicker}
        title="Select Zone"
        items={measurementZones.map((z) => ({ id: z.id as unknown as number, name: `${z.label} (${z.areaSqft.toLocaleString()} sqft)`, _zone: z }))}
        onSelect={(item) => {
          const zone = (item as unknown as { _zone: MeasurementZone })._zone;
          setSelectedZone(zone);
          setTreatedArea(String(Math.round(zone.areaSqft)));
          setAreaUnit('sqft');
        }}
        onClose={() => setShowZonePicker(false)}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeToggle: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  modeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  form: { paddingHorizontal: 16 },
  splitRow: { flexDirection: 'row', gap: 10 },
  errMsg: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
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
  submitText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#ffffff',
  },
});

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  closeBtn: { padding: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
});

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  select: {
    height: 46,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    flex: 1,
    marginRight: 6,
  },
});

const areaStyles = StyleSheet.create({
  propertyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  propertyBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  ratePill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  rateDivider: {
    width: 1,
    height: '100%',
  },
  rateLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  rateVal: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  zonePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  clearZone: {
    width: 38,
    height: 46,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

const breakStyles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 24 },
  banner: {
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 20,
    gap: 12,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bannerTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  bannerSub: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    overflow: 'hidden',
  },
  cardTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    padding: 16,
    paddingBottom: 8,
  },
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dotIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  productName: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stat: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
  },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 },
  statVal: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  doneBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#ffffff' },
});
