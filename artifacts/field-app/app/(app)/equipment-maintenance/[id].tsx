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
  ScrollView,
  Image,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  useGetEquipment,
  useCreateEquipmentMaintenance,
  useAddEquipmentMaintenanceMedia,
  customFetch,
  type EquipmentMaintenanceInput,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type Equipment = { id: number; name: string };

type AttachedMedia = {
  uri: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  uploading: boolean;
  uploaded: boolean;
  error?: string;
};

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
  multiline,
  keyboardType,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
  error?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      numberOfLines={multiline ? 3 : 1}
      style={[
        styles.input,
        multiline && styles.inputMultiline,
        {
          color: colors.foreground,
          backgroundColor: colors.muted,
          borderColor: error ? colors.destructive : colors.border,
        },
      ]}
    />
  );
}

/**
 * Fetch a local URI as a blob, upload to a GCS signed URL, and return
 * the blob's byte length (useful when the picker omits fileSize).
 */
async function uploadToSignedUrl(
  signedUrl: string,
  uri: string,
  mimeType: string,
): Promise<number> {
  const localResp = await fetch(uri);
  const blob = await localResp.blob();
  const uploadResp = await fetch(signedUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': mimeType },
  });
  if (!uploadResp.ok) throw new Error('Storage upload failed');
  return blob.size;
}

/** Full 3-step upload: request URL → PUT blob → save media record */
async function attachFile(opts: {
  uri: string;
  mimeType: string;
  fileName: string;
  knownSize: number; // 0 = unknown; derive from blob
  maintenanceId: number;
  addMedia: (args: { id: number; data: { fileKey: string; fileUrl: string; mimeType: string; sizeBytes: number; isCover: boolean } }) => Promise<unknown>;
}): Promise<void> {
  const { uri, mimeType, fileName, maintenanceId, addMedia } = opts;

  // Step 1: Request a signed upload URL.
  // We pass size=1 as a placeholder when we don't know the size yet —
  // the real size is derived from the blob and stored in the media record.
  const placeholderSize = opts.knownSize > 0 ? opts.knownSize : 1;
  const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
    '/api/storage/uploads/request-url',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName, size: placeholderSize, contentType: mimeType }),
    },
  );

  // Step 2: Upload (returns actual blob size)
  const actualSize = await uploadToSignedUrl(uploadURL, uri, mimeType);

  // Step 3: Save attachment record with the real size
  await addMedia({
    id: maintenanceId,
    data: {
      fileKey: objectPath,
      fileUrl: objectPath,
      mimeType,
      sizeBytes: actualSize > 0 ? actualSize : placeholderSize,
      isCover: false,
    },
  });
}

export default function LogMaintenanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const equipmentId = Number(id);

  const { data: equipment } = useGetEquipment(equipmentId);
  const eq = equipment as Equipment | undefined;

  const createMutation = useCreateEquipmentMaintenance();
  const addMediaMutation = useAddEquipmentMaintenanceMedia();

  // Form state
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [vendor, setVendor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Post-save state
  const [savedMaintenanceId, setSavedMaintenanceId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<AttachedMedia[]>([]);

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!description.trim()) e.description = 'Description is required';
    if (cost && (isNaN(Number(cost)) || Number(cost) < 0)) {
      e.cost = 'Enter a valid cost';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [description, cost]);

  const handleSave = useCallback(async () => {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const body: EquipmentMaintenanceInput = {
        date: new Date().toISOString(),
        description: description.trim(),
      };
      if (cost.trim()) body.cost = Number(cost);
      if (vendor.trim()) body.vendor = vendor.trim();

      const record = await createMutation.mutateAsync({ id: equipmentId, data: body });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedMaintenanceId((record as { id: number }).id);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to log maintenance. Please try again.');
    }
  }, [validate, description, cost, vendor, createMutation, equipmentId]);

  /** Shared upload handler used by both image and document pickers */
  const uploadEntry = useCallback(
    async (entry: AttachedMedia) => {
      if (savedMaintenanceId === null) return;
      setAttachments((prev) => [...prev, entry]);
      try {
        await attachFile({
          uri: entry.uri,
          mimeType: entry.mimeType,
          fileName: entry.fileName,
          knownSize: entry.fileSize,
          maintenanceId: savedMaintenanceId,
          addMedia: addMediaMutation.mutateAsync,
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAttachments((prev) =>
          prev.map((a) => (a.uri === entry.uri ? { ...a, uploading: false, uploaded: true } : a)),
        );
      } catch {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setAttachments((prev) =>
          prev.map((a) =>
            a.uri === entry.uri ? { ...a, uploading: false, error: 'Upload failed' } : a,
          ),
        );
      }
    },
    [savedMaintenanceId, addMediaMutation.mutateAsync],
  );

  const pickImage = useCallback(
    async (source: 'camera' | 'library') => {
      if (savedMaintenanceId === null) return;

      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera access is needed to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: false,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Photo library access is needed to pick images.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: false,
        });
      }

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const knownSize = asset.fileSize ?? 0;
      const MAX_BYTES = 10 * 1024 * 1024;
      if (knownSize > MAX_BYTES) {
        Alert.alert('File Too Large', 'Images must be 10 MB or smaller.');
        return;
      }

      await uploadEntry({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: asset.fileName ?? `photo_${Date.now()}.jpg`,
        fileSize: knownSize,
        uploading: true,
        uploaded: false,
      });
    },
    [savedMaintenanceId, uploadEntry],
  );

  const pickDocument = useCallback(async () => {
    if (savedMaintenanceId === null) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const knownSize = asset.size ?? 0;
    const MAX_BYTES = 10 * 1024 * 1024;
    if (knownSize > MAX_BYTES) {
      Alert.alert('File Too Large', 'Files must be 10 MB or smaller.');
      return;
    }

    await uploadEntry({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileName: asset.name ?? `receipt_${Date.now()}`,
      fileSize: knownSize,
      uploading: true,
      uploaded: false,
    });
  }, [savedMaintenanceId, uploadEntry]);

  const handleDone = useCallback(async () => {
    await Haptics.selectionAsync();
    router.back();
  }, []);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 100;
  const isSaving = createMutation.isPending;
  const saved = savedMaintenanceId !== null;

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

          {/* ── STEP 1: Maintenance Form ── */}
          {!saved && (
            <>
              <Field label="Description" required colors={colors}>
                <StyledInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What was done?"
                  colors={colors}
                  error={!!errors.description}
                  multiline
                />
                {errors.description && (
                  <Text style={[styles.errMsg, { color: colors.destructive }]}>
                    {errors.description}
                  </Text>
                )}
              </Field>

              <Field label="Total Cost" colors={colors}>
                <StyledInput
                  value={cost}
                  onChangeText={setCost}
                  placeholder="0.00"
                  colors={colors}
                  error={!!errors.cost}
                  keyboardType="decimal-pad"
                />
                {errors.cost && (
                  <Text style={[styles.errMsg, { color: colors.destructive }]}>{errors.cost}</Text>
                )}
              </Field>

              <Field label="Vendor / Shop" colors={colors}>
                <StyledInput
                  value={vendor}
                  onChangeText={setVendor}
                  placeholder="Where was the work done?"
                  colors={colors}
                />
              </Field>
            </>
          )}

          {/* ── STEP 2: Attachment UI (shown after save) ── */}
          {saved && (
            <>
              {/* Confirmation pill */}
              <View
                style={[
                  styles.successBanner,
                  { backgroundColor: '#16a34a15', borderColor: '#16a34a40' },
                ]}
              >
                <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                <Text style={[styles.successText, { color: '#16a34a' }]}>
                  Maintenance logged — add photos or receipts below
                </Text>
              </View>

              {/* Picker buttons */}
              <View style={styles.pickerRow}>
                <TouchableOpacity
                  style={[styles.pickerBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => pickImage('camera')}
                  activeOpacity={0.8}
                  testID="take-photo-button"
                >
                  <Ionicons name="camera-outline" size={24} color={colors.primary} />
                  <Text style={[styles.pickerLabel, { color: colors.foreground }]}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pickerBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => pickImage('library')}
                  activeOpacity={0.8}
                  testID="pick-from-library-button"
                >
                  <Ionicons name="image-outline" size={24} color={colors.primary} />
                  <Text style={[styles.pickerLabel, { color: colors.foreground }]}>
                    From Library
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pickerBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={pickDocument}
                  activeOpacity={0.8}
                  testID="pick-document-button"
                >
                  <Ionicons name="receipt-outline" size={24} color={colors.primary} />
                  <Text style={[styles.pickerLabel, { color: colors.foreground }]}>
                    Receipt (PDF)
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>
                Photos or PDF receipts ≤ 10 MB · Tap "Done" when finished
              </Text>

              {/* Attachment thumbnails */}
              {attachments.length > 0 && (
                <View style={styles.thumbGrid}>
                  {attachments.map((a, i) => (
                    <View
                      key={i}
                      style={[styles.thumb, { borderColor: colors.border }]}
                      testID={`attachment-thumb-${i}`}
                    >
                      <Image source={{ uri: a.uri }} style={styles.thumbImg} />
                      {a.uploading && (
                        <View style={styles.thumbOverlay}>
                          <ActivityIndicator color="#ffffff" size="small" />
                        </View>
                      )}
                      {a.uploaded && (
                        <View style={[styles.thumbBadge, { backgroundColor: '#16a34a' }]}>
                          <Ionicons name="checkmark" size={12} color="#ffffff" />
                        </View>
                      )}
                      {!!a.error && (
                        <View style={[styles.thumbBadge, { backgroundColor: '#ef4444' }]}>
                          <Ionicons name="close" size={12} color="#ffffff" />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {attachments.length === 0 && (
                <View
                  style={[
                    styles.emptyAttach,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Ionicons name="receipt-outline" size={32} color={colors.mutedForeground} />
                  <Text style={[styles.emptyAttachText, { color: colors.mutedForeground }]}>
                    No attachments yet
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* Footer button */}
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
        {!saved ? (
          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary, opacity: isSaving ? 0.7 : 1 },
            ]}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.85}
            testID="save-maintenance-button"
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <Ionicons name="save-outline" size={20} color="#ffffff" />
                <Text style={styles.submitText}>Log Maintenance</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            onPress={handleDone}
            activeOpacity={0.85}
            testID="done-button"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
            <Text style={styles.submitText}>Done</Text>
          </TouchableOpacity>
        )}
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
  inputMultiline: {
    height: 90,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  errMsg: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  successText: { fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  pickerBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 20,
    gap: 8,
  },
  pickerLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  pickerHint: { fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 16, textAlign: 'center' },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAttach: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 8,
    marginTop: 4,
  },
  emptyAttachText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
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
