---
name: Vendor and expense category behavior
description: Shared company category names, vendor defaults, overrides, and preserving financial classification history
---
Vendor and expense categories share company-managed names. Choosing a vendor should fill the initial expense category, but staff can override it for an individual expense. Opening an old expense must not reclassify it merely because the vendor's default changed.

**Why:** The user wants to choose vendors first, inherit their category, and add or rename category names. Existing business and financial records must remain intact.

**How to apply:** Treat vendor categories as defaults, not mandatory classifications. Keep category keys stable when names change, especially built-in keys used by financial calculations. Preserve legacy category values and existing vendor contact information when adding structured contact-name and office-phone fields.

Deleting a category removes it from future choices, not historical expenses. Retain its last label for reports, move affected vendor defaults to Other, and keep Other available.

**Why:** The user wants to delete categories without losing or silently reclassifying recorded spending.

**How to apply:** Keep historical classification keys and labels readable even when their category is no longer selectable.
