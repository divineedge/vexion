import { describe, expect, it } from 'vitest';
import { canRestoreSavedSession, parseSavedAuthUser } from './savedDeviceSession';

const defaults = { native: true, token: 'fixture-device-token', userJson: '{"id":2,"tenantId":3}', biometric: 'true', verifier: null };
describe('Remembered phone session recovery', () => {
  it('offers phone unlock for an enrolled device', () => {
    expect(canRestoreSavedSession(defaults)).toBe(true);
  });
  it('keeps a prior login when enrollment was skipped or interrupted', () => {
    expect(canRestoreSavedSession({ ...defaults, biometric: null })).toBe(true);
    expect(canRestoreSavedSession({ ...defaults, biometric: 'false' })).toBe(true);
  });
  it('recovers securely even when cached display information is absent or damaged', () => {
    expect(canRestoreSavedSession({ ...defaults, userJson: null })).toBe(true);
    expect(canRestoreSavedSession({ ...defaults, userJson: 'broken cache' })).toBe(true);
    expect(parseSavedAuthUser('broken cache')).toBeNull();
  });
  it('requires account login on a new device without the secure credential', () => {
    expect(canRestoreSavedSession({ ...defaults, token: null })).toBe(false);
    expect(canRestoreSavedSession({ ...defaults, token: '' })).toBe(false);
  });
  it('does not extend native recovery rules to browsers', () => {
    expect(canRestoreSavedSession({ ...defaults, native: false, biometric: null })).toBe(false);
    expect(canRestoreSavedSession({ ...defaults, native: false, userJson: null })).toBe(false);
    expect(canRestoreSavedSession({ ...defaults, native: false, biometric: null, verifier: 'app-pin-verifier' })).toBe(true);
  });
  it('reads identity safely for comparison with the authenticated server identity', () => {
    expect(parseSavedAuthUser('{"id":2,"tenantId":3,"email":"fixture@example.invalid"}')).toMatchObject({
      id: 2, tenantId: 3, email: 'fixture@example.invalid', avatarUrl: null,
    });
  });
  it.each([null, '', 'null', '{}', '[]', '{"id":0,"tenantId":3}', '{"id":2,"tenantId":-1}', '{"id":"2","tenantId":3}'])('does not trust invalid cached identity %s', value => {
    expect(parseSavedAuthUser(value)).toBeNull();
  });
});
