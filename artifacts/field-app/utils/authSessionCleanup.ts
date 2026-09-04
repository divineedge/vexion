import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  disableStaffNotificationDevice,
  logout as revokeStaffSession,
} from '@workspace/api-client-react';

type StaffIdentity = {
  id: number;
  tenantId: number;
};

export const notificationDeviceKey = (user: StaffIdentity) =>
  `field_app_notification_device:${user.tenantId}:${user.id}`;

export async function endRemoteStaffSession(
  sessionToken: string | null,
  user: StaffIdentity | null,
): Promise<void> {
  if (!sessionToken) return;

  const requestOptions: RequestInit = {
    headers: { Authorization: `Bearer ${sessionToken}` },
  };

  if (user) {
    const key = notificationDeviceKey(user);
    try {
      const expoPushToken = await AsyncStorage.getItem(key);
      if (expoPushToken) {
        await disableStaffNotificationDevice({ expoPushToken }, requestOptions);
        await AsyncStorage.removeItem(key);
      }
    } catch {
      // Retain the device token so a later authenticated lifecycle can retry.
    }
  }

  try {
    await revokeStaffSession(requestOptions);
  } catch {
    // Offline and already-invalid sessions are cleared locally below.
  }
}