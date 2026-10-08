import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Linking,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useListChemicalMixtures,
  getJobChemicalWeather,
  useListChemicalProducts,
  useListChemicalDocuments,
  useGetChemicalDocumentReadUrl,
  useCreateJobChemicalApplication,
  useGetJob,
  useGetProperty,
  useGetTenantSettings,
  getGetPropertyQueryKey,
  type ChemicalApplicationInput,
  type MeasurementZone,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { normalizeChemicalRecordRequirements } from '@/utils/chemicalRequirements';

type ChemMixture = { id: number; name: string; items?: { productId: number; productName?: string | null }[] };
type ChemProduct = { id: number; name: string; unit?: string; labelSdsUrl?: string | null };

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

function localDateTimeValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

// Read-only access to stored safety sheets and the product's older external SDS link.
function httpDocumentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

function ChemicalSafetySheets({ product }: { product: ChemProduct }) {
  const colors = useColors();
  const { data: documents, isLoading, isError, refetch } = useListChemicalDocuments(product.id);
  const readUrlMutation = useGetChemicalDocumentReadUrl();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const legacyUrl = httpDocumentUrl(product.labelSdsUrl);

  const openDocument = async (documentId: number) => {
    if (opening) return;
    setOpening(String(documentId));
    setOpenError(null);
    try {
      const { url } = await readUrlMutation.mutateAsync({ id: product.id, documentId });
      const safeUrl = httpDocumentUrl(url);
      if (!safeUrl) throw new Error('The safety sheet link is unavailable.');
      await Linking.openURL(safeUrl);
    } catch {
      setOpenError('Could not open this safety sheet. Please try again.');
    } finally {
      setOpening(null);
    }
  };

  const openLegacy = async () => {
    if (!legacyUrl || opening) return;
    setOpening('legacy');
    setOpenError(null);
    try {
      await Linking.openURL(legacyUrl);
    } catch {
      setOpenError('Could not open the external SDS link. Please try again.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <View style={[safetyStyles.product, { borderColor: colors.border }]}>
      <Text style={[safetyStyles.productName, { color: colors.foreground }]}>{product.name}</Text>
      {isLoading && <ActivityIndicator size="small" color={colors.primary} style={safetyStyles.loading} />}
      {isError && (
        <TouchableOpacity onPress={() => { void refetch(); }} testID={`retry-safety-sheets-${product.id}`}>
          <Text style={[safetyStyles.message, { color: colors.destructive }]}>Safety sheets unavailable. Tap to retry.</Text>
        </TouchableOpacity>
      )}
      {!isLoading && !isError && documents?.length === 0 && (
        <Text style={[safetyStyles.message, { color: colors.mutedForeground }]}>No uploaded safety sheets available.</Text>
      )}
      {documents?.map(document => (
        <TouchableOpacity
          key={document.id}
          style={safetyStyles.link}
          onPress={() => { void openDocument(document.id); }}
          disabled={opening !== null}
          testID={`safety-sheet-${product.id}-${document.id}`}
        >
          {opening === String(document.id)
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="document-text-outline" size={16} color={colors.primary} />}
          <Text style={[safetyStyles.linkText, { color: colors.primary }]} numberOfLines={2}>
            {document.documentType.toUpperCase()} · {document.fileName}
          </Text>
          <Ionicons name="open-outline" size={15} color={colors.primary} />
        </TouchableOpacity>
      ))}
      {legacyUrl && (
        <TouchableOpacity style={safetyStyles.link} onPress={() => { void openLegacy(); }} disabled={opening !== null} testID={`legacy-sds-${product.id}`}>
          {opening === 'legacy'
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="link-outline" size={16} color={colors.primary} />}
          <Text style={[safetyStyles.linkText, { color: colors.primary }]}>External SDS link (legacy)</Text>
          <Ionicons name="open-outline" size={15} color={colors.primary} />
        </TouchableOpacity>
      )}
      {!!product.labelSdsUrl && !legacyUrl && (
        <Text style={[safetyStyles.message, { color: colors.mutedForeground }]}>External SDS link unavailable.</Text>
      )}
      {openError && <Text style={[safetyStyles.message, { color: colors.destructive }]}>{openError}</Text>}
    </View>
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
  const [treatedZoneName, setTreatedZoneName] = useState('');
  const [targetPest, setTargetPest] = useState('');
  const [applicationMethod, setApplicationMethod] = useState('');
  const [windSpeed, setWindSpeed] = useState('');
  const [windDirection, setWindDirection] = useState('');
  const [temperature, setTemperature] = useState('');
  const [appliedAt, setAppliedAt] = useState(() => localDateTimeValue());
  const [applicatorName, setApplicatorName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [weatherObservedAt, setWeatherObservedAt] = useState<string | null>(null);
  const applicationTimeEdited = useRef(false);

  const loadCurrentWeather = useCallback(async (replace = true) => {
    setWeatherBusy(true);
    setWeatherError('');
    try {
      const current = await getJobChemicalWeather(numJobId);
      // A slow initial fetch must not attach today's conditions to a time
      // the applicator has already backdated while waiting.
      if (!replace && applicationTimeEdited.current) return;
      if (replace) applicationTimeEdited.current = false;
      setTemperature(previous => replace ? String(current.temperature) : previous || String(current.temperature));
      setWindSpeed(previous => replace ? String(current.windSpeed) : previous || String(current.windSpeed));
      setWindDirection(previous => replace ? current.windDirection : previous || current.windDirection);
      if (replace) setAppliedAt(localDateTimeValue());
      setWeatherObservedAt(current.observedAt);
    } catch {
      setWeatherError('Current weather unavailable. Check connectivity and the property map pin, or enter observed conditions manually.');
    } finally {
      setWeatherBusy(false);
    }
  }, [numJobId]);

  useEffect(() => { void loadCurrentWeather(false); }, [loadCurrentWeather]);

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
  const { data: tenantSettings } = useGetTenantSettings();
  const selectedSafetyProducts: ChemProduct[] = mode === 'product'
    ? (selectedProduct ? [selectedProduct] : [])
    : Array.from(new Set(selectedMixture?.items?.map(item => item.productId) ?? []))
        .filter(id => Number.isInteger(id) && id > 0)
        .map(id => (products as ChemProduct[] | undefined)?.find(product => product.id === id)
          ?? { id, name: selectedMixture?.items?.find(item => item.productId === id)?.productName ?? `Product #${id}` });
  const chemicalRequirements = normalizeChemicalRecordRequirements(tenantSettings?.chemicalRecordRequirements);
  const createMutation = useCreateJobChemicalApplication();

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!volumeApplied || isNaN(Number(volumeApplied)) || Number(volumeApplied) <= 0) {
      e.volumeApplied = 'Enter a valid volume';
    }
    if (mode === 'mixture' && !selectedMixture) e.mixture = 'Select a mixture';
    if (mode === 'product' && !selectedProduct) e.product = 'Select a product';
    if (!appliedAt || Number.isNaN(new Date(appliedAt).getTime())) e.appliedAt = 'Enter a valid application date and time';
    if (treatedArea && (!Number.isFinite(Number(treatedArea)) || Number(treatedArea) <= 0)) {
      e.treatedArea = 'Treated area must be a positive number';
    } else if (chemicalRequirements.treatedArea && !treatedArea) {
      e.treatedArea = 'Treated area is required';
    }
    if (chemicalRequirements.treatedZoneName && !treatedZoneName.trim()) e.treatedZoneName = 'Treated zone or location is required';
    if (chemicalRequirements.targetPest && !targetPest.trim()) e.targetPest = 'Target pest or weed is required';
    if (chemicalRequirements.applicationMethod && !applicationMethod) e.applicationMethod = 'Application method is required';
    if (windSpeed && (!Number.isFinite(Number(windSpeed)) || Number(windSpeed) < 0)) {
      e.windSpeed = 'Wind speed must be zero or greater';
    } else if (chemicalRequirements.windSpeed && !windSpeed) {
      e.windSpeed = 'Wind speed is required';
    }
    if (chemicalRequirements.windDirection && !windDirection) e.windDirection = 'Wind direction is required';
    if (temperature && !Number.isFinite(Number(temperature))) {
      e.temperature = 'Enter a valid temperature';
    } else if (chemicalRequirements.temperature && !temperature) {
      e.temperature = 'Temperature is required';
    }
    if (chemicalRequirements.applicatorName && !applicatorName.trim()) e.applicatorName = 'Applicator name is required';
    if (chemicalRequirements.applicatorLicenseNumber && !licenseNumber.trim()) e.applicatorLicenseNumber = 'Applicator license number is required';
    if (chemicalRequirements.notes && !notes.trim()) e.notes = 'Notes are required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [
    volumeApplied, mode, selectedMixture, selectedProduct, appliedAt, treatedArea,
    treatedZoneName, targetPest, applicationMethod, windSpeed, windDirection,
    temperature, applicatorName, licenseNumber, notes, chemicalRequirements,
  ]);

  const handleSubmit = useCallback(async () => {
    if (weatherObservedAt && Date.now() - new Date(weatherObservedAt).getTime() > 60 * 60 * 1000) {
      Alert.alert('Weather needs refreshing', 'These weather readings are more than an hour old. Refresh weather and application time, or change the application time and enter observed conditions manually.');
      return;
    }
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const body: ChemicalApplicationInput = {
        volumeApplied: Number(volumeApplied),
        volumeUnit,
        appliedAt: new Date(appliedAt).toISOString(),
      };
      if (mode === 'mixture' && selectedMixture) body.mixtureId = selectedMixture.id;
      if (mode === 'product' && selectedProduct) body.productId = selectedProduct.id;
      if (treatedArea && !isNaN(Number(treatedArea)) && Number(treatedArea) > 0) {
        body.treatedArea = Number(treatedArea);
        body.areaUnit = areaUnit;
      }
      if (treatedZoneName.trim()) body.treatedZoneName = treatedZoneName.trim();
      if (targetPest.trim()) body.targetPest = targetPest.trim();
      if (applicationMethod) body.applicationMethod = applicationMethod;
      if (windSpeed && !isNaN(Number(windSpeed))) body.windSpeed = Number(windSpeed);
      if (windDirection) body.windDirection = windDirection;
      if (temperature && !isNaN(Number(temperature))) body.temperature = Number(temperature);
      if (applicatorName.trim()) body.applicatorName = applicatorName.trim();
      if (licenseNumber.trim()) body.applicatorLicenseNumber = licenseNumber.trim();
      const weatherReference = weatherObservedAt ? `Weather reference: Open-Meteo estimated conditions at ${weatherObservedAt}; readings may be adjusted by the applicator.` : '';
      if (notes.trim() || weatherReference) body.notes = [notes.trim(), weatherReference].filter(Boolean).join('\n');

      const created = await createMutation.mutateAsync({
        id: numJobId,
        data: body,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(created as ChemApp);
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err?.data?.fields && typeof err.data.fields === 'object') setErrors(err.data.fields);
      Alert.alert('Error', err?.data?.error ?? 'Failed to log application. Please try again.');
    }
  }, [validate, volumeApplied, volumeUnit, appliedAt, treatedArea, areaUnit, mode, selectedMixture, selectedProduct,
      treatedZoneName, targetPest, applicationMethod, windSpeed, windDirection, temperature, applicatorName,
      licenseNumber, notes, numJobId, createMutation, weatherObservedAt]);

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

          {selectedSafetyProducts.length > 0 && (
            <View style={[safetyStyles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[safetyStyles.title, { color: colors.foreground }]}>Chemical Safety Sheets</Text>
              {selectedSafetyProducts.map(product => <ChemicalSafetySheets key={product.id} product={product} />)}
            </View>
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

          <Field label="Applied At (YYYY-MM-DDTHH:MM)" required colors={colors}>
            <StyledInput
              value={appliedAt}
              onChangeText={value => {
                applicationTimeEdited.current = true;
                setAppliedAt(value);
                if (weatherObservedAt) {
                  setTemperature('');
                  setWindSpeed('');
                  setWindDirection('');
                  setWeatherObservedAt(null);
                  setWeatherError('Application time changed. Enter conditions observed at that time, or refresh to log an application now.');
                }
              }}
              placeholder="2026-08-29T14:30"
              colors={colors}
              error={!!errors.appliedAt}
            />
            {errors.appliedAt && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.appliedAt}</Text>
            )}
          </Field>

          {/* Treated Area */}
          <Field label="Treated Area" required={chemicalRequirements.treatedArea} colors={colors}>
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
                    onPress={() => { setSelectedZone(null); setTreatedZoneName(''); }}
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
                  error={!!errors.treatedArea}
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
            {errors.treatedArea && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.treatedArea}</Text>
            )}
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

          <Field label="Treated Zone / Location" required={chemicalRequirements.treatedZoneName} colors={colors}>
            <StyledInput
              value={treatedZoneName}
              onChangeText={value => {
                setTreatedZoneName(value);
                if (selectedZone && value !== selectedZone.label) setSelectedZone(null);
              }}
              placeholder="e.g. Front lawn"
              colors={colors}
              error={!!errors.treatedZoneName}
            />
            {errors.treatedZoneName && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.treatedZoneName}</Text>
            )}
          </Field>

          {/* Target Pest */}
          <Field label="Target Pest" required={chemicalRequirements.targetPest} colors={colors}>
            <StyledInput
              value={targetPest}
              onChangeText={setTargetPest}
              placeholder="e.g. Grubs, Crabgrass, Ants…"
              colors={colors}
              error={!!errors.targetPest}
            />
            {errors.targetPest && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.targetPest}</Text>
            )}
          </Field>

          {/* Application Method */}
          <Field label="Application Method" required={chemicalRequirements.applicationMethod} colors={colors}>
            <SelectButton
              value={applicationMethod}
              placeholder="Select method…"
              onPress={() => setShowMethodPicker(true)}
              colors={colors}
            />
            {errors.applicationMethod && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.applicationMethod}</Text>
            )}
          </Field>

          {/* Environmental Conditions */}
          <View style={[styles.sectionDivider, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Environmental Conditions
            </Text>
          </View>
          <TouchableOpacity onPress={() => void loadCurrentWeather()} disabled={weatherBusy} accessibilityRole="button">
            <Text style={{ color: colors.primary, marginBottom: 8 }}>{weatherBusy ? 'Loading current weather…' : 'Refresh weather & application time to now'}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
            {weatherError || (weatherObservedAt
              ? `Open-Meteo estimated conditions as of ${new Date(weatherObservedAt).toLocaleString()}. Verify on site; you can edit these readings. Not based on the scheduled day.`
              : 'Enter conditions observed at the actual application time.')}
          </Text>

          <View style={styles.splitRow}>
            <View style={{ flex: 1 }}>
              <Field label="Wind Speed (mph)" required={chemicalRequirements.windSpeed} colors={colors}>
                <StyledInput
                  value={windSpeed}
                  onChangeText={setWindSpeed}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  colors={colors}
                  error={!!errors.windSpeed}
                />
                {errors.windSpeed && (
                  <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.windSpeed}</Text>
                )}
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Wind Direction" required={chemicalRequirements.windDirection} colors={colors}>
                <SelectButton
                  value={windDirection}
                  placeholder="N/A"
                  onPress={() => setShowWindDirPicker(true)}
                  colors={colors}
                />
                {errors.windDirection && (
                  <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.windDirection}</Text>
                )}
              </Field>
            </View>
          </View>

          <Field label="Temperature (°F)" required={chemicalRequirements.temperature} colors={colors}>
            <StyledInput
              value={temperature}
              onChangeText={setTemperature}
              placeholder="72"
              keyboardType="decimal-pad"
              colors={colors}
              error={!!errors.temperature}
            />
            {errors.temperature && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.temperature}</Text>
            )}
          </Field>

          {/* Applicator Info */}
          <View style={[styles.sectionDivider, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Applicator Info
            </Text>
          </View>

          <Field label="Applicator Name" required={chemicalRequirements.applicatorName} colors={colors}>
            <StyledInput
              value={applicatorName}
              onChangeText={setApplicatorName}
              placeholder="Name of applicator"
              colors={colors}
              error={!!errors.applicatorName}
            />
            {errors.applicatorName && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.applicatorName}</Text>
            )}
          </Field>

          <Field label="License Number" required={chemicalRequirements.applicatorLicenseNumber} colors={colors}>
            <StyledInput
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="State pesticide license #"
              colors={colors}
              error={!!errors.applicatorLicenseNumber}
            />
            {errors.applicatorLicenseNumber && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.applicatorLicenseNumber}</Text>
            )}
          </Field>

          <Field label="Notes" required={chemicalRequirements.notes} colors={colors}>
            <StyledInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes…"
              multiline
              colors={colors}
              error={!!errors.notes}
            />
            {errors.notes && (
              <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.notes}</Text>
            )}
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
          setTreatedZoneName(zone.label);
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

const safetyStyles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingTop: 12, marginBottom: 18 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 4 },
  product: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  productName: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 3 },
  loading: { alignSelf: 'flex-start', marginTop: 6 },
  message: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 5 },
  link: { flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 8, paddingVertical: 5 },
  linkText: { fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1 },
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
