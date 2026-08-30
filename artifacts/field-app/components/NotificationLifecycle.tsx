import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import {
  disableStaffNotificationDevice,
  registerStaffNotificationDevice,
} from '@workspace/api-client-react';
import { router } from 'expo-router';
import { useAuth, type AuthUser } from '@/contexts/AuthContext';
import { notificationRoute } from '@/utils/notificationRouting';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const deviceKey = (user: Pick<AuthUser, 'tenantId' | 'id'>) =>
  `field_app_notification_device:${user.tenantId}:${user.id}`;

async function disableStoredDevice(user: Pick<AuthUser, 'tenantId' | 'id'>) {
  const key = deviceKey(user);
  const expoPushToken = await AsyncStorage.getItem(key);
  if (!expoPushToken) return;
  try {
    await disableStaffNotificationDevice({ expoPushToken });
    await AsyncStorage.removeItem(key);
  } catch {
    // Keep the scoped token so a later authenticated lifecycle can retry.
  }
}

function isPhysicalNativeDevice() {
  return Platform.OS !== 'web' && Constants.isDevice;
}

function easProjectId(): string | undefined {
  const configuredId = Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof configuredId === 'string' && configuredId.trim() ? configuredId : undefined;
}

export function NotificationLifecycle() {
  const { user, isLoading } = useAuth();
  const priorUser = useRef<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(user);
  userRef.current = user;

  useEffect(() => {
    const previous = priorUser.current;
    if (previous && (!user || previous.id !== user.id || previous.tenantId !== user.tenantId)) {
      void disableStoredDevice(previous);
    }
    priorUser.current = user;
  }, [user?.id, user?.tenantId]);

  useEffect(() => {
    if (isLoading || !user || !isPhysicalNativeDevice()) return;
    let cancelled = false;
    const syncDevice = async () => {
      try {
        let permissions = await Notifications.getPermissionsAsync();
        if (!permissions.granted && permissions.canAskAgain) {
          permissions = await Notifications.requestPermissionsAsync();
        }
        if (!permissions.granted) {
          await disableStoredDevice(user);
          return;
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
        const projectId = easProjectId();
        if (!projectId) {
          console.warn('Push notifications require EXPO_PUBLIC_EAS_PROJECT_ID in the native build environment.');
          return;
        }
        const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (cancelled || !expoPushToken) return;
        await registerStaffNotificationDevice({
          expoPushToken,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
        if (!cancelled) await AsyncStorage.setItem(deviceKey(user), expoPushToken);
      } catch {
        // Push registration must never prevent staff from using the app.
      }
    };
    void syncDevice();
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void syncDevice();
    });
    return () => {
      cancelled = true;
      appStateSubscription.remove();
    };
  }, [isLoading, user?.id, user?.tenantId]);

  useEffect(() => {
    if (isLoading || !user || !isPhysicalNativeDevice()) return;
    const handledResponseIds = new Set<string>();
    const navigate = async (response: Notifications.NotificationResponse | null, clearAfter = false) => {
      if (!response || !userRef.current) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseIds.has(responseId)) return;
      const route = notificationRoute(response.notification.request.content.data);
      if (!route) return;
      handledResponseIds.add(responseId);
      router.push(route as never);
      if (clearAfter) await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(response => navigate(response, true))
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      void navigate(response);
    });
    return () => subscription.remove();
  }, [isLoading, user?.id, user?.tenantId]);

  return null;
}