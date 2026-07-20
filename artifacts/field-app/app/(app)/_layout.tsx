import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function AppLayout() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/');
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="jobs" options={{ title: 'My Jobs', headerShown: true }} />
      <Stack.Screen name="job/[id]" options={{ title: 'Job Detail', headerShown: true }} />
      <Stack.Screen name="log/[jobId]" options={{ title: 'Log Application', headerShown: true }} />
      <Stack.Screen name="equipment" options={{ title: 'Equipment', headerShown: true }} />
      <Stack.Screen name="equipment/[id]" options={{ title: 'Equipment', headerShown: true }} />
      <Stack.Screen
        name="equipment-fuel/[id]"
        options={{ title: 'Log Fuel Fill', headerShown: true }}
      />
      <Stack.Screen name="series/[id]" options={{ title: 'Recurring Series', headerShown: true }} />
    </Stack>
  );
}
