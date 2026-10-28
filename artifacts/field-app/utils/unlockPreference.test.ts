import { describe, expect, it } from 'vitest';
import { parseUnlockChoice, unlockChoiceKey, unlockSignInPlan } from './unlockPreference';

describe('Remembered device unlock choices', () => {
  it('keeps the preference separate for each staff identity and company', () => {
    expect(unlockChoiceKey({ tenantId: 1, id: 2 })).not.toBe(unlockChoiceKey({ tenantId: 1, id: 3 }));
    expect(unlockChoiceKey({ tenantId: 1, id: 2 })).not.toBe(unlockChoiceKey({ tenantId: 2, id: 2 }));
  });
  it('only accepts explicit enabled or skipped preferences', () => {
    expect(parseUnlockChoice('enabled')).toBe('enabled');
    expect(parseUnlockChoice('skipped')).toBe('skipped');
    for (const value of [null, '', 'true', 'false', '{}']) expect(parseUnlockChoice(value)).toBeNull();
  });
  it('does not repeat setup for a remembered native opt-in, and keeps phone protection for the next cold start', () => {
    expect(unlockSignInPlan(true, 'enabled')).toEqual({ phoneUnlock: true, passwordOnly: false, needsEnrollment: false });
  });
  it.each([true, false])('remembers a declined setup without bypassing password sign-in (native=%s)', native => {
    expect(unlockSignInPlan(native, 'skipped')).toEqual({ phoneUnlock: false, passwordOnly: true, needsEnrollment: false });
  });
  it('asks once when no choice was saved', () => {
    expect(unlockSignInPlan(true, null).needsEnrollment).toBe(true);
    expect(unlockSignInPlan(false, null).needsEnrollment).toBe(true);
  });
  it('does not mistake a browser preference for an existing browser PIN', () => {
    expect(unlockSignInPlan(false, 'enabled', false).needsEnrollment).toBe(true);
    expect(unlockSignInPlan(false, 'enabled', true).needsEnrollment).toBe(false);
  });
});
