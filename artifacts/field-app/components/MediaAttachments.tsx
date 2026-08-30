import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { requestUploadUrl, type AddMediaInput, type MediaAttachment } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

type PendingMedia = {
  key: string;
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  caption: string;
  status: 'ready' | 'uploading' | 'failed';
  progress: number;
  error?: string;
};

type Props = {
  media: MediaAttachment[];
  isLoading?: boolean;
  isOffline?: boolean;
  onAdd: (input: AddMediaInput) => Promise<unknown>;
  onDelete: (mediaId: number) => Promise<unknown>;
  onRefresh: () => void;
  uploadScope: 'job_media' | 'visit_media';
};

function uploadBlob(
  uploadUrl: string,
  blob: Blob,
  mimeType: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', mimeType);
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error('Storage upload failed'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error('Storage upload failed'));
    };
    request.send(blob);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaAttachments({
  media,
  isLoading = false,
  isOffline = false,
  onAdd,
  onDelete,
  onRefresh,
  uploadScope,
}: Props) {
  const colors = useColors();
  const [pending, setPending] = useState<PendingMedia[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<MediaAttachment | null>(null);

  const updatePending = useCallback((key: string, patch: Partial<PendingMedia>) => {
    setPending(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }, []);

  const pickMedia = useCallback(async (source: 'camera' | 'library') => {
    if (isOffline) return;
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission Required',
        source === 'camera'
          ? 'Camera access is needed to capture job media.'
          : 'Photo library access is needed to attach media.',
      );
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images', 'videos'],
          quality: 0.8,
          videoMaxDuration: 120,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: 8,
          quality: 0.8,
        });

    if (result.canceled) return;
    const accepted: PendingMedia[] = [];
    for (const asset of result.assets) {
      const fileSize = asset.fileSize ?? 0;
      if (fileSize > MAX_MEDIA_SIZE) {
        Alert.alert('File Too Large', `${asset.fileName ?? 'This file'} is larger than 10 MB.`);
        continue;
      }
      const isVideo = asset.type === 'video';
      accepted.push({
        key: `${Date.now()}-${asset.assetId ?? asset.uri}-${accepted.length}`,
        uri: asset.uri,
        fileName: asset.fileName ?? `field-${isVideo ? 'video.mp4' : 'photo.jpg'}`,
        mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
        fileSize,
        caption: '',
        status: 'ready',
        progress: 0,
      });
    }
    setPending(current => [...current, ...accepted]);
  }, [isOffline]);

  const uploadPending = useCallback(async (item: PendingMedia) => {
    updatePending(item.key, { status: 'uploading', progress: 1, error: undefined });
    try {
      const localResponse = await fetch(item.uri);
      const blob = await localResponse.blob();
      if (blob.size > MAX_MEDIA_SIZE) throw new Error('Photos and videos must be 10 MB or smaller.');

      const { uploadURL, objectPath } = await requestUploadUrl({
        name: item.fileName,
        size: blob.size || item.fileSize || 1,
        contentType: item.mimeType,
        scope: uploadScope,
      });
      await uploadBlob(uploadURL, blob, item.mimeType, progress => {
        updatePending(item.key, { progress });
      });
      updatePending(item.key, { progress: 100 });
      await onAdd({
        fileKey: objectPath,
        fileUrl: objectPath,
        mimeType: item.mimeType,
        sizeBytes: blob.size || item.fileSize || 1,
        caption: item.caption.trim() || undefined,
        isCover: false,
      });
      setPending(current => current.filter(candidate => candidate.key !== item.key));
      onRefresh();
    } catch (error) {
      updatePending(item.key, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Upload failed. Try again.',
      });
    }
  }, [onAdd, onRefresh, updatePending, uploadScope]);

  const deleteAttachment = useCallback(async () => {
    if (!deleteCandidate) return;
    setDeletingId(deleteCandidate.id);
    try {
      await onDelete(deleteCandidate.id);
      setDeleteCandidate(null);
      onRefresh();
    } catch (error) {
      Alert.alert('Delete Failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setDeletingId(null);
    }
  }, [deleteCandidate, onDelete, onRefresh]);

  const imageCount = useMemo(() => media.filter(item => item.mimeType.startsWith('image/')).length, [media]);
  const videoCount = media.length - imageCount;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View>
          <Text style={[styles.heading, { color: colors.foreground }]}>Work Media</Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
            {imageCount} photo{imageCount === 1 ? '' : 's'} · {videoCount} video{videoCount === 1 ? '' : 's'}
          </Text>
        </View>
        {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: isOffline ? 0.5 : 1 }]}
          onPress={() => void pickMedia('camera')}
          disabled={isOffline}
          testID="media-camera-button"
        >
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: isOffline ? 0.5 : 1 }]}
          onPress={() => void pickMedia('library')}
          disabled={isOffline}
          testID="media-library-button"
        >
          <Ionicons name="images-outline" size={20} color={colors.primary} />
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>Library</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.limitText, { color: colors.mutedForeground }]}>
        Photos and videos up to 10 MB. Videos are optimized after upload.
      </Text>

      {pending.map(item => (
        <View key={item.key} style={[styles.pendingCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {item.mimeType.startsWith('image/') ? (
            <Image source={{ uri: item.uri }} style={styles.pendingPreview} />
          ) : (
            <View style={[styles.pendingPreview, styles.videoPlaceholder, { backgroundColor: colors.muted }]}>
              <Ionicons name="videocam-outline" size={28} color={colors.primary} />
            </View>
          )}
          <View style={styles.pendingBody}>
            <TextInput
              value={item.caption}
              onChangeText={caption => updatePending(item.key, { caption })}
              editable={item.status !== 'uploading'}
              placeholder="Add a caption"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.captionInput, { color: colors.foreground, borderColor: colors.border }]}
            />
            {item.status === 'uploading' ? (
              <View>
                <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                  Uploading {item.progress}%
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                  <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${item.progress}%` }]} />
                </View>
              </View>
            ) : (
              <>
                {item.error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{item.error}</Text> : null}
                <View style={styles.pendingActions}>
                  <TouchableOpacity onPress={() => setPending(current => current.filter(candidate => candidate.key !== item.key))}>
                    <Text style={[styles.removeText, { color: colors.mutedForeground }]}>Remove</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.uploadButton, { backgroundColor: colors.primary }]}
                    onPress={() => void uploadPending(item)}
                    testID={`media-${item.status === 'failed' ? 'retry' : 'upload'}-button`}
                  >
                    <Ionicons name={item.status === 'failed' ? 'refresh-outline' : 'cloud-upload-outline'} size={16} color={colors.primaryForeground} />
                    <Text style={[styles.uploadLabel, { color: colors.primaryForeground }]}>
                      {item.status === 'failed' ? 'Retry' : 'Upload'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      ))}

      {media.length === 0 && pending.length === 0 && !isLoading ? (
        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.muted }]}>
          <Ionicons name="camera-outline" size={30} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No work media yet</Text>
        </View>
      ) : null}

      <View style={styles.gallery}>
        {media.map(attachment => {
          const isVideo = attachment.mimeType.startsWith('video/');
          return (
            <View key={attachment.id} style={[styles.mediaCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TouchableOpacity
                style={styles.mediaPreview}
                onPress={() => attachment.signedUrl
                  ? void Linking.openURL(attachment.signedUrl)
                  : Alert.alert('Preview Unavailable', 'Refresh the gallery and try again.')}
                testID={`media-preview-${attachment.id}`}
              >
                {!isVideo && attachment.signedUrl ? (
                  <Image source={{ uri: attachment.signedUrl }} style={styles.mediaPreview} />
                ) : (
                  <View style={[styles.mediaPreview, styles.videoPlaceholder, { backgroundColor: colors.muted }]}>
                    <Ionicons name={isVideo ? 'play-circle-outline' : 'image-outline'} size={34} color={colors.primary} />
                    {isVideo ? <Text style={[styles.playText, { color: colors.foreground }]}>Play video</Text> : null}
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.mediaFooter}>
                <View style={styles.mediaMeta}>
                  <Text style={[styles.mediaType, { color: colors.foreground }]}>{isVideo ? 'Video' : 'Photo'}</Text>
                  <Text style={[styles.mediaSize, { color: colors.mutedForeground }]}>{formatSize(attachment.sizeBytes)}</Text>
                  {attachment.caption ? (
                    <Text style={[styles.caption, { color: colors.foreground }]} numberOfLines={2}>{attachment.caption}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => setDeleteCandidate(attachment)}
                  disabled={deletingId === attachment.id || isOffline}
                  testID={`media-delete-${attachment.id}`}
                >
                  {deletingId === attachment.id
                    ? <ActivityIndicator size="small" color={colors.destructive} />
                    : <Ionicons name="trash-outline" size={19} color={colors.destructive} />}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      <Modal
        visible={Boolean(deleteCandidate)}
        transparent
        animationType="fade"
        onRequestClose={() => deletingId == null && setDeleteCandidate(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.confirmIcon, { backgroundColor: colors.destructive + '14' }]}>
              <Ionicons name="trash-outline" size={24} color={colors.destructive} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Delete media?</Text>
            <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>
              This permanently removes the photo or video from this work record.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, { borderColor: colors.border }]}
                onPress={() => setDeleteCandidate(null)}
                disabled={deletingId != null}
                testID="media-delete-cancel"
              >
                <Text style={[styles.confirmButtonText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}
                onPress={() => void deleteAttachment()}
                disabled={deletingId != null}
                testID="media-delete-confirm"
              >
                {deletingId != null ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.confirmButtonText, { color: '#fff' }]}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginBottom: 20 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  subheading: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 10, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  limitText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 7, marginBottom: 12 },
  pendingCard: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', gap: 10, marginBottom: 10 },
  pendingPreview: { width: 82, height: 82, borderRadius: 8 },
  pendingBody: { flex: 1, justifyContent: 'space-between' },
  captionInput: { borderWidth: 1, borderRadius: 8, minHeight: 38, paddingHorizontal: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  progressLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, marginBottom: 5 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  pendingActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  removeText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  uploadButton: { minHeight: 34, borderRadius: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  uploadLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 11, marginVertical: 5 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 7 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  mediaCard: { width: '48%', borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  mediaPreview: { width: '100%', aspectRatio: 1.3 },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  playText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  mediaFooter: { flexDirection: 'row', padding: 9, alignItems: 'flex-start', gap: 6 },
  mediaMeta: { flex: 1 },
  mediaType: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  mediaSize: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15, marginTop: 5 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 16, padding: 20, alignItems: 'center' },
  confirmIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 7 },
  confirmBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 20 },
  confirmButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  confirmButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});