import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

function PrimaryButton({ label, icon, onPress, busy = false }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; busy?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity style={[styles.primary, { backgroundColor: colors.primary }]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name={icon} color="#fff" size={20} /><Text style={styles.primaryText}>{label}</Text></>}
    </TouchableOpacity>
  );
}

export function UnlockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { biometricEnabled, pinEnabled, pinAttemptsRemaining, unlockWithBiometrics, unlockWithPin, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (!result.ok) setMessage(result.message ?? 'Unable to unlock.');
    } catch {
      setMessage('Unable to unlock. Try again or sign in with your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 48 }]}>
      <View style={[styles.icon, { backgroundColor: colors.primary }]}><Ionicons name="lock-closed" size={32} color="#fff" /></View>
      <Text style={[styles.title, { color: colors.foreground }]}>App Locked</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>This device is remembered. Unlock to continue—no username or password needed.</Text>
      {biometricEnabled && <PrimaryButton label="Unlock with phone" icon="finger-print" busy={busy} onPress={() => void run(unlockWithBiometrics)} />}
      {Platform.OS !== 'web' && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Use the same fingerprint, face recognition, or PIN/passcode you use to unlock your phone. Your phone controls the prompt; the app never sees your phone PIN.</Text>}
      {pinEnabled && (
        <>
          <TextInput
            value={pin}
            onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 8))}
            secureTextEntry keyboardType="number-pad" placeholder="App PIN"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <PrimaryButton label={`Unlock with PIN (${pinAttemptsRemaining} left)`} icon="keypad" busy={busy} onPress={() => void run(() => unlockWithPin(pin))} />
        </>
      )}
      {message ? <Text style={[styles.message, { color: colors.destructive }]}>{message}</Text> : null}
      <TouchableOpacity onPress={() => void signOut()}><Text style={[styles.link, { color: colors.mutedForeground }]}>Sign in with password instead</Text></TouchableOpacity>
    </View>
  );
}

function RememberChoice({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={styles.remember}
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="checkbox"
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel="Remember my choice on this device"
      testID="remember-choice-checkbox"
    >
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
      <Text style={[styles.choiceText, { color: colors.foreground }]}>Remember my choice on this device</Text>
    </TouchableOpacity>
  );
}

function SkipLink({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button" testID="skip-unlock-button" style={{ opacity: disabled ? 0.5 : 1 }}>
      <Text style={[styles.link, { color: colors.primary }]}>Use password instead / Skip</Text>
    </TouchableOpacity>
  );
}

export function UnlockEnrollment() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { biometricAvailable, configureUnlock, skipUnlock } = useAuth();
  const [rememberChoice, setRememberChoice] = useState(true);
  const [useBiometric, setUseBiometric] = useState(biometricAvailable);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pin && !/^\d{4,8}$/.test(pin)) return setMessage('PIN must be 4–8 digits.');
    if (pin !== confirm) return setMessage('PIN entries do not match.');
    if (!useBiometric && !pin) return setMessage('Choose biometrics, enter a PIN, or tap Use password instead / Skip.');
    setBusy(true);
    setMessage('');
    try {
      await configureUnlock({ biometric: useBiometric, pin: pin || undefined, rememberChoice });
    } catch {
      setMessage('Could not save unlock settings. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    setBusy(true);
    setMessage('');
    void skipUnlock(rememberChoice)
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not save your choice. Please try again.'))
      .finally(() => setBusy(false));
  };
  const skipNote = 'Skipping means you will sign in with your password after closing the app. Your login is not kept unlocked on this device.';

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 36 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Use your phone’s unlock</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          No separate app PIN. Use your phone’s fingerprint, face recognition, or PIN/passcode. If biometrics fail, use the phone’s passcode option.
        </Text>
        {!biometricAvailable && <Text style={[styles.message, { color: colors.mutedForeground }]}>Set up biometrics or a screen lock in your phone’s settings, then return and tap Enable phone unlock.</Text>}
        <PrimaryButton label="Enable phone unlock" icon="shield-checkmark" busy={busy} onPress={() => {
          setBusy(true);
          setMessage('');
          void configureUnlock({ biometric: true, rememberChoice }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not enable phone unlock.')).finally(() => setBusy(false));
        }} />
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>You only need your account password to sign in on a new device, after signing out, or if your saved access is revoked.</Text>
        {message ? <Text style={[styles.message, { color: colors.destructive }]}>{message}</Text> : null}
        <RememberChoice value={rememberChoice} onChange={setRememberChoice} disabled={busy} />
        <SkipLink onPress={skip} disabled={busy} />
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{skipNote}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 36 }]}>
      <View style={[styles.icon, { backgroundColor: colors.primary }]}><Ionicons name="shield-checkmark" size={32} color="#fff" /></View>
      <Text style={[styles.title, { color: colors.foreground }]}>Faster secure unlock</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your password remains required when the server session expires or you log out.</Text>
      {biometricAvailable && (
        <TouchableOpacity style={[styles.choice, { borderColor: useBiometric ? colors.primary : colors.border }]} onPress={() => setUseBiometric(value => !value)}>
          <Ionicons name="finger-print" size={24} color={colors.primary} />
          <Text style={[styles.choiceText, { color: colors.foreground }]}>Use Face ID / fingerprint</Text>
          <Ionicons name={useBiometric ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
        </TouchableOpacity>
      )}
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Optional 4–8 digit app PIN</Text>
      <TextInput value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 8))} secureTextEntry keyboardType="number-pad" placeholder="Enter PIN" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
      <TextInput value={confirm} onChangeText={value => setConfirm(value.replace(/\D/g, '').slice(0, 8))} secureTextEntry keyboardType="number-pad" placeholder="Confirm PIN" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
      {message ? <Text style={[styles.message, { color: colors.destructive }]}>{message}</Text> : null}
      <PrimaryButton label="Save secure unlock" icon="shield-checkmark" busy={busy} onPress={() => void save()} />
      <RememberChoice value={rememberChoice} onChange={setRememberChoice} disabled={busy} />
      <SkipLink onPress={skip} disabled={busy} />
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{skipNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, alignItems: 'center', gap: 14 },
  icon: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 14, maxWidth: 380 },
  primary: { width: '100%', maxWidth: 420, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 16 },
  primaryText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  input: { width: '100%', maxWidth: 420, height: 50, borderWidth: 1, borderRadius: 11, paddingHorizontal: 15, fontFamily: 'Inter_500Medium', fontSize: 16 },
  choice: { width: '100%', maxWidth: 420, minHeight: 58, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  choiceText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15 },
  remember: { width: '100%', maxWidth: 420, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: '100%', maxWidth: 420, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4 },
  message: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  link: { fontFamily: 'Inter_500Medium', fontSize: 14, padding: 12 },
});