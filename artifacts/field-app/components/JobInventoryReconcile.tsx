import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Reservation = { id: string; name: string; quantity: number };

export function JobInventoryReconcile({ jobId }: { jobId: number }) {
  const colors = useColors();
  const query = useQuery({
    queryKey: ['job-inventory-reconciliation', jobId],
    queryFn: () => customFetch<{ reservations: Reservation[] }>(`/api/jobs/${jobId}/inventory-reconciliation`),
  });
  const [used, setUsed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const rows = query.data?.reservations ?? [];
  if (!rows.length && !query.isLoading) return null;
  return (
    <View style={{ margin: 16, padding: 12, borderWidth: 1, borderColor: '#d97706', borderRadius: 12, gap: 8 }}>
      <Text style={{ color: colors.foreground, fontWeight: '700' }}>Reserved materials</Text>
      <Text style={{ color: colors.mutedForeground }}>Record what this job used. Leftover stock returns to general inventory.</Text>
      {query.isLoading ? <ActivityIndicator color={colors.primary} /> : rows.map(row => (
        <View key={row.id} style={{ gap: 4 }}>
          <Text style={{ color: colors.foreground }}>{row.name} reserved {row.quantity}</Text>
          <TextInput keyboardType="decimal-pad" value={used[row.id] ?? String(row.quantity)} onChangeText={value => setUsed(current => ({ ...current, [row.id]: value }))} style={{ borderWidth: 1, borderColor: colors.border, color: colors.foreground, borderRadius: 8, padding: 8 }} />
        </View>
      ))}
      <TouchableOpacity disabled={saving || !rows.length} onPress={async () => {
        setSaving(true);
        try {
          await customFetch(`/api/jobs/${jobId}/inventory-reconciliation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: rows.map(row => ({ reservationId: row.id, consumedQuantity: Number(used[row.id] ?? row.quantity) })) }) });
          setMessage('Leftover stock returned to general inventory.');
          await query.refetch();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Could not save the material check');
        } finally {
          setSaving(false);
        }
      }} style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 10, alignItems: 'center' }}>
        <Text style={{ color: colors.primaryForeground }}>{saving ? 'Saving' : 'Save used quantity'}</Text>
      </TouchableOpacity>
      {!!message && <Text style={{ color: colors.foreground }}>{message}</Text>}
    </View>
  );
}
