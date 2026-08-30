import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGetVisit } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

function parseId(value: string | string[] | undefined) {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

export default function VisitDetailScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = parseId(rawId);
  // Include the authenticated identity in the cache key: never render a
  // previous staff member's cached detail while authorization is rechecked.
  const visitQuery = useGetVisit(id ?? 0, {
    query: { enabled: !!user && id !== null, queryKey: ['field-visit', user?.tenantId, user?.id, id] },
  });

  if (id === null) return <State text="This visit link is invalid." colors={colors} />;
  if (visitQuery.isLoading) return <State loading text="Loading visit…" colors={colors} />;
  if (visitQuery.isError) return <State text="This visit is unavailable or you no longer have access." colors={colors} />;
  if (!visitQuery.data) return <State text="Visit not found." colors={colors} />;

  const visit = visitQuery.data;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{visit.purpose}</Text>
        <Detail label="Scheduled" value={visit.scheduledAt ? new Date(visit.scheduledAt).toLocaleString() : 'Not scheduled'} colors={colors} />
        <Detail label="Address" value={visit.propertyAddress || 'No property address'} colors={colors} />
        <Detail label="Customer" value={visit.customerName || 'Not assigned'} colors={colors} />
        <Detail label="Assigned to" value={visit.assigneeName || 'Unassigned'} colors={colors} />
        <Detail label="Mode" value={visit.visitMode.replaceAll('_', ' ')} colors={colors} />
        {visit.notes ? <Detail label="Notes" value={visit.notes} colors={colors} /> : null}
      </View>
    </ScrollView>
  );
}

function Detail({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.row}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.value, { color: colors.foreground }]}>{value}</Text></View>;
}
function State({ text, loading, colors }: { text: string; loading?: boolean; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.state, { backgroundColor: colors.background }]}>{loading ? <ActivityIndicator color={colors.primary} /> : null}<Text style={{ color: colors.mutedForeground }}>{text}</Text></View>;
}
const styles = StyleSheet.create({
  content: { padding: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 14 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  row: { gap: 3 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  value: { fontFamily: 'Inter_400Regular', fontSize: 15, textTransform: 'capitalize' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
});