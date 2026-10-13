import { useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useListEquipmentInspections, getListEquipmentInspectionsQueryKey, useReviewEquipmentInspection } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export function EquipmentInspectionHistory({ equipmentId }: { equipmentId: number }) {
  const colors = useColors(), qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const history = useListEquipmentInspections(equipmentId, { query: { queryKey: getListEquipmentInspectionsQueryKey(equipmentId), enabled: open, refetchInterval: open ? 30000 : false } });
  const review = useReviewEquipmentInspection();
  return <View style={{ marginTop: 18, gap: 12 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(!open)}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{open ? 'Hide' : 'Show'} inspection records & manager reviews</Text>
    </TouchableOpacity>
    {open && <>
      <Text style={{ color: colors.mutedForeground }}>These are equipment records, not tasks. Fuel is recorded in equipment operating costs.</Text>
      {history.isLoading && <ActivityIndicator color={colors.primary} />}
      {history.isError && <TouchableOpacity onPress={() => history.refetch()}><Text style={{ color: colors.primary }}>Could not load records. Tap to retry.</Text></TouchableOpacity>}
      {history.data?.records.length === 0 && <Text style={{ color: colors.mutedForeground }}>No inspections recorded yet.</Text>}
      {history.data?.records.map(record => <View key={record.ref} style={{ padding: 12, gap: 8, borderWidth: 1, borderRadius: 8, borderColor: colors.border }}>
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>{record.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{record.recordedBy} · {new Date(record.recordedAt).toLocaleString()}</Text>
        <Text style={{ color: colors.foreground }}>{record.description}</Text>
        {record.checklist.map(item => <Text key={item.id} style={{ color: colors.foreground }}>{item.checked ? 'Checked' : 'Not checked'} — {item.label}</Text>)}
        {record.reviews.map(item => <Text key={item.id} style={{ color: colors.foreground }}>Reviewed by {item.reviewedBy} · {new Date(item.reviewedAt).toLocaleString()}{item.notes ? `\n${item.notes}` : ''}</Text>)}
        {!record.reviews.length && <Text style={{ color: colors.mutedForeground }}>Awaiting manager review</Text>}
        {history.data.canReview && <>
          <TextInput accessibilityLabel="Inspection review notes" multiline maxLength={4000} placeholder="Review notes (optional)" placeholderTextColor={colors.mutedForeground} value={notes[record.ref] ?? ''} onChangeText={value => setNotes(current => ({ ...current, [record.ref]: value }))} style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, padding: 10, borderRadius: 8 }} />
          <TouchableOpacity accessibilityRole="button" disabled={review.isPending} onPress={() => review.mutate({ id: equipmentId, ref: record.ref, data: { notes: notes[record.ref] ?? '' } }, {
            onSuccess: () => { setNotes(current => ({ ...current, [record.ref]: '' })); qc.invalidateQueries({ queryKey: getListEquipmentInspectionsQueryKey(equipmentId) }); },
            onError: () => Alert.alert('Review not saved', 'Your notes are kept. Please retry.'),
          })}><Text style={{ color: colors.primary, fontWeight: '700' }}>{review.isPending ? 'Saving…' : 'Record manager review'}</Text></TouchableOpacity>
        </>}
      </View>)}
    </>}
  </View>;
}
