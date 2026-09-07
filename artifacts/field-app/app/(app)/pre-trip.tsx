import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useCreateEquipmentPreTrip,
  useListEquipment,
  useGetTenantSettings,
  useListEquipmentPreTripMedia,
  getListEquipmentPreTripMediaQueryKey,
  useAddEquipmentPreTripMedia,
  useDeleteEquipmentPreTripMedia,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { MediaAttachments } from '@/components/MediaAttachments';

type Equipment = { id: number; name: string; type: string; currentHours: number; currentMiles?: number | null; isActive: boolean };
type Condition = 'good' | 'needs_attention' | 'unsafe';
type ChecklistItem = { id: string; label: string; required: boolean; equipmentTypes?: string[] };

export default function PreTripScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useListEquipment();
  const { data: settings } = useGetTenantSettings();
  const createPreTrip = useCreateEquipmentPreTrip();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [condition, setCondition] = useState<Condition>('good');
  const [gallons, setGallons] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [readingType, setReadingType] = useState<'hours' | 'mileage'>('hours');
  const [reading, setReading] = useState('');
  const [concerns, setConcerns] = useState('');
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [savedTaskId, setSavedTaskId] = useState<number | null>(null);
  const [inspectionType, setInspectionType] = useState<'pre_trip' | 'end_of_day'>('pre_trip');
  const preTripChecklist = (settings?.preTripChecklist ?? []) as ChecklistItem[];
  const endOfDayChecklist = (settings?.endOfDayChecklist ?? []) as ChecklistItem[];
  const configuredChecklist = inspectionType === 'end_of_day' ? endOfDayChecklist : preTripChecklist;
  const mediaQuery = useListEquipmentPreTripMedia(savedTaskId ?? 0, { query: { queryKey: getListEquipmentPreTripMediaQueryKey(savedTaskId ?? 0), enabled: savedTaskId != null } });
  const addMedia = useAddEquipmentPreTripMedia();
  const deleteMedia = useDeleteEquipmentPreTripMedia();

  const equipment = ((data as Equipment[] | undefined) ?? []).filter(item => item.isActive);
  const selected = equipment.find(item => item.id === selectedId) ?? null;
  const checklist = selected
    ? configuredChecklist.filter(item => !item.equipmentTypes?.length || item.equipmentTypes.includes(selected.type))
    : [];
  useEffect(() => {
    setAnswers({});
    setSavedTaskId(null);
    idempotencyKey.current = `${inspectionType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [selectedId, inspectionType]);
  // Kept for the life of this entry so a network retry can safely replay it.
  const idempotencyKey = useRef(`pretrip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const isSaving = createPreTrip.isPending;

  const handleSave = useCallback(async () => {
    if (!selected) {
      Alert.alert('Choose equipment', 'Select the equipment you inspected before saving.');
      return;
    }
    const missing = checklist.filter(item => item.required && !answers[item.id]);
    if (missing.length) {
      Alert.alert('Complete required checks', missing.map(item => item.label).join('\n'));
      return;
    }
    if (gallons && (Number.isNaN(Number(gallons)) || Number(gallons) <= 0)) {
      Alert.alert('Invalid fuel amount', 'Enter a positive number of gallons or leave it blank.');
      return;
    }
    if (fuelCost && (Number.isNaN(Number(fuelCost)) || Number(fuelCost) < 0)) {
      Alert.alert('Invalid fuel cost', 'Enter a non-negative fuel cost or leave it blank.');
      return;
    }
    if (fuelCost && !gallons) {
      Alert.alert('Fuel amount required', 'Enter gallons before adding a fuel cost.');
      return;
    }
    if (reading && (Number.isNaN(Number(reading)) || Number(reading) < 0)) {
      Alert.alert('Invalid meter reading', 'Enter a non-negative meter reading or leave it blank.');
      return;
    }
    const currentReading = readingType === 'hours' ? selected.currentHours : selected.currentMiles;
    if (reading && currentReading != null && Number(reading) < currentReading) {
      Alert.alert(
        'Meter reading is too low',
        `Enter at least the current ${readingType === 'hours' ? 'hour' : 'mileage'} reading (${currentReading}).`,
      );
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await createPreTrip.mutateAsync({
        data: {
          idempotencyKey: idempotencyKey.current,
          equipmentId: selected.id,
          condition,
          inspectionType,
          ...(gallons ? { fuelGallons: Number(gallons) } : {}),
          ...(fuelCost ? { fuelCost: Number(fuelCost) } : {}),
          ...(reading ? { readingType, readingValue: Number(reading) } : {}),
          ...(concerns.trim() ? { concerns: concerns.trim() } : {}),
          checklistResponses: checklist.map(item => ({ id: item.id, label: item.label, checked: !!answers[item.id] })),
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGallons('');
      setFuelCost('');
      setReading('');
      setConcerns('');
      setCondition('good');
      setAnswers({});
      setSavedTaskId(result.taskId);
      idempotencyKey.current = `${inspectionType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      Alert.alert(`${inspectionType === 'end_of_day' ? 'End-of-day' : 'Pre-trip'} check saved`, 'Inspection saved. You can now attach photos or videos below.');
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save pre-trip', 'Check your connection and try again. No separate equipment ledger was created.');
    }
  }, [selected, gallons, fuelCost, reading, readingType, condition, concerns, checklist, answers, inspectionType, createPreTrip]);

  if (isLoading) {
    return <View style={[styles.centered, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 92 }} keyboardShouldPersistTaps="handled" bottomOffset={70}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>Complete one check for each piece of equipment. Fuel and meter entries use the existing equipment history.</Text>
        {endOfDayChecklist.length > 0 && (
          <View style={styles.choices}>
            <TouchableOpacity onPress={() => setInspectionType('pre_trip')} style={[styles.choice, { backgroundColor: inspectionType === 'pre_trip' ? colors.primary : colors.muted }]}><Text style={[styles.choiceText, { color: inspectionType === 'pre_trip' ? '#fff' : colors.mutedForeground }]}>Pre-trip</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setInspectionType('end_of_day')} style={[styles.choice, { backgroundColor: inspectionType === 'end_of_day' ? colors.primary : colors.muted }]}><Text style={[styles.choiceText, { color: inspectionType === 'end_of_day' ? '#fff' : colors.mutedForeground }]}>End of day</Text></TouchableOpacity>
          </View>
        )}
        <Text style={[styles.label, { color: colors.foreground }]}>Equipment</Text>
        <View style={styles.equipmentList}>
          {equipment.map(item => (
            <TouchableOpacity key={item.id} style={[styles.equipment, { borderColor: selectedId === item.id ? colors.primary : colors.border, backgroundColor: selectedId === item.id ? colors.primary + '10' : colors.card }]} onPress={() => setSelectedId(item.id)} testID={`pre-trip-equipment-${item.id}`}>
              <Ionicons name="construct-outline" size={18} color={selectedId === item.id ? colors.primary : colors.mutedForeground} />
              <View style={{ flex: 1 }}><Text style={[styles.equipmentName, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.small, { color: colors.mutedForeground }]}>{item.type} · {item.currentHours} hrs{item.currentMiles != null ? ` · ${item.currentMiles} mi` : ''}</Text></View>
              {selectedId === item.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
            </TouchableOpacity>
          ))}
          {!equipment.length && <Text style={[styles.small, { color: colors.mutedForeground }]}>No active equipment is available. In the office app, add equipment or restore it from Equipment → Archived.</Text>}
        </View>
        <Text style={[styles.label, { color: colors.foreground }]}>Condition</Text>
        <View style={styles.choices}>
          {(['good', 'needs_attention', 'unsafe'] as Condition[]).map(value => <TouchableOpacity key={value} onPress={() => setCondition(value)} style={[styles.choice, { backgroundColor: condition === value ? colors.primary : colors.muted }]} testID={`pre-trip-condition-${value}`}><Text style={[styles.choiceText, { color: condition === value ? '#fff' : colors.mutedForeground }]}>{value.replace('_', ' ')}</Text></TouchableOpacity>)}
        </View>
        {checklist.length > 0 && <>
          <Text style={[styles.label, { color: colors.foreground }]}>Safety checks</Text>
          <View style={styles.equipmentList}>
            {checklist.map(item => (
              <TouchableOpacity key={item.id} onPress={() => setAnswers(current => ({ ...current, [item.id]: !current[item.id] }))} style={[styles.equipment, { borderColor: answers[item.id] ? colors.primary : colors.border, backgroundColor: answers[item.id] ? colors.primary + '10' : colors.card }]}>
                <Ionicons name={answers[item.id] ? 'checkbox' : 'square-outline'} size={20} color={answers[item.id] ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.equipmentName, { color: colors.foreground, flex: 1 }]}>{item.label}{item.required ? ' *' : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>}
        <Text style={[styles.small, { color: colors.mutedForeground, marginTop: 8 }]}>Office staff can change these questions in Settings → Equipment → {inspectionType === 'end_of_day' ? 'Optional End-of-Day Checklist' : 'Pre-Trip Checklist'}.</Text>
        <Text style={[styles.label, { color: colors.foreground }]}>Fuel added (optional)</Text>
        <View style={styles.row}><TextInput value={gallons} onChangeText={setGallons} placeholder="Gallons" keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]} /><TextInput value={fuelCost} onChangeText={setFuelCost} placeholder="Cost" keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]} /></View>
        <Text style={[styles.label, { color: colors.foreground }]}>Meter reading (optional)</Text>
        <View style={styles.choices}><TouchableOpacity onPress={() => setReadingType('hours')} style={[styles.choice, { backgroundColor: readingType === 'hours' ? colors.primary : colors.muted }]}><Text style={[styles.choiceText, { color: readingType === 'hours' ? '#fff' : colors.mutedForeground }]}>Hours</Text></TouchableOpacity><TouchableOpacity onPress={() => setReadingType('mileage')} style={[styles.choice, { backgroundColor: readingType === 'mileage' ? colors.primary : colors.muted }]}><Text style={[styles.choiceText, { color: readingType === 'mileage' ? '#fff' : colors.mutedForeground }]}>Mileage</Text></TouchableOpacity></View>
        <TextInput value={reading} onChangeText={setReading} placeholder={readingType === 'hours' ? 'Current hour meter' : 'Current odometer'} keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={[styles.fullInput, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]} />
        <Text style={[styles.label, { color: colors.foreground }]}>Concerns / follow-up</Text>
        <TextInput value={concerns} onChangeText={setConcerns} placeholder="Describe damage, leaks, or needed maintenance" multiline numberOfLines={4} placeholderTextColor={colors.mutedForeground} style={[styles.concerns, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]} testID="pre-trip-concerns-input" />
        {savedTaskId && <>
          <Text style={[styles.label, { color: colors.foreground }]}>Inspection photos & videos</Text>
          <MediaAttachments
            media={mediaQuery.data ?? []}
            isLoading={mediaQuery.isLoading}
            onAdd={input => addMedia.mutateAsync({ id: savedTaskId, data: input })}
            onDelete={mediaId => deleteMedia.mutateAsync({ id: savedTaskId, mediaId })}
            onRefresh={() => void mediaQuery.refetch()}
            uploadScope="pre_trip_media"
          />
        </>}
      </KeyboardAwareScrollViewCompat>
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 12 }]}><TouchableOpacity disabled={isSaving} onPress={handleSave} style={[styles.save, { backgroundColor: colors.primary, opacity: isSaving ? .65 : 1 }]} testID="save-pre-trip-button">{isSaving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle-outline" size={20} color="#fff" /><Text style={styles.saveText}>Save {inspectionType === 'end_of_day' ? 'End-of-Day' : 'Pre-trip'} Check</Text></>}</TouchableOpacity></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 8, marginTop: 14 },
  equipmentList: { gap: 7 }, equipment: { borderWidth: 1, borderRadius: 10, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  equipmentName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 }, small: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  choices: { flexDirection: 'row', gap: 7 }, choice: { flex: 1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center' }, choiceText: { fontFamily: 'Inter_500Medium', fontSize: 12, textTransform: 'capitalize' },
  row: { flexDirection: 'row', gap: 8 }, input: { flex: 1, height: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontFamily: 'Inter_400Regular' },
  fullInput: { height: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', marginTop: 8 },
  concerns: { minHeight: 92, borderWidth: 1, borderRadius: 9, padding: 12, fontFamily: 'Inter_400Regular', textAlignVertical: 'top' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  save: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, saveText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});