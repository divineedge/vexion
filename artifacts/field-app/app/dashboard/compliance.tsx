import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { DemoCard, DemoFrame } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { clock } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { customerById, propertyById } from '@/utils/demoSandbox';

export default function ComplianceScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  return (
    <DemoFrame title="Compliance">
      {sandbox?.chemicalLogs.map(log => {
        const job = sandbox.jobs.find(item => item.id === log.jobId);
        const customer = job ? customerById(sandbox, job.customerId) : null;
        const property = job ? propertyById(sandbox, job.propertyId) : null;
        return (
          <TouchableOpacity key={log.id} onPress={() => router.push(`/dashboard/jobs/${log.jobId}`)} testID={`chemical-log-${log.id}`}>
            <DemoCard>
              <Text style={[styles.product, { color: colors.foreground }]}>{log.product}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{customer?.name} · {property?.address} · {clock(log.appliedAt)}</Text>
              <Text style={[styles.meta, { color: colors.foreground }]}>EPA {log.epaNumber}</Text>
              <Text style={[styles.meta, { color: colors.foreground }]}>Target pest: {log.targetPest}</Text>
              <Text style={[styles.meta, { color: colors.foreground }]}>Wind {log.windMph} mph · Temperature {log.tempF}°F</Text>
              <Text style={[styles.meta, { color: colors.foreground }]}>Rate {log.rate}</Text>
              <Text style={[styles.signature, { color: colors.primary }]}>{log.signature}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Technician signature · {log.technician}</Text>
            </DemoCard>
          </TouchableOpacity>
        );
      })}
    </DemoFrame>
  );
}

const styles = StyleSheet.create({
  product: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 4 },
  signature: { fontFamily: 'Inter_600SemiBold', fontSize: 20, fontStyle: 'italic', marginTop: 10 },
});
