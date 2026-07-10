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
  isTechnician: boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(() => {
    try {
      const stored = localStorage.getItem('divine_edge_user');
      if (!stored) return null;
      const u: MockUser = JSON.parse(stored);
      // Apply headers immediately so the first queries after page load are authenticated
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

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      logout,
      isOwner: user?.role === 'company_owner',
      isManager: user?.role === 'office_manager',
      isTechnician: user?.role === 'technician',
      isSuperAdmin: false,
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
