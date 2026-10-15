import {db,inventoryItemsTable,inventoryCostLotsTable,inventoryLocationStockTable,inventoryLocationsTable,inventoryTransfersTable,jobsTable} from '@workspace/db';
import {and,eq,sql,desc,asc} from 'drizzle-orm';
import type {HrDb} from './hrAccess';
const fail=(message:string,status=400):never=>{throw Object.assign(new Error(message),{status});};
type Item=typeof inventoryItemsTable.$inferSelect;
type Allocation={lotId:number;quantity:number;unitCost:number};
type LocationUse={locationId:number|null;quantity:number};
export type StockUsage={legacyQuantity:number;legacyUnitCost:number;allocations:Allocation[];locations:LocationUse[];total:number};
export function publicParts(parts:unknown){return(Array.isArray(parts)?parts:[]).filter(part=>part&&typeof part==='object').map(({_stockUsage,...part})=>part);}

export async function installInventoryCostSchema(){
 await db.execute(sql`CREATE TABLE IF NOT EXISTS inventory_cost_lots(
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
 expense_id integer REFERENCES expense_entries(id),received_quantity integer NOT NULL,remaining_quantity integer NOT NULL,
 unit_cost double precision NOT NULL,source text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS inventory_cost_lots_available ON inventory_cost_lots(tenant_id,inventory_item_id,unit_cost DESC,id) WHERE remaining_quantity>0`);
 await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION inventory_cost_layers() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE balance integer; delta integer; remaining integer; taking integer; lot record; highest double precision; requested double precision; multiplier double precision;
 BEGIN
  IF TG_OP='INSERT' THEN
   IF NEW.quantity>0 THEN INSERT INTO inventory_cost_lots(tenant_id,inventory_item_id,received_quantity,remaining_quantity,unit_cost,source) VALUES(NEW.tenant_id,NEW.id,NEW.quantity,NEW.quantity,NEW.unit_price,'opening'); END IF;
   RETURN NEW;
  END IF;
  IF NEW.quantity<0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
  IF OLD.quantity>0 AND NOT EXISTS(SELECT 1 FROM inventory_cost_lots WHERE tenant_id=OLD.tenant_id AND inventory_item_id=OLD.id) THEN
   INSERT INTO inventory_cost_lots(tenant_id,inventory_item_id,received_quantity,remaining_quantity,unit_cost,source) VALUES(OLD.tenant_id,OLD.id,OLD.quantity,OLD.quantity,OLD.unit_price,'opening');
  END IF;
  SELECT COALESCE(SUM(remaining_quantity),0) INTO balance FROM inventory_cost_lots WHERE tenant_id=NEW.tenant_id AND inventory_item_id=NEW.id;
  delta=NEW.quantity-balance;
  IF delta>0 THEN
   INSERT INTO inventory_cost_lots(tenant_id,inventory_item_id,received_quantity,remaining_quantity,unit_cost,source) VALUES(NEW.tenant_id,NEW.id,delta,delta,NEW.unit_price,'adjustment');
  ELSIF delta<0 THEN
   remaining=-delta;
   FOR lot IN SELECT id,remaining_quantity FROM inventory_cost_lots WHERE tenant_id=NEW.tenant_id AND inventory_item_id=NEW.id AND remaining_quantity>0 ORDER BY unit_cost DESC,id FOR UPDATE LOOP
    taking=LEAST(remaining,lot.remaining_quantity);
    UPDATE inventory_cost_lots SET remaining_quantity=remaining_quantity-taking WHERE id=lot.id;
    remaining=remaining-taking; EXIT WHEN remaining=0;
   END LOOP;
  END IF;
  SELECT MAX(unit_cost) INTO highest FROM inventory_cost_lots WHERE tenant_id=NEW.tenant_id AND inventory_item_id=NEW.id AND remaining_quantity>0;
  IF highest IS NOT NULL THEN
   requested=NEW.unit_price;
   IF NEW.marked_up_price IS DISTINCT FROM OLD.marked_up_price THEN
    multiplier=CASE WHEN requested>0 THEN NEW.marked_up_price/requested WHEN OLD.unit_price>0 THEN OLD.marked_up_price/OLD.unit_price ELSE 1 END;
    NEW.marked_up_price=round((highest*multiplier)::numeric,2);
   END IF;
   NEW.unit_price=highest;
  END IF;
  RETURN NEW;
 END $$`));
 await db.execute(sql`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='inventory_cost_opening') THEN CREATE TRIGGER inventory_cost_opening AFTER INSERT ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_cost_layers(); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='inventory_cost_changes') THEN CREATE TRIGGER inventory_cost_changes BEFORE UPDATE OF quantity,unit_price,marked_up_price ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_cost_layers(); END IF;
 END $$`);
}
export async function ensureOpeningCost(tx:HrDb,item:Item){
 const [exists]=await tx.select({id:inventoryCostLotsTable.id}).from(inventoryCostLotsTable).where(and(eq(inventoryCostLotsTable.tenantId,item.tenantId),eq(inventoryCostLotsTable.inventoryItemId,item.id))).limit(1);
 if(!exists&&item.quantity>0)await tx.insert(inventoryCostLotsTable).values({tenantId:item.tenantId,inventoryItemId:item.id,receivedQuantity:item.quantity,remainingQuantity:item.quantity,unitCost:item.unitPrice,source:'opening'});
}
export async function receiveCostLot(tx:HrDb,item:Item,quantity:number,unitCost:number){
 await ensureOpeningCost(tx,item);
 return(await tx.insert(inventoryCostLotsTable).values({tenantId:item.tenantId,inventoryItemId:item.id,receivedQuantity:quantity,remainingQuantity:quantity,unitCost,source:'receipt'}).returning())[0];
}
export async function highestCost(tx:HrDb,tenantId:number,itemId:number,fallback:number){
 const r=await tx.execute(sql`SELECT MAX(unit_cost) AS cost FROM inventory_cost_lots WHERE tenant_id=${tenantId} AND inventory_item_id=${itemId} AND remaining_quantity>0`);
 return r.rows[0]?.cost==null?fallback:Number(r.rows[0].cost);
}

/** Replace the desired used quantity, not a delta; repeated submits cannot consume twice. */
export async function setJobPart(tenantId:number,jobId:number,itemId:number,quantity:number){
 if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000)fail('Enter a whole-number supply quantity from 0 to 1,000,000');
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-19001)`);
  const [job]=await tx.select().from(jobsTable).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,jobId))).for('update');
  if(!job)fail('Job not found',404);
  const parts=(Array.isArray(job.jobParts)?job.jobParts:[]) as any[];
  const old=parts.find(p=>p.inventoryItemId===itemId);
  const [item]=await tx.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.tenantId,tenantId),eq(inventoryItemsTable.id,itemId))).for('update');
  if(!item){if(quantity===0&&old&&!old._stockUsage)return(await tx.update(jobsTable).set({jobParts:parts.filter(p=>p!==old)}).where(eq(jobsTable.id,jobId)).returning())[0];fail('Inventory item not found',404);}
  await ensureOpeningCost(tx,item);
  const usage:StockUsage=old?structuredClone(old._stockUsage??{legacyQuantity:old.quantity,legacyUnitCost:item.unitPrice,allocations:[],locations:[],total:old.quantity*item.unitPrice}):{legacyQuantity:0,legacyUnitCost:0,allocations:[],locations:[],total:0};
  const desiredLegacy=Math.min(usage.legacyQuantity,quantity),tracked=usage.allocations.reduce((n,a)=>n+a.quantity,0);
  const delta=quantity-desiredLegacy-tracked;
  if(delta>item.quantity)fail('Not enough stock. Receive or adjust inventory before recording these supplies.');
  if(delta>0){
   let remaining=delta;
   const lots=await tx.select().from(inventoryCostLotsTable).where(and(eq(inventoryCostLotsTable.tenantId,tenantId),eq(inventoryCostLotsTable.inventoryItemId,itemId))).orderBy(desc(inventoryCostLotsTable.unitCost),asc(inventoryCostLotsTable.id)).for('update');
   for(const lot of lots){const take=Math.min(remaining,lot.remainingQuantity);if(take<=0)continue;
    await tx.update(inventoryCostLotsTable).set({remainingQuantity:lot.remainingQuantity-take}).where(eq(inventoryCostLotsTable.id,lot.id));
    usage.allocations.push({lotId:lot.id,quantity:take,unitCost:lot.unitCost});remaining-=take;if(!remaining)break;
   }
   if(remaining)fail('Stock cost records do not match the available inventory',409);
   const stocks=await tx.select().from(inventoryLocationStockTable).where(and(eq(inventoryLocationStockTable.tenantId,tenantId),eq(inventoryLocationStockTable.inventoryItemId,itemId))).orderBy(asc(inventoryLocationStockTable.id)).for('update');
   const unallocated=Math.min(delta,Math.max(0,item.quantity-stocks.reduce((n,s)=>n+s.quantity,0)));
   if(unallocated)usage.locations.push({locationId:null,quantity:unallocated});
   let toDeduct=delta-unallocated;
   for(const stock of stocks){const take=Math.min(toDeduct,stock.quantity);if(!take)continue;
    await tx.update(inventoryLocationStockTable).set({quantity:stock.quantity-take}).where(eq(inventoryLocationStockTable.id,stock.id));
    usage.locations.push({locationId:stock.locationId,quantity:take});toDeduct-=take;
   }
  }else if(delta<0){
   let remaining=-delta;
   for(let i=usage.allocations.length-1;i>=0&&remaining;i--){const a=usage.allocations[i],take=Math.min(remaining,a.quantity);
    await tx.update(inventoryCostLotsTable).set({remainingQuantity:sql`${inventoryCostLotsTable.remainingQuantity}+${take}`}).where(and(eq(inventoryCostLotsTable.tenantId,tenantId),eq(inventoryCostLotsTable.id,a.lotId)));
    a.quantity-=take;remaining-=take;
   }
   usage.allocations=usage.allocations.filter(a=>a.quantity>0);
   remaining=-delta;
   for(let i=usage.locations.length-1;i>=0&&remaining;i--){const location=usage.locations[i],put=Math.min(remaining,location.quantity);
    const stillExists=location.locationId===null?false:(await tx.select({id:inventoryLocationsTable.id}).from(inventoryLocationsTable).where(and(eq(inventoryLocationsTable.tenantId,tenantId),eq(inventoryLocationsTable.id,location.locationId))).limit(1)).length>0;
    // A removed location must not prevent a correction: restored units become unallocated.
    if(location.locationId!==null&&stillExists)await tx.insert(inventoryLocationStockTable).values({tenantId,inventoryItemId:itemId,locationId:location.locationId,quantity:put}).onConflictDoUpdate({target:[inventoryLocationStockTable.tenantId,inventoryLocationStockTable.inventoryItemId,inventoryLocationStockTable.locationId],set:{quantity:sql`${inventoryLocationStockTable.quantity}+${put}`}});
    location.quantity-=put;remaining-=put;
   }
   usage.locations=usage.locations.filter(l=>l.quantity>0);
  }
  usage.legacyQuantity=desiredLegacy;
  usage.total=Math.round((desiredLegacy*usage.legacyUnitCost+usage.allocations.reduce((n,a)=>n+a.quantity*a.unitCost,0))*1e6)/1e6;
  if(delta){
   await tx.update(inventoryItemsTable).set({quantity:item.quantity-delta,isLowStock:item.quantity-delta<=item.reorderPoint}).where(eq(inventoryItemsTable.id,itemId));
   await tx.insert(inventoryTransfersTable).values({tenantId,inventoryItemId:itemId,quantity:Math.abs(delta),reason:`Job #${jobId} supplies ${delta>0?'used':'returned'}`});
  }
  const part={inventoryItemId:item.id,name:old?.name??item.name,quantity,unitPrice:old?.unitPrice??item.markedUpPrice,total:(old?.unitPrice??item.markedUpPrice)*quantity,_stockUsage:usage};
  return(await tx.update(jobsTable).set({jobParts:[...parts.filter(p=>p.inventoryItemId!==itemId),...(quantity?[part]:[])]}).where(eq(jobsTable.id,jobId)).returning())[0];
 });
}
