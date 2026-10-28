import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveWithTimeout } from './jobTimeClockState';

const LOCATION_ASKED_KEY = 'field_app_location_prompted_v1';
let permissionCheck: Promise<boolean> | null = null;

function clockLocationPermission(): Promise<boolean> {
  if (permissionCheck) return permissionCheck;
  permissionCheck = (async () => {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.granted) return true;
    // Respect an OS denial, including permission decisions from older versions.
    // A temporary "Allow once" grant can also expire; do not ask every stop.
    if (permission.status === 'denied' || !permission.canAskAgain) return false;
    if (await AsyncStorage.getItem(LOCATION_ASKED_KEY) === 'true') return false;
    await AsyncStorage.setItem(LOCATION_ASKED_KEY, 'true');
    return (await Location.requestForegroundPermissionsAsync()).granted;
  })().finally(() => { permissionCheck = null; });
  return permissionCheck;
}

export async function getClockLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!await clockLocationPermission()) return null;
    // The GPS timeout starts after the person has answered the first OS dialog.
    return await resolveWithTimeout(async () => {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }, 3000, null);
  } catch {
    return null; // Callers retain their existing company geofence requirements.
  }
}

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}