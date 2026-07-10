import { Redirect } from 'expo-router';

// Tabs layout is unused — redirect to the main app
export default function TabsLayout() {
  return <Redirect href="/(app)/jobs" />;
}
