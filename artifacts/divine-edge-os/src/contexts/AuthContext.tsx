import React, { createContext, useContext, useState, ReactNode } from 'react';
import { setDefaultHeaders } from '@workspace/api-client-react';
import type { MockUser } from './mockUsers';


function applyUserHeaders(u: MockUser | null) {
  if (u) {
    setDefaultHeaders({
      'x-tenant-id': String(u.tenantId),
      'x-user-id': String(u.id),
    });
  } else {
    setDefaultHeaders({});
  }
}

interface AuthContextType {
  user: MockUser | null;
  isAuthenticated: boolean;
  login: (user: MockUser) => void;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(() => {
    try {
      const stored = localStorage.getItem('divine_edge_user');
      if (!stored) return null;
      const u: MockUser = JSON.parse(stored);
      applyUserHeaders(u);
      return u;
    } catch {
      return null;
    }
  });

  const login = (u: MockUser) => {
    setUser(u);
    localStorage.setItem('divine_edge_user', JSON.stringify(u));
    applyUserHeaders(u);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('divine_edge_user');
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
