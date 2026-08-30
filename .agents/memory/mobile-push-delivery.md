---
name: Mobile push delivery
description: Reliability rules for Expo push notification delivery and device lifecycle.
---

Claim each semantic notification event once per active device before sending, and persist the Expo ticket ID so delayed receipts can be reconciled.

**Why:** Business mutations and network requests can retry, while Expo often reports `DeviceNotRegistered` only in a later receipt. Without a durable per-device event key, retries duplicate alerts; without receipt processing, dead tokens remain active indefinitely.

**How to apply:** Use stable event keys for mutation retries but include the assignment event version for later reassignments. Retry transient send failures, poll receipts in bounded batches, and disable devices on permanent token errors.