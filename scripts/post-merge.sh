#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db exec node --input-type=module -e 'import pg from "pg"; import fs from "node:fs"; const client = new pg.Client({connectionString:process.env.DATABASE_URL}); await client.connect(); try { await client.query(fs.readFileSync("drizzle/0088_form_evidence.sql","utf8")); } finally { await client.end(); }'
pnpm --filter @workspace/db --fail-if-no-match run push
pnpm --filter @workspace/db exec node --input-type=module -e 'import pg from "pg"; import fs from "node:fs"; const client = new pg.Client({connectionString:process.env.DATABASE_URL}); await client.connect(); try { await client.query(fs.readFileSync("drizzle/0082_payroll_snapshots.sql","utf8")); } finally { await client.end(); }'
