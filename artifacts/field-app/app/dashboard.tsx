import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { clearAccountFreeDemo, hasAccountFreeDemo } from '@/utils/demoAccess';

export default function DemoDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const allowed = hasAccountFreeDemo();

  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed]);

  if (!allowed) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 16) }]}>
      <View style={[styles.banner, { backgroundColor: colors.primary }]}>
        <Ionicons name="flask-outline" size={28} color="#ffffff" />
        <Text style={styles.bannerTitle}>Demo dashboard</Text>
        <Text style={styles.bannerText}>You are in the account-free sandbox. No sign-in and no account were required.</Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Sandbox</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          A demo flag and token are saved in this browser. Nothing was created on the server.
        </Text>
        <TouchableOpacity
          style={[styles.button, { borderColor: colors.border }]}
          onPress={() => {
            clearAccountFreeDemo();
            router.replace('/');
          }}
          testID="leave-demo"
          accessibilityRole="button"
          accessibilityLabel="Leave demo"
        >
          <Text style={[styles.buttonText, { color: colors.foreground }]}>Leave demo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  banner: { borderRadius: 16, padding: 24, marginBottom: 16 },
  bannerTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, color: '#ffffff', marginTop: 12 },
  bannerText: { fontFamily: 'Inter_400Regular', fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 8 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  button: {
    marginTop: 20,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
