import {db,expenseCategoriesTable,vendorsTable,expenseEntriesTable} from '@workspace/db';
import {eq,sql} from 'drizzle-orm';
import type {HrDb} from './hrAccess';
import { installVendorExpenseDefaultsSchema } from './vendorExpenseDefaults';

export const DEFAULT_EXPENSE_CATEGORIES=['supplies','fuel','equipment','insurance','payroll','rent','utilities','marketing','other'];
export const categoryLabel=(key:string)=>key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export async function installVendorCategoriesSchema(){
 await installVendorExpenseDefaultsSchema();
 await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_phone text`);
 await db.execute(sql`ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS shipping_amount real NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS capitalize_shipping boolean NOT NULL DEFAULT false`);
 await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS portal_show_measurements boolean NOT NULL DEFAULT true`);
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
