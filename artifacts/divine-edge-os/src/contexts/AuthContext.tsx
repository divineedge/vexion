import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type MockUser = {
  id: number;
  name: string;
  email: string;
  role: 'company_owner' | 'office_manager' | 'technician';
  planTier: 'enterprise' | 'professional' | 'starter';
  tenantId: number;
  avatarUrl?: string;
};

export const MOCK_USERS: MockUser[] = [
  { id: 1, name: 'Mike Torres', email: 'mike@divineedge.com', role: 'company_owner', planTier: 'enterprise', tenantId: 100 },
  { id: 2, name: 'Sarah Chen', email: 'sarah@divineedge.com', role: 'office_manager', planTier: 'professional', tenantId: 100 },
  { id: 3, name: 'Jake Rivera', email: 'jake@divineedge.com', role: 'technician', planTier: 'starter', tenantId: 100 },
];

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
    const stored = localStorage.getItem('divine_edge_user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = (u: MockUser) => {
    setUser(u);
    localStorage.setItem('divine_edge_user', JSON.stringify(u));
    // Provide a way to inject these globally if possible, but customFetch might not support it cleanly
    // For now we'll set it in localStorage which interceptors might read, or just rely on the mock.
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('divine_edge_user');
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
