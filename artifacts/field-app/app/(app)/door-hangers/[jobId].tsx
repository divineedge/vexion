import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Share } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { getClockLocation } from '@/utils/timeTracking';

type Visit = {
  id: number;
  address: string;
  lat?: number | null;
  lng?: number | null;
  visitDate?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  shareUrl?: string | null;
  jobId?: number | null;
  convertedCustomerId?: number | null;
  convertedCustomerName?: string | null;
  converted?: boolean | null;
};

function normalizeVisits(raw: unknown): Visit[] {
  if (Array.isArray(raw)) return raw as Visit[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['visits', 'doorHangers', 'items', 'records']) if (Array.isArray(o[k])) return o[k] as Visit[];
  }
  return [];
}

function errorStatus(e: unknown): number | null {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : null;
}
function errorText(e: unknown): string {
  const status = errorStatus(e);
  if (status === 409) return 'Door hanger program is turned off for your company right now. Ask the office to enable it.';
  if (status === 403) return 'You can only record door hangers on jobs you are assigned to.';
  const data = (e as { data?: { error?: string; message?: string } })?.data;
  return data?.error || data?.message || (e as Error)?.message || 'Something went wrong. Try again.';
}

function parseCoord(v: string, max: number): number | null | 'invalid' {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : 'invalid';
}

export default function DoorHangersScreen() {
  const { jobId: jobIdParam } = useLocalSearchParams<{ jobId: string }>();
  const jobId = Number(jobIdParam);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const queryKey = ['door-hangers', jobId];

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locating, setLocating] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const list = useQuery({
    queryKey,
    enabled: Number.isFinite(jobId) && jobId > 0,
    queryFn: () => customFetch<unknown>(`/api/marketing/door-hangers?jobId=${jobId}`),
  });
  const visits = normalizeVisits(list.data);
  const disabled409 = errorStatus(list.error) === 409;

  const save = useMutation({
    mutationFn: (body: { jobId: number; address: string; lat?: number; lng?: number }) =>
      customFetch<unknown>('/api/marketing/door-hangers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_d, body) => {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setLastSaved(body.address);
      setAddress(''); setLat(''); setLng(''); setPinNote(null); setFormError(null);
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => setFormError(errorText(e)),
  });

  const usePhoneLocation = async () => {
    setLocating(true); setPinNote(null);
    try {
      const loc = await getClockLocation();
      if (!loc) { setPinNote('Location unavailable or permission denied. You can still save with just the address.'); return; }
      setLat(loc.lat.toFixed(6)); setLng(loc.lng.toFixed(6));
      setPinNote('Pin set from your current position. Only use this while standing at this house.');
    } finally { setLocating(false); }
  };

  const submit = () => {
    setFormError(null);
    const a = address.trim();
    if (!a) { setFormError('Enter the house address.'); return; }
    const la = parseCoord(lat, 90), ln = parseCoord(lng, 180);
    if (la === 'invalid' || ln === 'invalid') { setFormError('Latitude/longitude must be valid numbers.'); return; }
    if ((la == null) !== (ln == null)) { setFormError('Enter both latitude and longitude, or leave both blank.'); return; }
    save.mutate({ jobId, address: a, ...(la != null && ln != null ? { lat: la, lng: ln } : {}) });
  };

  const fmt = (v: Visit) => {
    const s = v.completedAt || v.visitDate || v.createdAt;
    return s ? new Date(s).toLocaleDateString() : '';
  };

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.mutedForeground }}>Open this from a job.</Text></View>;
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Record each nearby house you leave a door hanger at for job #{jobId}. You and today’s date are recorded automatically.
      </Text>

      {disabled409 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="door-hangers-disabled">
          <Ionicons name="pause-circle-outline" size={22} color={colors.mutedForeground} />
          <Text style={[styles.body, { color: colors.foreground }]}>{errorText(list.error)}</Text>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>House address</Text>
          <TextInput
            testID="door-hanger-address"
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. 412 Maple Ridge Dr"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={submit}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 6 }]}>Map pin (optional)</Text>
          <View style={styles.row}>
            <TextInput testID="door-hanger-lat" value={lat} onChangeText={setLat} placeholder="Latitude" keyboardType="numbers-and-punctuation" placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.flex, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
            <TextInput testID="door-hanger-lng" value={lng} onChangeText={setLng} placeholder="Longitude" keyboardType="numbers-and-punctuation" placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.flex, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
          </View>
          <TouchableOpacity testID="door-hanger-use-location" onPress={usePhoneLocation} disabled={locating} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
            {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate-outline" size={16} color={colors.primary} />}
            <Text style={[styles.secondaryText, { color: colors.primary }]}>I’m at this house — use my location</Text>
          </TouchableOpacity>
          {pinNote && <Text style={[styles.small, { color: colors.mutedForeground }]}>{pinNote}</Text>}
          {formError && <Text style={[styles.small, { color: '#c2410c' }]} testID="door-hanger-error">{formError}</Text>}
          {lastSaved && !formError && <Text style={[styles.small, { color: colors.primary }]}>Saved {lastSaved}. Ready for the next house.</Text>}

          <TouchableOpacity testID="door-hanger-save" onPress={submit} disabled={save.isPending} style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: save.isPending ? 0.6 : 1 }]}>
            {save.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>Save house</Text>}
          </TouchableOpacity>
        </View>
      )}

      <Text style={[styles.section, { color: colors.foreground }]}>Houses recorded</Text>
      <Text style={[styles.small, { color: colors.mutedForeground }]}>Share a house’s link so its signup is credited to that house and to you.</Text>
      {list.isLoading ? <ActivityIndicator color={colors.primary} /> :
        list.isError && !disabled409 ? (
          <TouchableOpacity onPress={() => list.refetch()} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.body, { color: colors.foreground }]}>{errorText(list.error)} Tap to retry.</Text>
          </TouchableOpacity>
        ) : visits.length === 0 ? (
          <Text style={[styles.small, { color: colors.mutedForeground }]}>No houses recorded yet.</Text>
        ) : visits.map(v => {
          const converted = !!(v.convertedCustomerId || v.converted);
          return (
            <View key={v.id} testID={`door-hanger-row-${v.id}`} style={[styles.visit, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name={v.lat != null && v.lng != null ? 'location' : 'home-outline'} size={18} color={colors.mutedForeground} />
              <View style={styles.flex}>
                <Text style={[styles.body, { color: colors.foreground }]}>{v.address}</Text>
                <Text style={[styles.small, { color: colors.mutedForeground }]}>{fmt(v)}{v.jobId === jobId ? ' · this job' : ''}</Text>
              </View>
              {!!v.shareUrl && (
                <TouchableOpacity testID={`door-hanger-share-${v.id}`} accessibilityLabel="Share this house's signup link"
                  onPress={() => { Share.share({ message: v.shareUrl!, url: v.shareUrl! }).catch(() => {}); }}
                  style={[styles.iconBtn, { borderColor: colors.border }]}>
                  <Ionicons name="share-outline" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
              {converted && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{v.convertedCustomerName ? `Customer: ${v.convertedCustomerName}` : 'Converted'}</Text>
                </View>
              )}
            </View>
          );
        })}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 15 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, justifyContent: 'center' },
  secondaryText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  body: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  section: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  iconBtn: { borderWidth: 1, borderRadius: 8, padding: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 140 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
