import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListJobRequestsQueryKey, getListPropertiesQueryKey, useAmendJobRequest, useCreateJobRequest,
  useListCustomers, useListProperties, useListServices,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const key = () => `${Date.now()}${Math.random().toString(36).slice(2, 11)}`;

export default function JobRequestForm() {
  const colors = useColors();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ amendId?: string; notes?: string }>();
  const amendId = params.amendId ? Number(params.amendId) : null;
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState(params.notes ?? '');
  const [idempotencyKey] = useState(key);
  const { data: customerResponse } = useListCustomers({ limit: 100 });
  const { data: properties } = useListProperties(customerId ? { customerId } : undefined, { query: { enabled: !!customerId, queryKey: getListPropertiesQueryKey(customerId ? { customerId } : undefined) } });
  const { data: services } = useListServices({ activeOnly: true });
  const mutation = useCreateJobRequest();
  const amendMutation = useAmendJobRequest();
  const customers = customerResponse?.items ?? [];
  const validStart = useMemo(() => {
    const d = new Date(start);
    return start.length > 0 && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  }, [start]);

  const submit = () => {
    if (amendId && !amendMutation.isPending) {
      amendMutation.mutate({ id: amendId, data: { notes: notes.trim(), idempotencyKey } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListJobRequestsQueryKey() }); router.replace('/(app)/my-requests'); } });
      return;
    }
    if (!validStart || mutation.isPending) return;
    mutation.mutate({ data: {
      customerId, propertyId, serviceId, requestedStartDate: validStart,
      requestedEndDate: end && !Number.isNaN(new Date(end).getTime()) ? new Date(end).toISOString() : null,
      notes: notes.trim() || null, idempotencyKey,
    } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListJobRequestsQueryKey() }); router.replace('/(app)/my-requests'); },
    });
  };
  const choice = (label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} style={[styles.choice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '16' : colors.card }]}>
      <Text style={{ color: selected ? colors.primary : colors.foreground }}>{label}</Text>
    </TouchableOpacity>
  );
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
    <Text style={[styles.helper, { color: colors.mutedForeground }]}>{amendId ? 'Add the requested clarification and resubmit for review.' : 'Submit a request for manager review. It will not appear on the schedule until it is approved.'}</Text>
    {!amendId && <><Text style={[styles.label, { color: colors.foreground }]}>Customer</Text>
    <View style={styles.choices}>{choice('No customer selected', customerId == null, () => { setCustomerId(null); setPropertyId(null); })}{customers.map(c => choice(c.name, customerId === c.id, () => { setCustomerId(c.id); setPropertyId(null); }))}</View>
    <Text style={[styles.label, { color: colors.foreground }]}>Property</Text>
    <View style={styles.choices}>{choice('No property selected', propertyId == null, () => setPropertyId(null))}{(properties ?? []).map(p => choice(p.address, propertyId === p.id, () => setPropertyId(p.id)))}</View>
    <Text style={[styles.label, { color: colors.foreground }]}>Service</Text>
    <View style={styles.choices}>{choice('No service selected', serviceId == null, () => setServiceId(null))}{(services ?? []).map(s => choice(s.name, serviceId === s.id, () => setServiceId(s.id)))}</View></>}
    <Text style={[styles.label, { color: colors.foreground }]}>Requested date/time</Text>
    <TextInput testID="job-request-start" value={start} onChangeText={setStart} placeholder="2026-03-15T09:00:00" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
    <Text style={[styles.label, { color: colors.foreground }]}>End date/time (optional)</Text>
    <TextInput testID="job-request-end" value={end} onChangeText={setEnd} placeholder="For a date range" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
    <Text style={[styles.label, { color: colors.foreground }]}>Notes</Text>
    <TextInput testID="job-request-notes" value={notes} onChangeText={setNotes} multiline style={[styles.input, styles.notes, { color: colors.foreground, borderColor: colors.border }]} />
    {(mutation.isError || amendMutation.isError) && <Text style={{ color: colors.destructive }}>Could not submit request. Please retry.</Text>}
    <TouchableOpacity testID="submit-job-request" disabled={(!amendId && !validStart) || mutation.isPending || amendMutation.isPending} onPress={submit} style={[styles.submit, { backgroundColor: (amendId || validStart) ? colors.primary : colors.muted }]}>
      {(mutation.isPending || amendMutation.isPending) ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{amendId ? 'Resubmit clarification' : 'Submit request'}</Text>}
    </TouchableOpacity>
  </ScrollView>;
}
const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 10, paddingBottom: 42 }, helper: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 8 }, choices: { gap: 7 },
  choice: { borderWidth: 1, borderRadius: 8, padding: 10 }, input: { borderWidth: 1, borderRadius: 8, padding: 11, fontFamily: 'Inter_400Regular', fontSize: 14 },
  notes: { minHeight: 90, textAlignVertical: 'top' }, submit: { marginTop: 10, borderRadius: 8, alignItems: 'center', padding: 14 },
});