import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { logout as revokeStaffSession, setDefaultHeaders } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { buildEffectivePermissions, type PermissionKey } from '@/hooks/usePermissions';

const SESSION_TOKEN_KEY = 'divine_edge_session_token';

function applyUserHeaders(u: User | null, sessionToken?: string) {
  if (u) {
    const headers: Record<string, string> = {};
    const token = sessionToken ?? localStorage.getItem(SESSION_TOKEN_KEY) ?? undefined;
    if (token) headers['x-staff-session'] = token;
    setDefaultHeaders(headers);
  } else {
    setDefaultHeaders({});
  }
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User, sessionToken?: string) => void;
  logout: () => void;
  isOwner: boolean;
  isManager: boolean;
  isDepartmentManager: boolean;
  isCrewManager: boolean;
  isTechnician: boolean;
  isSuperAdmin: boolean;
  /** True for any role that can manage office-level tasks (owner, office_manager, department_manager) */
  canManageOffice: boolean;
  /** True for roles that can create/edit jobs (owner, manager, department_manager, crew_manager) */
  canManageJobs: boolean;
  /**
   * Check a permission for the current user.
   * Always returns true for company_owner.
   * Uses default restrictions if no tenant config is loaded yet.
   * Note: for live tenant-config-aware checks use `usePermissions()` from the permissions hook.
   */
  can: (key: PermissionKey) => boolean;
  /** Load/refresh the permission map from the resolved tenant rolePermissions JSONB. */
  setTenantPermissions: (perms: Record<string, Record<string, boolean>> | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('divine_edge_user');
      if (!stored) return null;
      const u: User = JSON.parse(stored);
      applyUserHeaders(u);
      return u;
    } catch {
      return null;
    }
  });

  // Tenant role-permission config — loaded via setTenantPermissions after settings fetch
  const [tenantPermissions, setTenantPermissionsState] = useState<Record<string, Record<string, boolean>> | null>(null);

  const setTenantPermissions = useCallback((perms: Record<string, Record<string, boolean>> | null) => {
    setTenantPermissionsState(perms);
  }, []);

  const login = (u: User, sessionToken?: string) => {
    if (user?.id !== u.id || user?.role !== u.role) queryClient.clear();
    setUser(u);
    localStorage.setItem('divine_edge_user', JSON.stringify(u));
    if (sessionToken) localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
    applyUserHeaders(u, sessionToken);
  };

  const logout = () => {
    // Start server-side revocation while the session header is still configured.
    // Keep this API synchronous for existing navigation/click-handler contracts.
    void revokeStaffSession().catch(() => undefined);
    queryClient.clear();
    setUser(null);
    setTenantPermissionsState(null);
    localStorage.removeItem('divine_edge_user');
    localStorage.removeItem(SESSION_TOKEN_KEY);
    applyUserHeaders(null);
  };

  const role = user?.role;
  const isOwner = role === 'company_owner';
  const isManager = role === 'office_manager';
  const isDepartmentManager = role === 'department_manager';
  const isCrewManager = role === 'crew_manager';
  const isTechnician = role === 'technician';
  const canManageOffice = isOwner || isManager || isDepartmentManager;
  const canManageJobs = isOwner || isManager || isDepartmentManager || isCrewManager;

  // Compute effective permissions for the current role
  const effectivePerms = buildEffectivePermissions(role ?? 'technician', tenantPermissions);

  const can = useCallback(
    (key: PermissionKey): boolean => {
      if (role === 'company_owner') return true;
      return effectivePerms[key] ?? true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, JSON.stringify(effectivePerms)]
  );

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      logout,
      isOwner,
      isManager,
      isDepartmentManager,
      isCrewManager,
      isTechnician,
      isSuperAdmin: false,
      canManageOffice,
      canManageJobs,
      can,
      setTenantPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
