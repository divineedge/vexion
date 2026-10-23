import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useListEquipment } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Equipment = {
  id: number;
  name: string;
  type: string;
  currentHours: number;
  currentMiles?: number | null;
  costPerHour?: number | null;
  isActive: boolean;
  maintenanceDue: boolean;
  hoursUntilService?: number | null;
  milesUntilService?: number | null;
};

function typeIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'truck':
    case 'vehicle':
      return 'car-outline';
    case 'mower':
      return 'leaf-outline';
    default:
      return 'construct-outline';
  }
}

function EquipmentCard({
  item,
  onPress,
  colors,
}: {
  item: Equipment;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isOverdue = item.maintenanceDue;
  const hoursRemaining = item.hoursUntilService;
  const milesRemaining = item.milesUntilService;

  // Near-due: within 10 hours or 50 miles
  const isNearDueHours = !isOverdue && hoursRemaining != null && hoursRemaining <= 10;
  const isNearDueMiles = !isOverdue && milesRemaining != null && milesRemaining <= 50;
  const isNearDue = isNearDueHours || isNearDueMiles;
  const showWarning = isOverdue || isNearDue;

  const warningColor = isOverdue ? '#ef4444' : '#f59e0b';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: showWarning ? warningColor : colors.border },
        showWarning && { borderWidth: 1.5 },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      testID={`equipment-card-${item.id}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '18' }]}>
        <Ionicons name={typeIcon(item.type)} size={20} color={colors.primary} />
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {item.currentHours.toLocaleString()} hrs
          {item.costPerHour != null ? `  ·  $${item.costPerHour.toFixed(2)}/hr` : ''}
        </Text>
        {showWarning && (
          <View style={styles.warningRow}>
            <Ionicons name="warning-outline" size={12} color={warningColor} />
            <Text style={[styles.warningText, { color: warningColor }]}>
              {isOverdue
                ? 'Maintenance overdue'
                : hoursRemaining != null && isNearDueHours
                ? `Service due in ${Math.ceil(hoursRemaining)} hrs`
                : milesRemaining != null
                ? `Service due in ${Math.ceil(milesRemaining)} mi`
                : 'Service due soon'}
            </Text>
          </View>
        )}
      </View>
      {showWarning ? (
        <Ionicons name="warning" size={18} color={warningColor} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      )}
    </TouchableOpacity>
  );
}

export default function EquipmentListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // When jobId is present, selecting equipment goes straight to the fuel-fill form
  // with the job pre-selected (called from the job detail "Log Fuel Fill" button).
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();

  const { data, isLoading, isError, refetch, isFetching } = useListEquipment();
  const equipment = ((data as Equipment[] | undefined) ?? []).filter((e) => e.isActive);

  const handlePress = useCallback(async (id: number) => {
    await Haptics.selectionAsync();
    if (jobId) {
      router.push(`/(app)/equipment-fuel/${id}?jobId=${jobId}` as any);
    } else {
      router.push(`/(app)/equipment/${id}`);
    }
  }, [jobId]);

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isError ? (
        <View style={styles.centered}>
          <Ionicons name="wifi-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load equipment</Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={equipment}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <EquipmentCard item={item} onPress={() => handlePress(item.id)} colors={colors} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad },
            equipment.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={equipment.length > 0}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => { void refetch(); }} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="construct-outline" size={52} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No equipment yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Equipment added by the office will show up here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  listEmpty: { flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 4 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  warningText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
