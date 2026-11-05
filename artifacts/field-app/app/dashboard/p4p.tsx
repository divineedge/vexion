import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { DemoCard, DemoFrame } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { hours, money } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { crewEfficiency, earnedP4p } from '@/utils/demoSandbox';

export default function P4pScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  if (!sandbox) return <DemoFrame title="P4P"><Text style={{ color: colors.mutedForeground }}>Loading sandbox…</Text></DemoFrame>;
  const gross = sandbox.jobs.reduce((sum, job) => sum + job.revenue, 0);
  const budget = sandbox.jobs.reduce((sum, job) => sum + job.budgetMinutes, 0);
  const actual = sandbox.jobs.reduce((sum, job) => sum + job.actualMinutes, 0);
  const earned = earnedP4p(sandbox.jobs);

  return (
    <DemoFrame title="P4P">
      <View style={styles.metrics}>
        <Metric label="Gross revenue" value={money(gross)} />
        <Metric label="Budget hours" value={hours(budget)} />
        <Metric label="Actual hours" value={hours(actual)} />
        <Metric label="Earned P4P" value={money(earned)} />
      </View>
      {sandbox.crews.map(crew => {
        const jobs = sandbox.jobs.filter(job => job.crewId === crew.id && job.actualMinutes > 0);
        const efficiency = crewEfficiency(sandbox.jobs, crew.id);
        const crewBudget = jobs.reduce((sum, job) => sum + job.budgetMinutes, 0);
        const crewActual = jobs.reduce((sum, job) => sum + job.actualMinutes, 0);
        const crewRevenue = sandbox.jobs.filter(job => job.crewId === crew.id).reduce((sum, job) => sum + job.revenue, 0);
        const crewP4p = earnedP4p(sandbox.jobs.filter(job => job.crewId === crew.id));
        return (
          <DemoCard key={crew.id}>
            <Text style={[styles.title, { color: colors.foreground }]}>{crew.name} · {crew.focus}</Text>
            <Text style={[styles.efficiency, { color: efficiency >= 100 ? colors.statusCompleted : colors.statusInProgress }]}>{efficiency}% efficiency</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Budget {hours(crewBudget)} · Actual {hours(crewActual)} · Revenue {money(crewRevenue)}</Text>
            <Text style={[styles.meta, { color: colors.foreground }]}>Earned P4P wages {money(crewP4p)}</Text>
            {sandbox.employees.filter(employee => employee.crewId === crew.id).map(employee => {
              const shareHours = crewActual / Math.max(crew.members.length, 1) / 60;
              const shareP4p = crewP4p / Math.max(crew.members.length, 1);
              return (
                <View key={employee.id} style={[styles.employee, { borderColor: colors.border }]}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{employee.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{employee.role} · {money(employee.hourlyRate)}/h</Text>
                  <Text style={[styles.meta, { color: colors.foreground }]}>Worked {shareHours.toFixed(1)} h · Base {money(shareHours * employee.hourlyRate)} · P4P {money(shareP4p)}</Text>
                </View>
              );
            })}
          </DemoCard>
        );
      })}
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
  title: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  efficiency: { fontFamily: 'Inter_700Bold', fontSize: 28, marginTop: 4 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  employee: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
});
