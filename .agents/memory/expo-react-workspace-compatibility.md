---
name: Expo and web React compatibility
description: Why the mobile SDK's React must be isolated from the web apps' React pins.
---

Allow the mobile app to use the exact React version required by its Expo SDK while retaining the web apps' existing React versions. Do not enforce one global React override across this workspace.

**Why:** Expo SDK upgrades can require a newer React minor than the web apps. A global override can silently replace Expo's required runtime even after `expo install --fix`; a version-range override can also rewrite broad peer requirements incorrectly. Upgrading every web app just to satisfy the mobile SDK unnecessarily expands risk.

**How to apply:** Check the actually resolved versions, not just dependency declarations. Ensure mobile bundling resolves React and its JSX runtimes consistently from the mobile app, including imports from shared libraries. Web apps must similarly deduplicate React to their own runtime. Validate Expo's dependency check, Doctor, and native exports after dependency changes.

Shared React context libraries also need a single web runtime, even when package versions match.

**Why:** pnpm can install React Query under different React peer snapshots for a web app and the shared API client. Development optimization can hide the duplicate, while production bundles create independent QueryClient contexts and crash before login with “No QueryClient set.”

**How to apply:** Deduplicate React Query to each web app's own dependency in Vite. Verify the built production entry, not only the development preview. Do not solve this by forcing Expo and web onto a global React override.
