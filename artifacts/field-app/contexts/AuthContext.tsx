import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  disableStaffNotificationDevice,
  getMe,
  logout as revokeStaffSession,
  setDefaultHeaders,
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from '@workspace/api-client-react';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  tenantId: number;
  avatarUrl: string | null;
  timezone?: string;
}

type UnlockResult = { ok: true } | { ok: false; message: string; wiped?: boolean };

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isLocked: boolean;
  needsEnrollment: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  pinEnabled: boolean;
  pinAttemptsRemaining: number;
  signIn: (token: string, user: AuthUser, sessionToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
  lockApp: () => Promise<void>;
  configureUnlock: (options: { biometric: boolean; pin?: string }) => Promise<void>;
  skipUnlockEnrollment: () => Promise<void>;
  unlockWithBiometrics: () => Promise<UnlockResult>;
  unlockWithPin: (pin: string) => Promise<UnlockResult>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USER_KEY = 'field_app_user';
const LEGACY_TOKEN_KEY = 'field_app_token';
const LEGACY_SESSION_TOKEN_KEY = 'field_app_session_token';
const TOKEN_KEY = 'field_app_secure_session';
const BIOMETRIC_KEY = 'field_app_biometric_enabled';
const PIN_SALT_KEY = 'field_app_pin_salt';
const PIN_VERIFIER_KEY = 'field_app_pin_verifier';
const PIN_ATTEMPTS_KEY = 'field_app_pin_attempts';
const MAX_PIN_ATTEMPTS = 5;
const PBKDF2_ITERATIONS = 120_000;

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.sessionStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function normalizeUser(value: unknown): AuthUser {
  const user = value as AuthUser;
  return { ...user, avatarUrl: user.avatarUrl ?? null, timezone: user.timezone ?? 'UTC' };
}

function pinVerifier(pin: string, saltHex: string): string {
  return bytesToHex(pbkdf2(sha256, utf8ToBytes(pin), utf8ToBytes(saltHex), {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  }));
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('response' in error) return (error as { response?: { status?: number } }).response?.status;
  return undefined;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinAttemptsRemaining, setPinAttemptsRemaining] = useState(MAX_PIN_ATTEMPTS);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const clearLocalAuth = useCallback(async (knownUser?: AuthUser | null) => {
    const currentUser = knownUser;
    if (currentUser) {
      await AsyncStorage.removeItem(`field_app_notification_device:${currentUser.tenantId}:${currentUser.id}`);
    }
    await Promise.all([
      AsyncStorage.removeItem(USER_KEY),
      AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
      AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY),
      secureDelete(TOKEN_KEY),
      secureDelete(BIOMETRIC_KEY),
      secureDelete(PIN_SALT_KEY),
      secureDelete(PIN_VERIFIER_KEY),
      secureDelete(PIN_ATTEMPTS_KEY),
    ]);
    setUser(null);
    setToken(null);
    setIsLocked(false);
    setNeedsEnrollment(false);
    setBiometricEnabled(false);
    setPinEnabled(false);
    setPinAttemptsRemaining(MAX_PIN_ATTEMPTS);
    setDefaultHeaders({});
    setAuthTokenGetter(null);
    queryClient.clear();
  }, [queryClient]);

  const validateSession = useCallback(async (storedToken: string, storedUser: AuthUser): Promise<UnlockResult> => {
    setAuthTokenGetter(() => storedToken);
    try {
      const current = normalizeUser(await getMe());
      if (current.id !== storedUser.id || current.tenantId !== storedUser.tenantId) {
        await clearLocalAuth(storedUser);
        return { ok: false, message: 'Your saved session is no longer valid. Please sign in again.', wiped: true };
      }
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(current));
      await secureSet(PIN_ATTEMPTS_KEY, '0');
      setPinAttemptsRemaining(MAX_PIN_ATTEMPTS);
      setToken(storedToken);
      setUser(current);
      setIsLocked(false);
      return { ok: true };
    } catch (error) {
      if (errorStatus(error) === 401 || errorStatus(error) === 403) {
        await clearLocalAuth(storedUser);
        return { ok: false, message: 'Your session expired. Please sign in with your password.', wiped: true };
      }
      setAuthTokenGetter(null);
      return { ok: false, message: 'Unable to verify your session. Check your connection and try again.' };
    }
  }, [clearLocalAuth]);

  useEffect(() => {
    setUnauthorizedHandler(() => clearLocalAuth(user));
    return () => setUnauthorizedHandler(null);
  }, [clearLocalAuth, user]);

  useEffect(() => {
    async function restore() {
      try {
        await Promise.all([
          AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
          AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY),
        ]);
        const [storedToken, storedUserJson, biometric, verifier, attempts] = await Promise.all([
          secureGet(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
          secureGet(BIOMETRIC_KEY),
          secureGet(PIN_VERIFIER_KEY),
          secureGet(PIN_ATTEMPTS_KEY),
        ]);
        const hardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = hardware && await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(enrolled);
        setBiometricEnabled(biometric === 'true');
        setPinEnabled(Boolean(verifier));
        const failedAttempts = Number(attempts ?? '0');
        setPinAttemptsRemaining(Math.max(0, MAX_PIN_ATTEMPTS - failedAttempts));
        if (storedToken && storedUserJson && (biometric === 'true' || verifier)) {
          setIsLocked(true);
        } else if (storedToken || storedUserJson) {
          await clearLocalAuth(storedUserJson ? normalizeUser(JSON.parse(storedUserJson)) : null);
        }
      } catch {
        await clearLocalAuth(null);
      } finally {
        setIsLoading(false);
      }
    }
    void restore();
  }, [clearLocalAuth]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const wasBackground = appState.current === 'background' || appState.current === 'inactive';
      appState.current = nextState;
      if (nextState === 'active' && wasBackground && user && !needsEnrollment) {
        void (async () => {
          const hasUnlock = biometricEnabled || pinEnabled;
          if (!hasUnlock) {
            await clearLocalAuth(user);
            return;
          }
          setUser(null);
          setToken(null);
          setAuthTokenGetter(null);
          setIsLocked(true);
        })();
      }
    });
    return () => subscription.remove();
  }, [biometricEnabled, clearLocalAuth, needsEnrollment, pinEnabled, user]);

  const signIn = useCallback(async (newToken: string, newUser: AuthUser, sessionToken?: string) => {
    const secureToken = sessionToken ?? newToken;
    const normalized = normalizeUser(newUser);
    await Promise.all([
      secureSet(TOKEN_KEY, secureToken),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(normalized)),
      secureSet(PIN_ATTEMPTS_KEY, '0'),
    ]);
    setAuthTokenGetter(() => secureToken);
    setToken(secureToken);
    setUser(normalized);
    setIsLocked(false);
    setNeedsEnrollment(true);
  }, []);

  const configureUnlock = useCallback(async ({ biometric, pin }: { biometric: boolean; pin?: string }) => {
    if (!biometric && !pin) throw new Error('Choose biometrics, a PIN, or Skip for now.');
    if (biometric) await secureSet(BIOMETRIC_KEY, 'true');
    else await secureDelete(BIOMETRIC_KEY);
    if (pin) {
      const salt = bytesToHex(Crypto.getRandomBytes(16));
      await Promise.all([
        secureSet(PIN_SALT_KEY, salt),
        secureSet(PIN_VERIFIER_KEY, pinVerifier(pin, salt)),
      ]);
    } else {
      await Promise.all([
        secureDelete(PIN_SALT_KEY),
        secureDelete(PIN_VERIFIER_KEY),
      ]);
    }
    await secureSet(PIN_ATTEMPTS_KEY, '0');
    setBiometricEnabled(biometric);
    setPinEnabled(Boolean(pin));
    setPinAttemptsRemaining(MAX_PIN_ATTEMPTS);
    setNeedsEnrollment(false);
  }, []);

  const skipUnlockEnrollment = useCallback(async () => {
    await Promise.all([
      secureDelete(BIOMETRIC_KEY),
      secureDelete(PIN_SALT_KEY),
      secureDelete(PIN_VERIFIER_KEY),
    ]);
    setBiometricEnabled(false);
    setPinEnabled(false);
    setNeedsEnrollment(false);
  }, []);

  const unlockWithBiometrics = useCallback(async (): Promise<UnlockResult> => {
    const [storedToken, storedUserJson] = await Promise.all([
      secureGet(TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    if (!storedToken || !storedUserJson) {
      await clearLocalAuth(null);
      return { ok: false, message: 'No saved session was found. Please sign in again.', wiped: true };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Divine Edge Field',
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
    });
    if (!result.success) return { ok: false, message: 'Biometric unlock was cancelled or unsuccessful.' };
    return validateSession(storedToken, normalizeUser(JSON.parse(storedUserJson)));
  }, [clearLocalAuth, validateSession]);

  const unlockWithPin = useCallback(async (pin: string): Promise<UnlockResult> => {
    const [storedToken, storedUserJson, salt, verifier, attemptsValue] = await Promise.all([
      secureGet(TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
      secureGet(PIN_SALT_KEY),
      secureGet(PIN_VERIFIER_KEY),
      secureGet(PIN_ATTEMPTS_KEY),
    ]);
    if (!storedToken || !storedUserJson || !salt || !verifier) {
      return { ok: false, message: 'PIN unlock is not configured.' };
    }
    if (pinVerifier(pin, salt) !== verifier) {
      const attempts = Number(attemptsValue ?? '0') + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        await clearLocalAuth(normalizeUser(JSON.parse(storedUserJson)));
        return { ok: false, message: 'Too many incorrect attempts. Sign in with your password.', wiped: true };
      }
      await secureSet(PIN_ATTEMPTS_KEY, String(attempts));
      setPinAttemptsRemaining(MAX_PIN_ATTEMPTS - attempts);
      return { ok: false, message: `Incorrect PIN. ${MAX_PIN_ATTEMPTS - attempts} attempts remaining.` };
    }
    return validateSession(storedToken, normalizeUser(JSON.parse(storedUserJson)));
  }, [clearLocalAuth, validateSession]);

  const lockApp = useCallback(async () => {
    if (!biometricEnabled && !pinEnabled) {
      await clearLocalAuth(user);
      return;
    }
    setUser(null);
    setToken(null);
    setAuthTokenGetter(null);
    setIsLocked(true);
  }, [biometricEnabled, clearLocalAuth, pinEnabled, user]);

  const signOut = useCallback(async () => {
    const [storedToken, storedUserJson] = await Promise.all([
      secureGet(TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    const signedInUser = user ?? (storedUserJson ? normalizeUser(JSON.parse(storedUserJson)) : null);
    if (signedInUser) {
      const notificationKey = `field_app_notification_device:${signedInUser.tenantId}:${signedInUser.id}`;
      try {
        const expoPushToken = await AsyncStorage.getItem(notificationKey);
        if (expoPushToken) await disableStaffNotificationDevice({ expoPushToken });
      } catch {
        // Server/session availability must never prevent local credential removal.
      }
    }
    try {
      if (storedToken) setAuthTokenGetter(() => storedToken);
      await revokeStaffSession();
    } catch {
      // Best effort; local credential removal is authoritative on this device.
    }
    await clearLocalAuth(signedInUser);
  }, [clearLocalAuth, user]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, isLocked, needsEnrollment, biometricAvailable,
      biometricEnabled, pinEnabled, pinAttemptsRemaining, signIn, signOut,
      lockApp, configureUnlock, skipUnlockEnrollment, unlockWithBiometrics, unlockWithPin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}