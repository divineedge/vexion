import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAddVisitMedia,
  useDeleteVisitMedia,
  useGetVisit,
  useListVisitMedia,
  getGetVisitQueryKey,
  getListVisitMediaQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useOffline } from '@/contexts/OfflineContext';
import { MediaAttachments } from '@/components/MediaAttachments';

function formatVisitMode(mode: string): string {
  if (mode === 'drop_by') return 'Drop-by';
  if (mode === 'drive_by') return 'Drive-by';
  return 'Scheduled';
}

export default function VisitDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const visitId = Number(id);
  const { isOffline } = useOffline();
  const {
    data: visit,
    isLoading,
    isError,
    isFetching,
    refetch: refetchVisit,
  } = useGetVisit(visitId, {
    query: { queryKey: getGetVisitQueryKey(visitId), enabled: Number.isInteger(visitId) && !isOffline },
  });
  const {
    data: media = [],
    isLoading: mediaLoading,
    refetch: refetchMedia,
  } = useListVisitMedia(visitId, {
    query: { queryKey: getListVisitMediaQueryKey(visitId), enabled: Number.isInteger(visitId) && !isOffline },
  });
  const addMedia = useAddVisitMedia();
  const deleteMedia = useDeleteVisitMedia();

  const refresh = () => {
    void refetchVisit();
    void refetchMedia();
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Loading visit…</Text>
      </View>
    );
  }

  if (isError || !visit) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={42} color={colors.destructive} />
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Visit unavailable</Text>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          This visit may no longer be assigned to you.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>{visit.purpose}</Text>
          <View style={[styles.modeBadge, { backgroundColor: colors.primary + '18' }]}>
            <Text style={[styles.modeText, { color: colors.primary }]}>{formatVisitMode(visit.visitMode)}</Text>
          </View>
        </View>
        {visit.propertyAddress ? (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{visit.propertyAddress}</Text>
          </View>
        ) : null}
        {visit.customerName ? (
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{visit.customerName}</Text>
          </View>
        ) : null}
        {visit.scheduledAt ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {new Date(visit.scheduledAt).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </View>
        ) : null}
        {visit.completedAt ? (
          <View style={[styles.completeBanner, { backgroundColor: colors.statusCompleted + '18' }]}>
            <Ionicons name="checkmark-circle-outline" size={17} color={colors.statusCompleted} />
            <Text style={[styles.completeText, { color: colors.statusCompleted }]}>Visit completed</Text>
          </View>
        ) : null}
      </View>

      {visit.notes ? (
        <View style={styles.notesSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Visit Notes</Text>
          <View style={[styles.notesCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.notesText, { color: colors.foreground }]}>{visit.notes}</Text>
          </View>
        </View>
      ) : null}

      <MediaAttachments
        media={media}
        isLoading={mediaLoading}
        isOffline={isOffline}
        onAdd={data => addMedia.mutateAsync({ id: visitId, data })}
        onDelete={mediaId => deleteMedia.mutateAsync({ id: visitId, mediaId })}
        onRefresh={() => { void refetchMedia(); }}
        uploadScope="visit_media"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  helperText: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  card: { marginHorizontal: 16, marginBottom: 20, borderWidth: 1, borderRadius: 12, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 19, lineHeight: 25 },
  modeBadge: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5 },
  modeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  infoText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  completeBanner: { marginTop: 8, borderRadius: 8, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  completeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  notesSection: { paddingHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 10 },
  notesCard: { borderWidth: 1, borderRadius: 10, padding: 13 },
  notesText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
});