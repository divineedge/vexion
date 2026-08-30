import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGetTask } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

function parseId(value: string | string[] | undefined) {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

export default function TaskDetailScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = parseId(rawId);
  const taskQuery = useGetTask(id ?? 0, {
    query: { enabled: !!user && id !== null, queryKey: ['field-task', user?.tenantId, user?.id, id] },
  });

  if (id === null) return <State text="This task link is invalid." colors={colors} />;
  if (taskQuery.isLoading) return <State loading text="Loading task…" colors={colors} />;
  if (taskQuery.isError) return <State text="This task is unavailable or you no longer have access." colors={colors} />;
  if (!taskQuery.data) return <State text="Task not found." colors={colors} />;

  const task = taskQuery.data;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{task.title}</Text>
        <Detail label="Status" value={task.status} colors={colors} />
        <Detail label="Priority" value={task.priority} colors={colors} />
        <Detail label="Assigned to" value={task.assignedToName || 'Unassigned'} colors={colors} />
        <Detail label="Due" value={task.dueDate ? new Date(task.dueDate).toLocaleString() : 'No due date'} colors={colors} />
        {task.description ? <Detail label="Description" value={task.description} colors={colors} /> : null}
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