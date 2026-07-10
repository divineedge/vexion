/** Mock user profiles — all belong to tenant 1 (Torres Field Services in seed data). */
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
  { id: 1, name: 'Mike Torres',  email: 'mike@divineedge.com',  role: 'company_owner',  planTier: 'enterprise',    tenantId: 1 },
  { id: 2, name: 'Sarah Chen',   email: 'sarah@divineedge.com', role: 'office_manager', planTier: 'professional',  tenantId: 1 },
  { id: 3, name: 'Jake Rivera',  email: 'jake@divineedge.com',  role: 'technician',     planTier: 'starter',       tenantId: 1 },
];
