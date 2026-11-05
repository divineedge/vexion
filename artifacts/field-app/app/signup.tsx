import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useColorScheme,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { customFetch, type AuthResponse } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { mapLoginUser } from '@/utils/authUser';
import { passwordSecurityError } from '@/utils/passwordRules';
import { UnlockEnrollment, UnlockScreen } from '@/components/AuthUnlock';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { signIn, user, isLoading, isLocked, needsEnrollment } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!isLoading && user && !needsEnrollment) router.replace('/(app)/jobs');
  }, [isLoading, needsEnrollment, user]);

  const handleSignup = async () => {
    const business = companyName.trim();
    const name = ownerName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!business) return setError('Business name is required.');
    if (business.length > 120) return setError('Business name must be 120 characters or fewer.');
    if (!name) return setError('Your name is required.');
    if (!normalizedEmail) return setError('Email is required.');
    const ruleError = passwordSecurityError(password);
    if (ruleError) {
      setPasswordError(ruleError);
      return;
    }
    setPasswordError('');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setError('');
    setPending(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await customFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: business,
          ownerName: name,
          email: normalizedEmail,
          password,
        }),
      });
      const userData = mapLoginUser({
        ...result.user,
        timezone: result.user.timezone ?? 'UTC',
      });
      await signIn(result.sessionToken, userData, result.sessionToken);
    } catch (err: unknown) {
      const apiMessage = err && typeof err === 'object' && 'data' in err
        ? (err as { data?: { error?: string } }).data?.error
        : undefined;
      setError(err instanceof TypeError
        ? "Can't reach the server — check your connection."
        : apiMessage ?? 'Something went wrong. Please try again.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPending(false);
    }
  };

  if (isLoading) {
    return <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (isLocked) return <UnlockScreen />;
  if (user && needsEnrollment) return <UnlockEnrollment />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) + 24,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.replace('/')}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
          testID="signup-back"
        >
          <Ionicons name="chevron-back" size={22} color="#ffffff" />
          <Text style={styles.backText}>Sign in</Text>
        </TouchableOpacity>
        <View style={styles.logoWrap}>
          <Ionicons name="leaf" size={32} color="#ffffff" />
        </View>
        <Text style={styles.appName}>Create your account</Text>
        <Text style={styles.appSubtitle}>Set up your business for the field app</Text>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.formWrap}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
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
          {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
          <Field label="Business name" colors={colors} error={Boolean(error)}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="Your company"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              testID="signup-business-name"
            />
          </Field>
          <Field label="Your name" colors={colors} error={Boolean(error)}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              testID="signup-owner-name"
            />
          </Field>
          <Field label="Email" colors={colors} error={Boolean(error)}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="signup-email"
            />
          </Field>
          <Field label="Password" colors={colors} error={Boolean(error || passwordError)}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={password}
              onChangeText={value => {
                setPassword(value);
                if (passwordError) setPasswordError(passwordSecurityError(value) ?? '');
              }}
              placeholder="8+ chars, mixed case, number, symbol"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              testID="signup-password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(visible => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              testID="signup-password-visibility"
              hitSlop={8}
              style={styles.eyeButton}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </Field>
          {passwordError ? (
            <Text style={[styles.passwordError, { color: colors.destructive }]} testID="signup-password-error">
              {passwordError}
            </Text>
          ) : null}
          <Field label="Confirm password" colors={colors} error={Boolean(error)}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Repeat your password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleSignup}
              testID="signup-confirm-password"
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(visible => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
              testID="signup-confirm-password-visibility"
              hitSlop={8}
              style={styles.eyeButton}
            >
              <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </Field>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary, opacity: pending ? 0.7 : 1 }]}
            onPress={handleSignup}
            disabled={pending}
            activeOpacity={0.85}
            testID="signup-submit"
          >
            {pending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.buttonText}>Sign Up</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function Field({
  label,
  colors,
  error,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  error: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: error ? colors.destructive : colors.border, backgroundColor: colors.muted }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', paddingBottom: 36, paddingHorizontal: 20 },
  back: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  backText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: '#ffffff' },
  logoWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  appName: { fontFamily: 'Inter_700Bold', fontSize: 24, color: '#ffffff' },
  appSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  formWrap: { flex: 1, marginTop: -20 },
  card: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  fieldGroup: { marginBottom: 16 },
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
  input: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, height: 48 },
  eyeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 12 },
  passwordError: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: -8, marginBottom: 12 },
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#ffffff' },
});
