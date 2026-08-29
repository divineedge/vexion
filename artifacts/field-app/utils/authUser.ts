import type { AuthUser } from '@/contexts/AuthContext';

export function mapLoginUser(user: {
  id: number;
  email: string;
  name?: string | null;
  role?: string | null;
  tenantId: number;
  avatarUrl?: string | null;
  timezone?: string | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? '',
    role: user.role ?? '',
    tenantId: user.tenantId,
    avatarUrl: user.avatarUrl ?? null,
    timezone: user.timezone ?? 'UTC',
  };
}