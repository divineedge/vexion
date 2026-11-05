import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { DemoCard, DemoFrame, StatusPill } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { clock, invoiceStatusLabel, jobStatusLabel, money, sqft } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { customerById, invoiceAmount, propertyById, type InvoiceStatus, type JobStatus } from '@/utils/demoSandbox';

function jobTone(status: JobStatus): 'good' | 'warn' | 'info' | 'muted' {
  if (status === 'completed') return 'good';
  if (status === 'in_progress') return 'warn';
  if (status === 'en_route') return 'info';
  return 'muted';
}

function invoiceTone(status: InvoiceStatus): 'good' | 'warn' | 'bad' {
  if (status === 'paid') return 'good';
  if (status === 'pending') return 'warn';
  return 'bad';
}

export default function CustomerDetailScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const sandbox = useDemoSandbox();
  const customer = sandbox ? customerById(sandbox, Number(params.id)) : null;
  if (!sandbox || !customer) {
    return <DemoFrame title="Customer"><Text style={{ color: colors.mutedForeground }}>Customer not in the sandbox.</Text></DemoFrame>;
  }
  const properties = sandbox.properties.filter(property => property.customerId === customer.id);
  const jobs = sandbox.jobs.filter(job => job.customerId === customer.id);
  const invoices = sandbox.invoices.filter(invoice => invoice.customerId === customer.id);
  const estimates = sandbox.estimates.filter(estimate => estimate.customerId === customer.id);

  return (
    <DemoFrame title={customer.name}>
      <DemoCard>
        <Text style={[styles.heading, { color: colors.foreground }]}>Primary contact</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{customer.primaryContact.name}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{customer.primaryContact.phone}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{customer.primaryContact.email}</Text>
      </DemoCard>
      {properties.map(property => (
        <DemoCard key={property.id}>
          <Text style={[styles.heading, { color: colors.foreground }]}>{property.name}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>{property.address}, {property.city}</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>Gate code {property.gateCode} · {sqft(property.sqft)}</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>Lawn: {property.lawnCondition}</Text>
        </DemoCard>
      ))}
      <Text style={[styles.section, { color: colors.foreground }]}>Jobs</Text>
      {jobs.map(job => {
        const property = propertyById(sandbox, job.propertyId);
        return (
          <DemoCard key={job.id}>
            <StatusPill label={jobStatusLabel[job.status]} tone={jobTone(job.status)} />
            <Text style={[styles.heading, { color: colors.foreground }]}>{job.title}</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{property?.address} · {clock(job.scheduledAt)} · {money(job.revenue)}</Text>
          </DemoCard>
        );
      })}
      <Text style={[styles.section, { color: colors.foreground }]}>Invoices and estimates</Text>
      {invoices.map(invoice => (
        <DemoCard key={invoice.id}>
          <StatusPill label={invoiceStatusLabel[invoice.status]} tone={invoiceTone(invoice.status)} />
          <Text style={[styles.heading, { color: colors.foreground }]}>{invoice.number} · {money(invoiceAmount(invoice))}</Text>
        </DemoCard>
      ))}
      {estimates.map(estimate => (
        <DemoCard key={estimate.id}>
          <StatusPill label={estimate.status === 'approved' ? 'Approved' : 'Pending approval'} tone={estimate.status === 'approved' ? 'good' : 'warn'} />
          <Text style={[styles.heading, { color: colors.foreground }]}>{estimate.number} · {estimate.title}</Text>
        </DemoCard>
      ))}
    </DemoFrame>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 6 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 4 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 4 },
});
