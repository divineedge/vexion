import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { formatElapsed, getClockLocation } from '@/utils/timeTracking';

/** Contract: GET /api/visits/clock-active, POST /api/visits/:id/clock-in, POST /api/visits/:id/clock-out. */
export interface ActiveVisitClocks { entries: Array<{ visitId: number; entryId: number; clockedInAt: string }> }

export function useActiveVisitClocks(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['/api/visits/clock-active', user?.tenantId ?? null, user?.id ?? null],
    queryFn: () => customFetch<ActiveVisitClocks>('/api/visits/clock-active'),
    enabled: enabled && !!user?.id,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useVisitClockEntry(visitId: number, enabled = true) {
  const q = useActiveVisitClocks(enabled);
  return { ...q, entry: q.data?.entries.find(e => e.visitId === visitId) ?? null };
}

const errText = (e: unknown, fallback: string) => {
  const err = e as { status?: number; data?: { error?: string; message?: string } };
  if (err?.status === 403) return 'You are not assigned to this visit.';
  return err?.data?.error || err?.data?.message || fallback;
};

export function VisitClockCard({ visitId, completed, offline }: { visitId: number; completed: boolean; offline: boolean }) {
  const colors = useColors();
  const qc = useQueryClient();
  const { entry, isLoading, isError, error, refetch } = useVisitClockEntry(visitId, !offline);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!entry) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [entry]);

  const m = useMutation({
    mutationFn: async (dir: 'in' | 'out') => {
      const location = await getClockLocation();
      return customFetch(`/api/visits/${visitId}/clock-${dir}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(location ?? {}) });
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void qc.invalidateQueries({ queryKey: ['/api/visits/clock-active'] });
    },
    onError: (e, dir) => Alert.alert(`Could not clock ${dir}`, errText(e, 'Please try again.')),
  });

  const confirm = (dir: 'in' | 'out') => Alert.alert(
    dir === 'in' ? 'Start visit?' : 'Stop visit?',
    dir === 'in' ? 'Clocks you in to this visit.' : 'Clocks you out. This does not mark the visit complete.',
    [{ text: 'Cancel', style: 'cancel' }, { text: dir === 'in' ? 'Start' : 'Stop', onPress: () => m.mutate(dir) }],
  );

  const unsupported = isError && [404, 501].includes((error as { status?: number })?.status ?? 0);
  const elapsed = entry ? Math.max(0, Math.floor((now - new Date(entry.clockedInAt).getTime()) / 1000)) : 0;
  return (
    <View style={[s.card, { backgroundColor: entry ? colors.statusInProgress + '14' : colors.card, borderColor: entry ? colors.statusInProgress + '55' : colors.border }]} testID="visit-clock-card">
      <View style={{ flex: 1 }}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>TIME ON VISIT</Text>
        {offline ? <Text style={[s.value, { color: colors.mutedForeground }]}>Clock needs a connection</Text>
          : isLoading ? <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} />
          : isError ? <Text style={[s.value, { color: colors.mutedForeground }]}>{unsupported ? 'Visit clock not available yet' : 'Could not load clock'}</Text>
          : entry ? <Text style={[s.value, { color: colors.foreground }]}>{formatElapsed(elapsed)}</Text>
          : <Text style={[s.value, { color: colors.mutedForeground }]}>{completed ? 'Visit completed' : 'Not clocked in'}</Text>}
      </View>
      {isError && !unsupported && !offline ? (
        <TouchableOpacity style={[s.btn, { borderColor: colors.border, borderWidth: 1 }]} onPress={() => refetch()}><Text style={{ color: colors.foreground, fontWeight: '600' }}>Retry</Text></TouchableOpacity>
      ) : !offline && !isError && !isLoading && (entry || !completed) ? (
        <TouchableOpacity
          testID={entry ? 'button-stop-visit' : 'button-start-visit'}
          disabled={m.isPending}
          style={[s.btn, { backgroundColor: entry ? colors.destructive : colors.primary, opacity: m.isPending ? 0.6 : 1 }]}
          onPress={() => confirm(entry ? 'out' : 'in')}
        >
          {m.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <>
            <Ionicons name={entry ? 'stop' : 'play'} size={16} color={entry ? colors.destructiveForeground : colors.primaryForeground} />
            <Text style={{ color: entry ? colors.destructiveForeground : colors.primaryForeground, fontWeight: '700' }}>{entry ? 'Stop Visit' : 'Start Visit'}</Text>
          </>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  value: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minHeight: 44 },
});
