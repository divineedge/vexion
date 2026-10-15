import {db,expenseCategoriesTable,vendorsTable,expenseEntriesTable} from '@workspace/db';
import {eq,sql} from 'drizzle-orm';
import type {HrDb} from './hrAccess';

export const DEFAULT_EXPENSE_CATEGORIES=['supplies','fuel','equipment','insurance','payroll','rent','utilities','marketing','other'];
export const categoryLabel=(key:string)=>key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export async function installVendorCategoriesSchema(){
 await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS office_phone text`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS expense_categories(tenant_id integer NOT NULL REFERENCES tenants(id),key text NOT NULL,name text NOT NULL,PRIMARY KEY(tenant_id,key))`);
}
export async function listVendorCategories(tenantId:number,handle:HrDb=db){
 const names=new Map(DEFAULT_EXPENSE_CATEGORIES.map(key=>[key,categoryLabel(key)]));
 const legacy=await handle.execute(sql`SELECT DISTINCT category FROM ${vendorsTable} WHERE tenant_id=${tenantId} AND category IS NOT NULL AND category<>'' UNION SELECT DISTINCT category FROM ${expenseEntriesTable} WHERE tenant_id=${tenantId} AND category<>''`);
 for(const row of legacy.rows){const key=String(row.category);names.set(key,categoryLabel(key));}
 const overrides=await handle.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.tenantId,tenantId));
 for(const row of overrides)names.set(row.key,row.name);
 return [...names].map(([key,name])=>({key,name})).sort((a,b)=>a.name.localeCompare(b.name));
}
