import { Alert, Linking } from 'react-native';

export async function openDirections(address: string, lat?: number | null, lng?: number | null): Promise<void> {
  const hasPin = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const destination = encodeURIComponent(hasPin ? `${lat},${lng}` : address.trim());
  if (!destination) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open directions', 'No maps application is available on this device.');
  }
}