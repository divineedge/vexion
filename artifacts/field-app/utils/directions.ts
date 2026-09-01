import { Alert, Linking } from 'react-native';

export async function openDirections(address: string): Promise<void> {
  const destination = encodeURIComponent(address.trim());
  if (!destination) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open directions', 'No maps application is available on this device.');
  }
}