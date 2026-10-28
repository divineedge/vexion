---
name: Clock location consent
description: One-time location setup and respectful permission recovery on field devices.
---
Do not ask for location permission at every clock-in. Check the current OS grant and remember whether the initial permission request has already been shown on that device.

**Why:** The user explicitly reports repeated location requests when clocking in and wants setup only once per device.

**How to apply:** Respect denials, expired one-time grants, and OS revocations rather than automatically reopening permission dialogs. Provide an explicit route to phone settings for recovery, recommending permission while using the app rather than “Allow once.” Never invent coordinates or bypass company geofence rules. OS permission resets and app reinstallations can require a new grant; the app cannot promise permanent OS permission.
