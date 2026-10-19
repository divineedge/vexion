import type { AuthUser } from '@/contexts/AuthContext';
import { mapLoginUser } from './authUser';

/** A native device's secure credential is enough to offer phone unlock.
 * Enrollment flags and cached display information are not authentication. */
export function canRestoreSavedSession(input: {
  native: boolean; token: string | null; userJson: string | null;
  biometric: string | null; verifier: string | null;
}): boolean {
  return Boolean(input.token && (input.native || (input.userJson && (input.biometric === 'true' || input.verifier))));
}

export function parseSavedAuthUser(json: string | null): AuthUser | null {
  try {
    if (!json) return null;
    const value = JSON.parse(json);
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 ||
      !Number.isSafeInteger(value.tenantId) || value.tenantId <= 0) return null;
    return mapLoginUser({
      id: value.id, tenantId: value.tenantId,
      email: typeof value.email === 'string' ? value.email : '',
      name: typeof value.name === 'string' ? value.name : '',
      role: typeof value.role === 'string' ? value.role : '',
      avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
      timezone: typeof value.timezone === 'string' ? value.timezone : undefined,
    });
  } catch { return null; }
}
