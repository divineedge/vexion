import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DemoCard, DemoFrame } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { hours, money } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { crewEfficiency, earnedP4p, financialSummary } from '@/utils/demoSandbox';

export default function DemoOverview() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  const summary = useMemo(() => sandbox ? financialSummary(sandbox) : null, [sandbox]);
  if (!sandbox || !summary) {
    return <DemoFrame title="Overview"><Text style={{ color: colors.mutedForeground }}>Loading sandbox…</Text></DemoFrame>;
  }
  const statusCounts = ['completed', 'in_progress', 'en_route', 'scheduled'].map(status => ({
    label: status.replace('_', ' '),
    value: sandbox.jobs.filter(job => job.status === status).length,
  }));
  const maxStatus = Math.max(...statusCounts.map(row => row.value), 1);
  const crewBars = sandbox.crews.map(crew => ({ crew, efficiency: crewEfficiency(sandbox.jobs, crew.id) }));

  return (
    <DemoFrame title="Overview">
      <View style={styles.metrics}>
        <Metric label="Gross revenue" value={money(summary.revenue)} />
        <Metric label="Open AR" value={money(summary.pending + summary.past_due)} />
        <Metric label="Earned P4P" value={money(summary.p4p)} />
        <Metric label="Month profit" value={money(summary.profit)} />
      </View>
      <DemoCard>
        <Text style={[styles.heading, { color: colors.foreground }]}>Today’s job mix</Text>
        {statusCounts.map(row => (
          <View key={row.label} style={styles.barRow}>
            <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
            <View style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${(row.value / maxStatus) * 100}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.barValue, { color: colors.foreground }]}>{row.value}</Text>
          </View>
        ))}
      </DemoCard>
      <DemoCard>
        <Text style={[styles.heading, { color: colors.foreground }]}>Crew efficiency</Text>
        {crewBars.map(({ crew, efficiency }) => (
          <View key={crew.id} style={styles.barRow}>
            <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{crew.name}</Text>
            <View style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${Math.min(efficiency, 140) / 140 * 100}%`, backgroundColor: efficiency >= 100 ? colors.statusCompleted : colors.statusInProgress }]} />
            </View>
            <Text style={[styles.barValue, { color: colors.foreground }]}>{efficiency}%</Text>
          </View>
        ))}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Crew A is budgeted {hours(sandbox.jobs.filter(job => job.crewId === 'crew-a' && job.actualMinutes > 0).reduce((sum, job) => sum + job.budgetMinutes, 0))} against {hours(sandbox.jobs.filter(job => job.crewId === 'crew-a' && job.actualMinutes > 0).reduce((sum, job) => sum + job.actualMinutes, 0))} worked, a 115% rating. Earned P4P is {money(earnedP4p(sandbox.jobs))}.
        </Text>
      </DemoCard>
    </DemoFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[styles.metric, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metric: { width: '48%', borderWidth: 1, borderRadius: 12, padding: 12 },
  metricLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 4 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  barLabel: { width: 88, fontFamily: 'Inter_500Medium', fontSize: 12, textTransform: 'capitalize' },
  track: { flex: 1, height: 8, borderRadius: 99, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 99 },
  barValue: { width: 36, textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 6 },
});
