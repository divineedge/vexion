---
name: Multi-tenant auth and signup
description: How business signup, login, employee management, and tenant isolation work
---

## The pattern

- `POST /api/auth/register` — creates a new tenant + company_owner user (bcrypt hash, min 8 chars)
- `POST /api/auth/login` — validates bcrypt password; legacy dev seed users have `passwordHash='mock'` and skip bcrypt check (any password accepted)
- Tenant isolation: every API route reads `x-tenant-id` and `x-user-id` headers via `getTenantId(req)` / `getUserId(req)` in tenantHelper.ts; these are set by the frontend after login via `setDefaultHeaders` from `@workspace/api-client-react`
- `POST /api/settings/users` — creates employee under the authenticated tenant; bcrypt-hashes password if provided, falls back to 'mock' otherwise
- `PATCH /api/settings/users/:id` — supports `password` field to set/change employee login password

## Frontend

- `AuthContext.tsx` uses `User` type from `@workspace/api-client-react` (not MockUser); stores user in localStorage; calls `setDefaultHeaders` with tenantId and userId on every login/restore
- Login page (`/login`) uses the generated `useLogin` hook; routes technicians to `/schedule`, everyone else to `/dashboard`
- Signup page (`/signup`) uses `customFetch('/api/auth/register', ...)` directly (no generated hook)
- Settings → Team tab already has full user CRUD (`useListUsers`, `useCreateUser`, `useUpdateUser`, `useDeleteUser`); password field added to "Add Team Member" sheet

## Dev seed users

- All have `passwordHash='mock'` — they can log in with any password, preserving the existing dev workflow
- Tenant 1 = Torres Field Services (the existing seed tenant)

**Why:** The `x-tenant-id` header approach means no session middleware changes were needed; new tenants get full isolation simply by having a different tenantId in their session.
