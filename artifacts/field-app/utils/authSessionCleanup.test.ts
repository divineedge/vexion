import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(),
  disableStaffNotificationDevice: vi.fn(),
  revokeStaffSession: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  disableStaffNotificationDevice: mocks.disableStaffNotificationDevice,
  logout: mocks.revokeStaffSession,
}));

import {
  endRemoteStaffSession,
  notificationDeviceKey,
} from './authSessionCleanup';

const user = { id: 21, tenantId: 11 };

describe('authenticated staff session cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('authenticates both notification cleanup and session revocation with the saved bearer token', async () => {
    mocks.getItem.mockResolvedValue('ExponentPushToken[live-device]');
    mocks.disableStaffNotificationDevice.mockResolvedValue(undefined);
    mocks.removeItem.mockResolvedValue(undefined);
    mocks.revokeStaffSession.mockResolvedValue(undefined);

    await endRemoteStaffSession('saved-session-token', user);

    const requestOptions = {
      headers: { Authorization: 'Bearer saved-session-token' },
    };
    expect(mocks.getItem).toHaveBeenCalledWith(notificationDeviceKey(user));
    expect(mocks.disableStaffNotificationDevice).toHaveBeenCalledWith(
      { expoPushToken: 'ExponentPushToken[live-device]' },
      requestOptions,
    );
    expect(mocks.removeItem).toHaveBeenCalledWith(notificationDeviceKey(user));
    expect(mocks.revokeStaffSession).toHaveBeenCalledWith(requestOptions);
  });

  it('retains the device token for a later retry when notification cleanup fails offline', async () => {
    mocks.getItem.mockResolvedValue('ExponentPushToken[offline-device]');
    mocks.disableStaffNotificationDevice.mockRejectedValue(new Error('offline'));
    mocks.revokeStaffSession.mockRejectedValue(new Error('offline'));

    await expect(endRemoteStaffSession('saved-session-token', user)).resolves.toBeUndefined();

    expect(mocks.removeItem).not.toHaveBeenCalled();
    expect(mocks.revokeStaffSession).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer saved-session-token' },
    });
  });

  it('does not disable notifications or revoke a session for a local-only app lock', async () => {
    await endRemoteStaffSession(null, user);

    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.disableStaffNotificationDevice).not.toHaveBeenCalled();
    expect(mocks.removeItem).not.toHaveBeenCalled();
    expect(mocks.revokeStaffSession).not.toHaveBeenCalled();
  });

  it('still revokes an authenticated session when no saved staff identity is available', async () => {
    mocks.revokeStaffSession.mockResolvedValue(undefined);

    await endRemoteStaffSession('saved-session-token', null);

    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.disableStaffNotificationDevice).not.toHaveBeenCalled();
    expect(mocks.revokeStaffSession).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer saved-session-token' },
    });
  });
});