---
name: Divine Edge OS toaster mismatch
description: Why toast.success()/toast.error() calls silently did nothing in the divine-edge-os web app, and the fix.
---

`artifacts/divine-edge-os/src/App.tsx` originally imported `Toaster` from `@/components/ui/toaster`
(shadcn's own toast primitive, driven by a separate `useToast()` context), while every page in the
app calls `toast.success(...)` / `toast.error(...)` from the `sonner` package. Since sonner's own
`<Toaster />` (from `@/components/ui/sonner`) was never mounted, none of those calls rendered
anything — no error, just silence. This affected every save/mutation flow app-wide, not just one
feature.

**Why:** shadcn scaffolds both a `components/ui/toaster.tsx` (Radix-based) and a
`components/ui/sonner.tsx` (sonner wrapper) by default; only one should be mounted depending on
which `toast` import the app standardizes on. This app standardized on sonner in its page code but
mounted the wrong one in `App.tsx`.

**How to apply:** if a save/action in divine-edge-os appears to succeed (200 response, state
persists) but no confirmation toast appears, check that `App.tsx` mounts `Toaster` from
`@/components/ui/sonner`, not `@/components/ui/toaster`.
