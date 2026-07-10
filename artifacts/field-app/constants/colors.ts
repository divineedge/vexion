/**
 * Semantic design tokens — synced from the divine-edge-os web artifact.
 * HSL values converted to hex for React Native StyleSheet compatibility.
 */

const colors = {
  light: {
    text: '#0f172a',
    tint: '#2563eb',

    background: '#ffffff',
    foreground: '#0f172a',

    card: '#ffffff',
    cardForeground: '#0f172a',

    primary: '#2563eb',
    primaryForeground: '#ffffff',

    secondary: '#f1f5f9',
    secondaryForeground: '#1e293b',

    muted: '#f1f5f9',
    mutedForeground: '#64748b',

    accent: '#f1f5f9',
    accentForeground: '#1e293b',

    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    border: '#e2e8f0',
    input: '#e2e8f0',

    // Status colors
    statusScheduled: '#3b82f6',
    statusInProgress: '#f59e0b',
    statusCompleted: '#22c55e',
    statusCancelled: '#94a3b8',
    statusOnHold: '#f97316',
  },

  dark: {
    text: '#f8fafc',
    tint: '#3b82f6',

    background: '#07111e',
    foreground: '#f8fafc',

    card: '#0d1b2e',
    cardForeground: '#f8fafc',

    primary: '#3b82f6',
    primaryForeground: '#ffffff',

    secondary: '#1e2d4a',
    secondaryForeground: '#e2e8f0',

    muted: '#1e2d4a',
    mutedForeground: '#94a3b8',

    accent: '#1e2d4a',
    accentForeground: '#e2e8f0',

    destructive: '#f87171',
    destructiveForeground: '#ffffff',

    border: '#1e2d4a',
    input: '#1e2d4a',

    // Status colors
    statusScheduled: '#60a5fa',
    statusInProgress: '#fbbf24',
    statusCompleted: '#4ade80',
    statusCancelled: '#64748b',
    statusOnHold: '#fb923c',
  },

  radius: 8,
};

export default colors;
