import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { DemoCard, DemoFrame, StatusPill } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { clock, jobStatusLabel, money } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { propertyById, updateDemoSandbox, type JobStatus } from '@/utils/demoSandbox';

const STATUSES: JobStatus[] = ['scheduled', 'en_route', 'in_progress', 'completed'];

function tone(status: JobStatus): 'good' | 'warn' | 'info' | 'muted' {
  if (status === 'completed') return 'good';
  if (status === 'in_progress') return 'warn';
  if (status === 'en_route') return 'info';
  return 'muted';
}

export default function DispatchScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  const todayKey = sandbox ? new Intl.DateTimeFormat('en-CA', { timeZone: sandbox.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sandbox.seededAt)) : '';

  return (
    <DemoFrame title="Dispatch">
      {sandbox?.crews.map(crew => {
        const jobs = sandbox.jobs
          .filter(job => job.crewId === crew.id && job.scheduledAt.slice(0, 10) >= todayKey)
          .sort((a, b) => a.sequence - b.sequence);
        return (
          <View key={crew.id}>
            <Text style={[styles.crew, { color: colors.foreground }]}>{crew.name} · {crew.focus}</Text>
            <Text style={[styles.members, { color: colors.mutedForeground }]}>{crew.members.join(' · ')}</Text>
            {jobs.map(job => {
              const property = propertyById(sandbox, job.propertyId);
              const customer = sandbox.customers.find(item => item.id === job.customerId);
              return (
                <DemoCard key={job.id}>
                  <View style={styles.row}>
                    <StatusPill label={jobStatusLabel[job.status]} tone={tone(job.status)} />
                    <Text style={[styles.revenue, { color: colors.foreground }]}>{money(job.revenue)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => router.push(`/dashboard/jobs/${job.id}`)} testID={`dispatch-job-${job.id}`}>
                    <Text style={[styles.title, { color: colors.foreground }]}>{job.title}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{customer?.name} · {property?.address}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Clock in {clock(job.clockIn)} · Break {job.breaks[0] ? `${clock(job.breaks[0].start)}–${clock(job.breaks[0].end)}` : '—'} · Clock out {clock(job.clockOut)}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.statuses}>
                    {STATUSES.map(status => (
                      <TouchableOpacity
                        key={status}
                        onPress={() => updateDemoSandbox(current => ({
                          ...current,
                          jobs: current.jobs.map(item => item.id === job.id ? { ...item, status } : item),
                        }))}
                        style={[styles.statusButton, { borderColor: job.status === status ? colors.primary : colors.border }]}
                        testID={`status-${job.id}-${status}`}
                      >
                        <Text style={{ color: job.status === status ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 11 }}>{jobStatusLabel[status]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </DemoCard>
              );
            })}
          </View>
        );
      })}
    </DemoFrame>
  );
}

const styles = StyleSheet.create({
  crew: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  members: { fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  revenue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 8 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statusButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
});
