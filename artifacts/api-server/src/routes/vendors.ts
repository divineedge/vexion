import { Router, type IRouter } from "express";
import { db, vendorsTable,expenseCategoriesTable } from "@workspace/db";
import { eq, and,sql } from "drizzle-orm";
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {listVendorCategories} from '../lib/vendorCategories';
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();
const vendorFields=z.object({name:z.string().trim().min(1).max(200),category:z.string().max(200).optional(),contact:z.string().max(2000).optional(),contactName:z.string().trim().max(200).optional(),officePhone:z.string().trim().max(80).optional(),contactPhone:z.string().trim().max(80).optional(),notes:z.string().max(20000).optional()});

router.use('/expense-categories',async(req,res,next)=>{
 if(!await isAdminRole(getTenantId(req),getUserId(req))){res.status(403).json({error:'Restricted to owner/admin roles'});return;}next();
});
router.get('/expense-categories',async(req,res)=>{res.json(await listVendorCategories(getTenantId(req),db,req.query.includeDeleted==='true'));});
router.delete('/expense-categories/:key',async(req,res)=>{
 const tenantId=getTenantId(req),key=String(req.params.key);
 if(key==='other'){res.status(400).json({error:'Other is needed as the fallback category and cannot be deleted'});return;}
 const found=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-91045)`);
  const category=(await listVendorCategories(tenantId,tx,true)).find(c=>c.key===key);
  if(!category)return false;
  if(!category.deletedAt){
   await tx.insert(expenseCategoriesTable).values({tenantId,key,name:category.name,deletedAt:new Date()}).onConflictDoUpdate({target:[expenseCategoriesTable.tenantId,expenseCategoriesTable.key],set:{deletedAt:new Date()}});
   await tx.update(vendorsTable).set({category:'other'}).where(and(eq(vendorsTable.tenantId,tenantId),eq(vendorsTable.category,key)));
  }return true;
 });
 if(!found){res.status(404).json({error:'Category not found'});return;}res.sendStatus(204);
});
router.post('/expense-categories',async(req,res)=>{await saveCategory(req,res);});
router.patch('/expense-categories/:key',async(req,res)=>{await saveCategory(req,res,String(req.params.key));});
async function saveCategory(req:import('express').Request,res:import('express').Response,key?:string){
 const parsed=z.object({name:z.string().trim().min(1).max(100)}).safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Enter a category name (1–100 characters)'});return;}
 const tenantId=getTenantId(req),name=parsed.data.name;
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-91045)`);
  const all=await listVendorCategories(tenantId,tx);
  if(key&&!all.some(c=>c.key===key))return {status:404,error:'Category not found'};
  if(all.some(c=>c.key!==key&&c.name.toLowerCase()===name.toLowerCase()))return {status:409,error:'A category with that name already exists'};
  const savedKey=key??`custom_${randomUUID()}`;
  const [saved]=await tx.insert(expenseCategoriesTable).values({tenantId,key:savedKey,name}).onConflictDoUpdate({target:[expenseCategoriesTable.tenantId,expenseCategoriesTable.key],set:{name}}).returning();
  return {saved};
 });
 if('error'in result){res.status(result.status!).json({error:result.error});return;}
 res.status(key?200:201).json({key:result.saved.key,name:result.saved.name});
}

function fmt(v: typeof vendorsTable.$inferSelect) {
  return { ...v, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() };
}

router.get("/vendors", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const rows = await db.select().from(vendorsTable).where(eq(vendorsTable.tenantId, tenantId)).orderBy(vendorsTable.name);
  res.json(rows.map(fmt));
});

router.get("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [v] = await db.select().from(vendorsTable).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId)));
  if (!v) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(v));
});

router.post("/vendors", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const parsed=vendorFields.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Enter a vendor name and valid contact details'});return;}
  const { name, category, contact, notes,contactName,officePhone,contactPhone } = parsed.data;
  if(category&&!(await listVendorCategories(tenantId)).some(c=>c.key===category)){res.status(400).json({error:'Choose an existing category or add it using Manage categories'});return;}
  const [v] = await db.insert(vendorsTable).values({
    tenantId, name, category: category ?? null, contact: contact ?? null, notes: notes ?? null,contactName:contactName??null,officePhone:officePhone??null,contactPhone:contactPhone??null,
  }).returning();
  res.status(201).json(fmt(v));
});

router.patch("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const parsed=vendorFields.partial().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Enter valid vendor and contact details'});return;}
  const { name, category, contact, notes,contactName,officePhone,contactPhone } = parsed.data;
  if(category&&!(await listVendorCategories(tenantId)).some(c=>c.key===category)){res.status(400).json({error:'Choose an existing category or add it using Manage categories'});return;}
  const update: Partial<typeof vendorsTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (category !== undefined) update.category = category;
  if (contact !== undefined) update.contact = contact;
  if (notes !== undefined) update.notes = notes;
  if(contactName!==undefined)update.contactName=contactName;
  if(officePhone!==undefined)update.officePhone=officePhone;
  if(contactPhone!==undefined)update.contactPhone=contactPhone;
  if(!Object.keys(update).length){res.status(400).json({error:'No vendor changes supplied'});return;}

  const [updated] = await db.update(vendorsTable).set(update).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  await db.delete(vendorsTable).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
