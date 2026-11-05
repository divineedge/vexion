import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { DemoCard, DemoFrame, StatusPill } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { estimateStatusLabel, invoiceStatusLabel, money } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { customerById, financialSummary, invoiceAmount, lineTotal, updateDemoSandbox, type InvoiceStatus } from '@/utils/demoSandbox';

function tone(status: InvoiceStatus): 'good' | 'warn' | 'bad' {
  if (status === 'paid') return 'good';
  if (status === 'pending') return 'warn';
  return 'bad';
}

export default function FinancialsScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  if (!sandbox) return <DemoFrame title="Financials"><Text style={{ color: colors.mutedForeground }}>Loading sandbox…</Text></DemoFrame>;
  const summary = financialSummary(sandbox);
  const bars = [
    { label: 'Paid', value: summary.paid, color: colors.statusCompleted },
    { label: 'Pending', value: summary.pending, color: colors.statusInProgress },
    { label: 'Past due', value: summary.past_due, color: colors.destructive },
  ];
  const max = Math.max(...bars.map(bar => bar.value), 1);

  return (
    <DemoFrame title="Financials">
      <DemoCard>
        <Text style={[styles.heading, { color: colors.foreground }]}>End-of-month revenue</Text>
        {bars.map(bar => (
          <View key={bar.label} style={styles.barRow}>
            <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{bar.label}</Text>
            <View style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${(bar.value / max) * 100}%`, backgroundColor: bar.color }]} />
            </View>
            <Text style={[styles.barValue, { color: colors.foreground }]}>{money(bar.value)}</Text>
          </View>
        ))}
      </DemoCard>
      <DemoCard>
        <Text style={[styles.heading, { color: colors.foreground }]}>Profit and loss</Text>
        <Line label="Paid revenue" value={money(summary.revenue)} />
        <Line label="Labor" value={money(summary.labor)} />
        <Line label="Materials" value={money(summary.materials)} />
        <Line label="P4P wages" value={money(summary.p4p)} />
        <Line label="Profit" value={money(summary.profit)} strong />
      </DemoCard>
      <Text style={[styles.section, { color: colors.foreground }]}>Invoices</Text>
      {sandbox.invoices.map(invoice => (
        <DemoCard key={invoice.id}>
          <View style={styles.row}>
            <Text style={[styles.heading, { color: colors.foreground }]}>{invoice.number}</Text>
            <StatusPill label={invoiceStatusLabel[invoice.status]} tone={tone(invoice.status)} />
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{customerById(sandbox, invoice.customerId)?.name} · Due {invoice.dueOn}</Text>
          {invoice.lines.map(line => (
            <Text key={line.description} style={[styles.meta, { color: colors.foreground }]}>{line.qty} × {line.description} · {money(line.qty * line.unitPrice)}</Text>
          ))}
          <Text style={[styles.total, { color: colors.foreground }]}>{money(invoiceAmount(invoice))}</Text>
          {invoice.status !== 'paid' ? (
            <TouchableOpacity
              onPress={() => updateDemoSandbox(current => ({
                ...current,
                invoices: current.invoices.map(item => item.id === invoice.id ? { ...item, status: 'paid' } : item),
              }))}
              testID={`pay-invoice-${invoice.id}`}
            >
              <Text style={[styles.action, { color: colors.primary }]}>Mark paid</Text>
            </TouchableOpacity>
          ) : null}
        </DemoCard>
      ))}
      <Text style={[styles.section, { color: colors.foreground }]}>Estimates</Text>
      {sandbox.estimates.map(estimate => (
        <DemoCard key={estimate.id}>
          <View style={styles.row}>
            <Text style={[styles.heading, { color: colors.foreground }]}>{estimate.number}</Text>
            <StatusPill label={estimateStatusLabel[estimate.status]} tone={estimate.status === 'approved' ? 'good' : 'warn'} />
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{estimate.title} · {customerById(sandbox, estimate.customerId)?.name}</Text>
          {estimate.lines.map(line => (
            <Text key={line.description} style={[styles.meta, { color: colors.foreground }]}>{line.description} · {money(line.qty * line.unitPrice)}</Text>
          ))}
          <Text style={[styles.total, { color: colors.foreground }]}>{money(lineTotal(estimate.lines))}</Text>
          {estimate.status === 'pending_approval' ? (
            <TouchableOpacity
              onPress={() => updateDemoSandbox(current => ({
                ...current,
                estimates: current.estimates.map(item => item.id === estimate.id ? { ...item, status: 'approved' } : item),
              }))}
              testID={`approve-estimate-${estimate.id}`}
            >
              <Text style={[styles.action, { color: colors.primary }]}>Approve</Text>
            </TouchableOpacity>
          ) : null}
        </DemoCard>
      ))}
    </DemoFrame>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={{ color: colors.mutedForeground, fontFamily: strong ? 'Inter_700Bold' : 'Inter_400Regular' }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 4, marginBottom: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  barLabel: { width: 70, fontFamily: 'Inter_500Medium', fontSize: 12 },
  track: { flex: 1, height: 8, borderRadius: 99, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 99 },
  barValue: { width: 84, textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  total: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 8 },
  action: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 8 },
});
