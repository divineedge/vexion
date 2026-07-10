# Divine Edge OS

A multi-tenant field service management SaaS platform for irrigation, landscaping, and concrete businesses. Includes scheduling, customer/property management, inventory tracking, invoicing, time tracking, blueprint canvas, and financials.

## Run & Operate

- `pnpm --filter @workspace/divine-edge-os run dev` — run the frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter routing, TanStack Query, framer-motion, recharts, Tailwind CSS
- API: Express 5, multi-tenant via X-Tenant-Id / X-User-Id headers
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec in lib/api-spec/openapi.yaml)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (one file per domain)
- `artifacts/api-server/src/routes/` — Express route handlers (one file per domain)
- `artifacts/api-server/src/lib/tenantHelper.ts` — getTenantId / getUserId helpers
- `artifacts/divine-edge-os/src/` — React frontend
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod validation schemas (do not edit)

## Architecture decisions

- **Mock auth by design**: Phase 1 uses header-based tenant/user identification (X-User-Id, X-Tenant-Id). Three test profiles (Owner/Manager/Technician) selectable from the login page — no password verification. Intentional for rapid user flow testing.
- **Tenant isolation via getTenantId helper**: All routes call getTenantId(req) which reads X-Tenant-Id header. Default falls back to tenant 1 for mock profile testing.
- **OpenAPI-first**: All API contracts are defined in openapi.yaml before implementation. Run codegen after any spec changes.
- **Multi-tenant schema**: Every table has a `tenant_id` FK to the tenants table. All queries filter by tenantId.
- **Blueprint canvas uses SVG**: Interactive drawing tool is built in pure SVG + React state — no canvas element or third-party drawing library.

## Product

- **Dashboard** — KPI cards, revenue trend chart, jobs-by-status donut, recent activity feed
- **Customers** — Searchable list with pagination, customer detail with property list and job history
- **Properties** — Address management with geofence center pin override (drag/set)
- **Schedule** — Custom weekly/monthly calendar grid with drag-and-drop job blocks
- **Inventory** — Parts table with low-stock alerts, category filters, value summary
- **Financials** — Invoice management, revenue summary, one-click invoice-from-job
- **Daily Routines** — Recurring task management with sub-timer integration
- **Time Tracking** — Master Clock (clock in/out) + nested Sub-Timers per job/routine
- **Blueprints** — SVG canvas for irrigation/concrete/landscape mapping + parts estimate
- **Settings** — Company info, payment toggles (Stripe/QuickBooks), user management, custom fields, plan tiers

## Test Profiles (mock login)

1. **Mike Torres** — Company Owner, Enterprise (full access)
2. **Sarah Chen** — Office Manager, Professional (no Financials reporting, no super admin)
3. **Jake Rivera** — Technician, Starter (Schedule, Daily Routines, Time Tracking only)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, run `pnpm --filter @workspace/api-spec run codegen` before touching frontend or backend code
- Use `Partial<typeof table.$inferInsert>` for Drizzle update payloads — not `Record<string, unknown>` (causes TS2352)
- Express 5: wildcard routes need names (`/{*splat}`), params need explicit parsing (`parseInt(raw, 10)`), all async handlers need `: Promise<void>` annotation

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
