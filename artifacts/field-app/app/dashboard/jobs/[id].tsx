import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { DemoCard, DemoFrame, StatusPill } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { clock, hours, jobStatusLabel, money } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { customerById, propertyById, type JobStatus } from '@/utils/demoSandbox';

function tone(status: JobStatus): 'good' | 'warn' | 'info' | 'muted' {
  if (status === 'completed') return 'good';
  if (status === 'in_progress') return 'warn';
  if (status === 'en_route') return 'info';
  return 'muted';
}

export default function DemoJobScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const sandbox = useDemoSandbox();
  const job = sandbox?.jobs.find(item => item.id === Number(params.id));
  if (!sandbox || !job) {
    return <DemoFrame title="Job"><Text style={{ color: colors.mutedForeground }}>Job not in the sandbox.</Text></DemoFrame>;
  }
  const customer = customerById(sandbox, job.customerId);
  const property = propertyById(sandbox, job.propertyId);
  const logs = sandbox.chemicalLogs.filter(log => log.jobId === job.id);
  return (
    <DemoFrame title={job.title}>
      <DemoCard>
        <StatusPill label={jobStatusLabel[job.status]} tone={tone(job.status)} />
        <Text style={[styles.body, { color: colors.foreground }]}>{customer?.name} · {property?.address}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Gate {property?.gateCode} · {property?.lawnCondition}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>Budget {hours(job.budgetMinutes)} · Actual {hours(job.actualMinutes)} · {money(job.revenue)}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>Clock in {clock(job.clockIn)} · Clock out {clock(job.clockOut)}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Breaks: {job.breaks.length ? job.breaks.map(item => `${clock(item.start)}–${clock(item.end)}`).join(', ') : 'None'}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Technician {job.technician}</Text>
      </DemoCard>
      {logs.map(log => (
        <DemoCard key={log.id}>
          <Text style={[styles.heading, { color: colors.foreground }]}>{log.product}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>EPA {log.epaNumber} · {log.targetPest}</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>Wind {log.windMph} mph · {log.tempF}°F · {log.rate}</Text>
          <Text style={[styles.signature, { color: colors.primary }]}>{log.signature}</Text>
        </DemoCard>
      ))}
    </DemoFrame>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 6 },
  signature: { fontFamily: 'Inter_600SemiBold', fontSize: 18, fontStyle: 'italic', marginTop: 8 },
});
