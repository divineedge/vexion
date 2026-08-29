import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useListJobRequests } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function MyRequests() {
  const colors = useColors();
  const { data, isLoading, refetch, isFetching } = useListJobRequests();
  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  return <FlatList data={data ?? []} refreshing={isFetching} onRefresh={refetch} keyExtractor={r => String(r.id)} contentContainerStyle={styles.list}
    ListEmptyComponent={<View style={styles.center}><Text style={{ color: colors.mutedForeground }}>No job requests yet.</Text></View>}
    renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}><Text style={[styles.title, { color: colors.foreground }]}>{item.serviceName ?? 'Job request'}</Text><Text style={{ color: colors.primary, textTransform: 'capitalize' }}>{item.status.replace('_', ' ')}</Text></View>
      <Text style={{ color: colors.mutedForeground }}>{item.customerName ?? 'No customer'}{item.propertyAddress ? ` · ${item.propertyAddress}` : ''}</Text>
      <Text style={{ color: colors.mutedForeground }}>{new Date(item.requestedStartDate).toLocaleString()}{item.requestedEndDate ? ` – ${new Date(item.requestedEndDate).toLocaleString()}` : ''}</Text>
      {item.adminResponse ? <Text style={[styles.response, { color: colors.foreground }]}>Manager response: {item.adminResponse}</Text> : null}
      {item.approvedJobId ? <TouchableOpacity onPress={() => router.push(`/(app)/job/${item.approvedJobId}`)}><Text style={{ color: colors.primary }}>View approved job →</Text></TouchableOpacity> : null}
      {item.status === 'clarification_requested' ? <TouchableOpacity testID={`amend-job-request-${item.id}`} onPress={() => router.push({ pathname: '/(app)/job-request', params: { amendId: String(item.id), notes: item.notes ?? '' } })}><Text style={{ color: colors.primary }}>Provide clarification →</Text></TouchableOpacity> : null}
    </View>} />;
}
const styles = StyleSheet.create({ list: { padding: 16, gap: 10 }, card: { borderWidth: 1, borderRadius: 10, padding: 13, gap: 7 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, title: { fontFamily: 'Inter_600SemiBold', flex: 1 }, response: { fontFamily: 'Inter_500Medium', marginTop: 3 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 } });