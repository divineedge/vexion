import {db,expenseCategoriesTable,vendorsTable,expenseEntriesTable} from '@workspace/db';
import {eq,sql} from 'drizzle-orm';
import type {HrDb} from './hrAccess';
import { installVendorExpenseDefaultsSchema } from './vendorExpenseDefaults';

export const DEFAULT_EXPENSE_CATEGORIES=['supplies','fuel','equipment','insurance','payroll','rent','utilities','marketing','other'];
export const categoryLabel=(key:string)=>key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export async function installVendorCategoriesSchema(){
 await db.execute(sql`ALTER TABLE customer_plans ADD COLUMN IF NOT EXISTS visit_schedule jsonb`);
 await db.execute(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS plan_visit_index integer`);
 await db.execute(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS plan_visit_group_key text NOT NULL DEFAULT 'main',
   ADD COLUMN IF NOT EXISTS capacity_override_reason text, ADD COLUMN IF NOT EXISTS capacity_override_by integer,
   ADD COLUMN IF NOT EXISTS capacity_override_at timestamptz, ADD COLUMN IF NOT EXISTS email_reminder_enabled boolean NOT NULL DEFAULT true,
   ADD COLUMN IF NOT EXISTS push_reminder_enabled boolean NOT NULL DEFAULT false`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS jobs_plan_visit_group_slot ON jobs(plan_id,plan_visit_index,plan_visit_group_key) WHERE plan_visit_index IS NOT NULL`);
 await db.execute(sql`DROP INDEX IF EXISTS jobs_plan_visit_slot`);
 await db.execute(sql`ALTER TABLE crews ADD COLUMN IF NOT EXISTS daily_capacity_minutes integer NOT NULL DEFAULT 480,
   ADD COLUMN IF NOT EXISTS travel_buffer_minutes integer NOT NULL DEFAULT 15`);
 await db.execute(sql`ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS service_id integer, ADD COLUMN IF NOT EXISTS service_name text`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS customer_push_keys(tenant_id integer PRIMARY KEY REFERENCES tenants(id),public_key text NOT NULL,encrypted_private text NOT NULL)`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS customer_push_subscriptions(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),
   customer_id integer NOT NULL REFERENCES customers(id),endpoint text NOT NULL UNIQUE,keys jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
 await installVendorExpenseDefaultsSchema();
 await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_phone text`);
 await db.execute(sql`ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS shipping_amount real NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS capitalize_shipping boolean NOT NULL DEFAULT false`);
 await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS portal_show_measurements boolean NOT NULL DEFAULT true`);
 await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS document_link_destination text NOT NULL DEFAULT 'document'`);
 await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS automatic_invoice_payment_mode text NOT NULL DEFAULT 'manual'`);
 await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS automatic_payment_authorized_at timestamptz, ADD COLUMN IF NOT EXISTS payment_authorization_method_id text`);
 await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_default_payment_method_type text NOT NULL DEFAULT 'card'`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS invoice_card_attempts (
   invoice_id integer PRIMARY KEY REFERENCES invoices(id), tenant_id integer NOT NULL REFERENCES tenants(id),
   status text NOT NULL, attempt_key text NOT NULL, amount_cents integer NOT NULL,
   payment_method_id text, payment_intent_id text, checkout_session_id text, checkout_url text,
   error text, updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.execute(sql`ALTER TABLE invoice_card_attempts ADD COLUMN IF NOT EXISTS request_payload jsonb`);
 await db.execute(sql`ALTER TABLE invoice_card_attempts ADD COLUMN IF NOT EXISTS reserved_at timestamptz NOT NULL DEFAULT now()`);
 await db.execute(sql`ALTER TABLE invoice_card_attempts ADD COLUMN IF NOT EXISTS checkout_authorization_saved boolean NOT NULL DEFAULT false`);
 await db.execute(sql`ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS subtotal real,ADD COLUMN IF NOT EXISTS sales_tax_pct real NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS sales_tax_amount real NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS capitalize_sales_tax boolean NOT NULL DEFAULT false`);
 await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS office_phone text`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS expense_categories(tenant_id integer NOT NULL REFERENCES tenants(id),key text NOT NULL,name text NOT NULL,PRIMARY KEY(tenant_id,key))`);
 await db.execute(sql`ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
}
export async function listVendorCategories(tenantId:number,handle:HrDb=db,includeDeleted=false){
 const names=new Map(DEFAULT_EXPENSE_CATEGORIES.map(key=>[key,categoryLabel(key)]));
 const legacy=await handle.execute(sql`SELECT DISTINCT category FROM ${vendorsTable} WHERE tenant_id=${tenantId} AND category IS NOT NULL AND category<>'' UNION SELECT DISTINCT category FROM ${expenseEntriesTable} WHERE tenant_id=${tenantId} AND category<>''`);
 for(const row of legacy.rows){const key=String(row.category);names.set(key,categoryLabel(key));}
 const overrides=await handle.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.tenantId,tenantId));
 for(const row of overrides)names.set(row.key,row.name);
 return [...names].map(([key,name])=>({key,name,deletedAt:overrides.find(r=>r.key===key)?.deletedAt?.toISOString()??null})).filter(c=>includeDeleted||!c.deletedAt).sort((a,b)=>a.name.localeCompare(b.name));
}
