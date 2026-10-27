---
name: Modal retry drafts
description: Preserve submitted work when validation dialogs temporarily dismiss an editor.
---
Keep a separate snapshot of the complete submitted draft for validation retries, not just the field being corrected.

**Why:** Opening a capacity warning can dismiss the underlying job sheet and clear its editable state. Retrying from that state lost the date and customer associations and caused an invalid-date crash.

**How to apply:** Prevent parent-editor resets while a child warning is active, but also retain the submitted draft independently. Correction and override retries should reuse that draft, changing only the explicitly corrected values. Returning to edit should restore it. Verify the rejected-request-to-successful-retry path, including unchanged date, property, customer, and assignment.
