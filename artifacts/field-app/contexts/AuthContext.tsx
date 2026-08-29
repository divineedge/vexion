import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDefaultHeaders, setAuthTokenGetter } from '@workspace/api-client-react';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  tenantId: number;
  avatarUrl: string | null;
  timezone?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  signIn: (token: string, user: AuthUser, sessionToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USER_KEY = 'field_app_user';
const TOKEN_KEY = 'field_app_token';
const SESSION_TOKEN_KEY = 'field_app_session_token';

function applyHeaders(user: AuthUser) {
  setDefaultHeaders({
    'x-user-id': String(user.id),
    'x-tenant-id': String(user.tenantId),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function restore() {
      try {
        const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
        const storedUser = await AsyncStorage.getItem(USER_KEY);
        const storedSessionToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
        if (storedToken && storedUser) {
          const parsedUser: AuthUser = JSON.parse(storedUser);
          parsedUser.timezone ??= 'UTC';
          setToken(storedToken);
          setUser(parsedUser);
          applyHeaders(parsedUser);
          // Restore session-token bearer auth for staff-authenticated endpoints
          if (storedSessionToken) {
            setAuthTokenGetter(() => storedSessionToken);
          }
        }
      } catch {
        // ignore restore errors
      } finally {
        setIsLoading(false);
      }
    }
    restore();
  }, []);

  const signIn = useCallback(async (newToken: string, newUser: AuthUser, sessionToken?: string) => {
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    applyHeaders(newUser);
    // Store and activate the cryptographic session token so staff-authenticated
    // endpoints (e.g. GET /api/staff-notes) receive Authorization: Bearer <token>
    if (sessionToken) {
      await AsyncStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
      setAuthTokenGetter(() => sessionToken);
    }
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setDefaultHeaders({});
    setAuthTokenGetter(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
