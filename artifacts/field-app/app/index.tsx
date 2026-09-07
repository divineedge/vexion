import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLogin } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { mapLoginUser } from '@/utils/authUser';
import { UnlockEnrollment, UnlockScreen } from '@/components/AuthUnlock';

const REMEMBERED_EMAIL_KEY = 'field_app_remembered_email';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { signIn, user, isLoading, isLocked, needsEnrollment } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const loginMutation = useLogin();

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Email is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    setError('');
    try {
      await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail).catch(() => undefined);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await loginMutation.mutateAsync({ data: { email: normalizedEmail, password } });
      const userData = mapLoginUser({
        ...result.user,
        timezone: result.user.timezone ?? 'UTC',
      });
      await signIn(result.sessionToken, userData, result.sessionToken ?? undefined);
    } catch (err: unknown) {
      let message = 'Invalid email or password. Please try again.';
      if (err && typeof err === 'object') {
        // Network/timeout — fetch throws a TypeError when the request never completes
        if (err instanceof TypeError) {
          message = "Can't reach the server — check your connection.";
        } else if ('status' in err) {
          const status = (err as { status: number }).status;
          if (status === 401) {
            message = 'Invalid email or password. Please try again.';
          } else if (status >= 500) {
            message = 'Server error, please try again.';
          }
        } else if ('response' in err) {
          // Axios-style error with a response object
          const response = (err as { response?: { status?: number } }).response;
          const status = response?.status ?? 0;
          if (status === 401) {
            message = 'Invalid email or password. Please try again.';
          } else if (status >= 500) {
            message = 'Server error, please try again.';
          } else if (status === 0 || !status) {
            message = "Can't reach the server — check your connection.";
          }
        }
      }
      setError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const isDark = colorScheme === 'dark';

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(REMEMBERED_EMAIL_KEY).then(rememberedEmail => {
      if (mounted && rememberedEmail) setEmail(rememberedEmail);
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoading && user && !needsEnrollment) router.replace('/(app)/jobs');
  }, [isLoading, needsEnrollment, user]);

  if (isLoading) {
    return <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (isLocked) return <UnlockScreen />;
  if (user && needsEnrollment) return <UnlockEnrollment />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header area */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) + 40,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <View style={styles.logoWrap}>
          <Ionicons name="leaf" size={36} color="#ffffff" />
        </View>
        <Text style={styles.appName}>Divine Edge</Text>
        <Text style={styles.appSubtitle}>Field Staff</Text>
      </View>

      {/* Form card */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.formWrap}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: isDark ? '#000' : '#0f172a',
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Sign in</Text>
          <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
            Enter your work email and password to continue
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <View
              style={[
                styles.inputWrap,
                {
                  borderColor: error ? colors.destructive : colors.border,
                  backgroundColor: colors.muted,
                },
              ]}
            >
              <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleLogin}
                returnKeyType="go"
                testID="email-input"
              />
            </View>
            {error ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            ) : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
            <View
              style={[
                styles.inputWrap,
                {
                  borderColor: error ? colors.destructive : colors.border,
                  backgroundColor: colors.muted,
                },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleLogin}
                returnKeyType="go"
                testID="password-input"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.primary, opacity: loginMutation.isPending ? 0.7 : 1 },
            ]}
            onPress={handleLogin}
            disabled={loginMutation.isPending}
            activeOpacity={0.85}
            testID="login-button"
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <Text style={styles.buttonText}>Sign In</Text>
                <Ionicons name="arrow-forward" size={18} color="#ffffff" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 },
        ]}
      >
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          For field staff and administrators
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    paddingBottom: 48,
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  formWrap: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: -24,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginBottom: 24,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    height: 48,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 6,
  },
  button: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#ffffff',
  },
  footer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  footerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    textAlign: 'center',
  },
});
