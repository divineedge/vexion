import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { clearAccountFreeDemo, hasAccountFreeDemo } from '@/utils/demoAccess';

const SECTIONS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/dispatch', label: 'Dispatch' },
  { href: '/dashboard/routes', label: 'Routes' },
  { href: '/dashboard/p4p', label: 'P4P' },
  { href: '/dashboard/financials', label: 'Financials' },
  { href: '/dashboard/compliance', label: 'Compliance' },
] as const;

export function DemoFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const allowed = hasAccountFreeDemo();

  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed]);

  if (!allowed) return null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 12 : 4) }]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: colors.primary }]}>Demo mode</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            clearAccountFreeDemo();
            router.replace('/');
          }}
          testID="leave-demo"
          accessibilityRole="button"
          accessibilityLabel="Leave demo"
        >
          <Text style={[styles.leave, { color: colors.mutedForeground }]}>Leave</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {SECTIONS.map(section => {
          const active = section.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(section.href);
          return (
            <TouchableOpacity
              key={section.href}
              onPress={() => router.push(section.href)}
              style={[styles.chip, { backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }]}
              testID={`demo-nav-${section.label.toLowerCase()}`}
            >
              <Text style={{ color: active ? '#ffffff' : colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{section.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 28 }]}>
        {children}
      </ScrollView>
    </View>
  );
}

export function DemoCard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>;
}

export function StatusPill({ label, tone }: { label: string; tone: 'good' | 'warn' | 'info' | 'bad' | 'muted' }) {
  const colors = useColors();
  const background = {
    good: colors.statusCompleted,
    warn: colors.statusInProgress,
    info: colors.statusScheduled,
    bad: colors.destructive,
    muted: colors.mutedForeground,
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  kicker: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 2 },
  leave: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  nav: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  body: { paddingHorizontal: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: '#ffffff', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
