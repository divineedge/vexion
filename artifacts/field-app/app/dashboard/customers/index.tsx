import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { DemoCard, DemoFrame } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { sqft } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { propertyById } from '@/utils/demoSandbox';

const kindLabel = { residential: 'Residential', hoa: 'HOA', commercial: 'Commercial' };

export default function CustomersScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  return (
    <DemoFrame title="Customers">
      {sandbox?.customers.map(customer => {
        const properties = customer.propertyIds.map(id => propertyById(sandbox, id)).filter(Boolean);
        return (
          <TouchableOpacity key={customer.id} onPress={() => router.push(`/dashboard/customers/${customer.id}`)} testID={`customer-${customer.id}`}>
            <DemoCard>
              <Text style={[styles.kind, { color: colors.primary }]}>{kindLabel[customer.kind]}</Text>
              <Text style={[styles.name, { color: colors.foreground }]}>{customer.name}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{customer.primaryContact.name} · {customer.primaryContact.phone}</Text>
              {properties.map(property => (
                <Text key={property!.id} style={[styles.meta, { color: colors.foreground }]}>
                  {property!.address} · {sqft(property!.sqft)} · Gate {property!.gateCode}
                </Text>
              ))}
            </DemoCard>
          </TouchableOpacity>
        );
      })}
    </DemoFrame>
  );
}

const styles = StyleSheet.create({
  kind: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'uppercase' },
  name: { fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 4 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
});
