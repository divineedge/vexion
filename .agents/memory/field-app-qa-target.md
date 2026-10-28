---
name: Field App QA API target
description: Keep mobile-preview testing isolated when its configured API points at the published application.
---
Check the mobile preview's actual API request origin before assuming a rejected synthetic login means the development fixture is broken.

**Why:** The Expo preview can be configured to call the published API. A correctly activated development fixture then receives a production 401 even though development authentication succeeds.

**How to apply:** Do not change the app's configured backend or seed production just to run browser tests. An isolated testing-browser route can forward all API requests to the real development API while preserving the application configuration. Clearly distinguish this development verification from native-device or production testing, and deactivate synthetic accounts afterward.
