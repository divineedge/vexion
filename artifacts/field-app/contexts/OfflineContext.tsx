import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';

// Keys are namespaced by tenantId + userId so cached data never leaks across accounts on a shared device.
function jobsKey(scope: string, rangeKey?: string) {
  return rangeKey ? `offline_${scope}_jobs_${encodeURIComponent(rangeKey)}` : `offline_${scope}_jobs`;
}
function jobKey(scope: string, jobId: number) { return `offline_${scope}_job_${jobId}`; }
function appsKey(scope: string, jobId: number) { return `offline_${scope}_apps_${jobId}`; }

/** Returns all AsyncStorage keys that belong to a given user scope. */
async function getKeysForScope(scope: string): Promise<string[]> {
  try {
    const all = await AsyncStorage.getAllKeys();
    return all.filter((k) => k.startsWith(`offline_${scope}_`));
  } catch {
    return [];
  }
}

/** Removes every cached entry belonging to a given user scope. */
async function clearScopeCache(scope: string): Promise<void> {
  try {
    const keys = await getKeysForScope(scope);
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch {
    // Silently ignore storage errors
  }
}

interface OfflineContextType {
  isOffline: boolean;
  /** Call with true when an API fetch fails, false when it succeeds */
  reportNetworkStatus: (failed: boolean) => void;
  /** Persist a job list to AsyncStorage (scoped to current user and optional date range). */
  cacheJobs: (jobs: unknown[], rangeKey?: string) => Promise<void>;
  /** Retrieve a cached job list (optionally for a specific date range). */
  getCachedJobs: (rangeKey?: string) => Promise<unknown[] | null>;
  /** Persist a single job to AsyncStorage */
  cacheJob: (jobId: number, job: unknown) => Promise<void>;
  /** Retrieve a cached single job */
  getCachedJob: (jobId: number) => Promise<unknown | null>;
  /** Persist chemical applications for a job */
  cacheApplications: (jobId: number, apps: unknown[]) => Promise<void>;
  /** Retrieve cached chemical applications for a job */
  getCachedApplications: (jobId: number) => Promise<unknown[] | null>;
}

const OfflineContext = createContext<OfflineContextType | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isOffline, setIsOffline] = useState(false);
  const onlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute a per-user namespace scope. Empty string means no user is signed in.
  const scope = user ? `t${user.tenantId}_u${user.id}` : '';

  // Track previous scope so we can clear cache when the active account changes.
  const prevScopeRef = useRef<string>(scope);
  useEffect(() => {
    const prev = prevScopeRef.current;
    if (prev && prev !== scope) {
      // User signed out or a different account signed in — wipe the old account's cache.
      clearScopeCache(prev);
    }
    prevScopeRef.current = scope;
  }, [scope]);

  const reportNetworkStatus = useCallback((failed: boolean) => {
    if (failed) {
      if (onlineTimer.current) {
        clearTimeout(onlineTimer.current);
        onlineTimer.current = null;
      }
      setIsOffline(true);
    } else {
      // Delay clearing offline state briefly so we don't flicker on slow responses
      if (onlineTimer.current) clearTimeout(onlineTimer.current);
      onlineTimer.current = setTimeout(() => setIsOffline(false), 2000);
    }
  }, []);

  const cacheJobs = useCallback(async (jobs: unknown[], rangeKey?: string) => {
    if (!scope) return;
    try {
      await AsyncStorage.setItem(jobsKey(scope, rangeKey), JSON.stringify(jobs));
    } catch {
      // Silently ignore storage errors
    }
  }, [scope]);

  const getCachedJobs = useCallback(async (rangeKey?: string): Promise<unknown[] | null> => {
    if (!scope) return null;
    try {
      const raw = await AsyncStorage.getItem(jobsKey(scope, rangeKey));
      if (!raw) return null;
      return JSON.parse(raw) as unknown[];
    } catch {
      return null;
    }
  }, [scope]);

  const cacheJob = useCallback(async (jobId: number, job: unknown) => {
    if (!scope) return;
    try {
      await AsyncStorage.setItem(jobKey(scope, jobId), JSON.stringify(job));
    } catch {
      // Silently ignore
    }
  }, [scope]);

  const getCachedJob = useCallback(async (jobId: number): Promise<unknown | null> => {
    if (!scope) return null;
    try {
      const raw = await AsyncStorage.getItem(jobKey(scope, jobId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [scope]);

  const cacheApplications = useCallback(async (jobId: number, apps: unknown[]) => {
    if (!scope) return;
    try {
      await AsyncStorage.setItem(appsKey(scope, jobId), JSON.stringify(apps));
    } catch {
      // Silently ignore
    }
  }, [scope]);

  const getCachedApplications = useCallback(async (jobId: number): Promise<unknown[] | null> => {
    if (!scope) return null;
    try {
      const raw = await AsyncStorage.getItem(appsKey(scope, jobId));
      if (!raw) return null;
      return JSON.parse(raw) as unknown[];
    } catch {
      return null;
    }
  }, [scope]);

  return (
    <OfflineContext.Provider
      value={{
        isOffline,
        reportNetworkStatus,
        cacheJobs,
        getCachedJobs,
        cacheJob,
        getCachedJob,
        cacheApplications,
        getCachedApplications,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextType {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
