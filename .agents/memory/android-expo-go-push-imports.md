---
name: Android Expo Go push imports
description: How to keep Android Expo Go usable while retaining remote push support in installable builds.
---

Do not load code with `expo-notifications` remote-push side effects in Android Expo Go on SDK 53 or newer. Detect Expo Go before the notification module is imported, and skip only that lifecycle there; keep it enabled in development and standalone builds.

**Why:** Android remote push support was removed from Expo Go. Import-time auto-registration can throw before Expo Router evaluates the root layout, producing misleading follow-on errors such as a missing layout export or undefined error boundary.

**How to apply:** When adding or restructuring mobile notifications, ensure the Android Expo Go path never evaluates the push module. Validate secure and non-push flows in stock Expo Go, but test push registration and delivery in an installable development or production build.