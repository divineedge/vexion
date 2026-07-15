---
name: Object storage ACL stamping fails at upload-URL mint time
description: POST /storage/uploads/request-url stamps an ACL on a freshly-minted object path before the client has uploaded anything, so the object doesn't exist yet.
---

`ObjectStorageService.trySetObjectEntityAclPolicy` internally calls `getObjectEntityFile`, which does a real `file.exists()` check against GCS and throws `ObjectNotFoundError` if the object isn't there yet. `POST /storage/uploads/request-url` (in `artifacts/api-server/src/routes/storage.ts`) calls this immediately after minting the signed upload URL — before the client's PUT ever happens — so the ACL stamp always fails there, and (until fixed) that failure took down the whole request-url response with a 500, breaking every file upload in the app (photos, PDFs, etc.), not just the feature being worked on.

**Why:** actual read authorization for uploaded files is enforced via a `mediaAttachmentsTable` row lookup (see `GET /storage/read-url` and `GET /storage/objects/*`), not via this ACL. The ACL stamp at mint time is best-effort defense-in-depth, so its `ObjectNotFoundError` must be swallowed rather than propagated.

**How to apply:** if any route calls `trySetObjectEntityAclPolicy` on a path that was *just* minted (not an already-uploaded object), wrap the call and catch `ObjectNotFoundError` specifically (rethrow anything else). Don't remove the ACL stamp attempt entirely — it still succeeds for calls made *after* upload completes (e.g. `settings.ts`'s logo-publish flow, which stamps ACL on an object it already verified exists).
