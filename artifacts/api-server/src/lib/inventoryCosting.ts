import {db,inventoryItemsTable,inventoryCostLotsTable,inventoryLocationStockTable,inventoryLocationsTable,inventoryTransfersTable,jobsTable,tenantsTable} from '@workspace/db';
import {and,eq,sql,desc,asc} from 'drizzle-orm';
import type {HrDb} from './hrAccess';
import {installInventoryKitSchema} from './inventoryKitSchema';
import {formatKitAmount,kitJobLine,onHandNeeded,planLinkedUse,roundKitQuantity} from './inventoryKits';
import {readKitRatio} from './inventoryKitStore';
import {resolveInventorySell} from './pipeStock';
import {stockOwnerId} from './inventoryDuplicate';
const fail=(message:string,status=400):never=>{throw Object.assign(new Error(message),{status});};
type Item=typeof inventoryItemsTable.$inferSelect;
type Allocation={lotId:number;quantity:number;unitCost:number};
type LocationUse={locationId:number|null;quantity:number};
export type StockUsage={legacyQuantity:number;legacyUnitCost:number;allocations:Allocation[];locations:LocationUse[];total:number};
export function publicParts(parts:unknown){return(Array.isArray(parts)?parts:[]).filter(part=>part&&typeof part==='object').map(({_stockUsage,_kitUsage,...part})=>part);}

export async function installInventoryCostSchema(){
 await db.execute(sql`CREATE TABLE IF NOT EXISTS inventory_cost_lots(
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
 expense_id integer REFERENCES expense_entries(id),received_quantity double precision NOT NULL,remaining_quantity double precision NOT NULL,
 unit_cost double precision NOT NULL,source text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS inventory_cost_lots_available ON inventory_cost_lots(tenant_id,inventory_item_id,unit_cost DESC,id) WHERE remaining_quantity>0`);
 await db.execute(sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS markup_pct real`);
 await db.execute(sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS stock_alerts boolean NOT NULL DEFAULT true`);
 await db.execute(sql`ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS volume_amount double precision`);
 await db.execute(sql`ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS volume_unit text`);
 // The quantity trigger blocks ALTER TYPE. Drop it, widen the column, then put the trigger back.
 await db.execute(sql`DROP TRIGGER IF EXISTS inventory_cost_opening ON inventory_items`);
 await db.execute(sql`DROP TRIGGER IF EXISTS inventory_cost_changes ON inventory_items`);
 await db.execute(sql`ALTER TABLE inventory_items ALTER COLUMN quantity TYPE double precision USING quantity::double precision`);
 await db.execute(sql`ALTER TABLE inventory_cost_lots ALTER COLUMN received_quantity TYPE double precision USING received_quantity::double precision`);
 await db.execute(sql`ALTER TABLE inventory_cost_lots ALTER COLUMN remaining_quantity TYPE double precision USING remaining_quantity::double precision`);
 await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION inventory_cost_layers() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE balance numeric; delta numeric; remaining numeric; taking numeric; lot record; highest double precision;
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
  -- Stock use and receipts adopt the highest remaining lot when the catalog price was not edited.
  -- A catalog save sets inventory.keep_catalog_price so the buy price the user saved stays,
  -- even when that price is the same number already stored and only the quantity changed.
  IF highest IS NOT NULL
     AND current_setting('inventory.keep_catalog_price', true) IS DISTINCT FROM 'on'
     AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
     AND NEW.marked_up_price IS NOT DISTINCT FROM OLD.marked_up_price THEN
   NEW.unit_price=highest;
  END IF;
  RETURN NEW;
 END $$`));
 await db.execute(sql`CREATE TRIGGER inventory_cost_opening AFTER INSERT ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_cost_layers()`);
 await db.execute(sql`CREATE TRIGGER inventory_cost_changes BEFORE UPDATE OF quantity,unit_price,marked_up_price ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_cost_layers()`);
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

function emptyUsage():StockUsage{return{legacyQuantity:0,legacyUnitCost:0,allocations:[],locations:[],total:0};}

/** Move one inventory item to a desired used quantity. The quantity is in that item's own unit.
 * A shared-stock copy deducts the owner's pile; the catalog row stays the job line. */
async function applyDesiredQuantity(tx:HrDb,tenantId:number,jobId:number,item:Item,desired:number,previous:StockUsage|null,stock:Item=item):Promise<StockUsage>{
 await ensureOpeningCost(tx,stock);
 const usage:StockUsage=previous?structuredClone(previous):emptyUsage();
 const desiredLegacy=Math.min(usage.legacyQuantity,desired);
 const delta=onHandNeeded(desired,usage.legacyQuantity,usage.allocations.reduce((n,a)=>n+a.quantity,0));
 if(delta>stock.quantity)fail(`Not enough stock for ${item.name}: need ${formatKitAmount(delta)} more ${item.unit||'units'}, have ${formatKitAmount(stock.quantity)} ${item.unit||'units'} on hand.`);
 if(delta>0){
  let remaining=delta;
  const lots=await tx.select().from(inventoryCostLotsTable).where(and(eq(inventoryCostLotsTable.tenantId,tenantId),eq(inventoryCostLotsTable.inventoryItemId,stock.id))).orderBy(desc(inventoryCostLotsTable.unitCost),asc(inventoryCostLotsTable.id)).for('update');
  for(const lot of lots){const take=Math.min(remaining,lot.remainingQuantity);if(take<=0)continue;
   await tx.update(inventoryCostLotsTable).set({remainingQuantity:lot.remainingQuantity-take}).where(eq(inventoryCostLotsTable.id,lot.id));
   usage.allocations.push({lotId:lot.id,quantity:take,unitCost:lot.unitCost});remaining-=take;if(!remaining)break;
  }
  if(remaining)fail('Stock cost records do not match the available inventory',409);
  const stocks=await tx.select().from(inventoryLocationStockTable).where(and(eq(inventoryLocationStockTable.tenantId,tenantId),eq(inventoryLocationStockTable.inventoryItemId,stock.id))).orderBy(asc(inventoryLocationStockTable.id)).for('update');
  const fraction=Number.isInteger(delta)?0:roundKitQuantity(delta-Math.floor(delta+1e-9));
  const locationGap=Math.max(0,stock.quantity-stocks.reduce((n,s)=>n+s.quantity,0));
  const unallocated=Math.min(delta,Math.max(locationGap,fraction));
  if(unallocated)usage.locations.push({locationId:null,quantity:unallocated});
  let toDeduct=delta-unallocated;
  for(const bin of stocks){const take=Math.min(toDeduct,bin.quantity);if(!take)continue;
   await tx.update(inventoryLocationStockTable).set({quantity:bin.quantity-take}).where(eq(inventoryLocationStockTable.id,bin.id));
   usage.locations.push({locationId:bin.locationId,quantity:take});toDeduct-=take;
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
   if(location.locationId!==null&&stillExists)await tx.insert(inventoryLocationStockTable).values({tenantId,inventoryItemId:stock.id,locationId:location.locationId,quantity:put}).onConflictDoUpdate({target:[inventoryLocationStockTable.tenantId,inventoryLocationStockTable.inventoryItemId,inventoryLocationStockTable.locationId],set:{quantity:sql`${inventoryLocationStockTable.quantity}+${put}`}});
   location.quantity-=put;remaining-=put;
  }
  usage.locations=usage.locations.filter(l=>l.quantity>0);
 }
 usage.legacyQuantity=desiredLegacy;
 usage.total=Math.round((desiredLegacy*usage.legacyUnitCost+usage.allocations.reduce((n,a)=>n+a.quantity*a.unitCost,0))*1e6)/1e6;
 if(delta){
  stock.quantity=stock.quantity-delta;
  await tx.update(inventoryItemsTable).set({quantity:stock.quantity,isLowStock:stock.stockAlerts!==false&&stock.quantity<=stock.reorderPoint}).where(eq(inventoryItemsTable.id,stock.id));
  await tx.insert(inventoryTransfersTable).values({tenantId,inventoryItemId:stock.id,quantity:Math.abs(delta),reason:`Job #${jobId} supplies ${delta>0?'used':'returned'}`});
 }
 return usage;
}

type StoredKitUse={inventoryItemId:number;name:string;quantity:number;unit:string;_stockUsage:StockUsage};

/** Replace the desired used quantity, not a delta; repeated submits cannot consume twice. */
export async function setJobPart(tenantId:number,jobId:number,itemId:number,quantity:number){
 if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000)fail('Enter a whole-number supply quantity from 0 to 1,000,000');
 await installInventoryKitSchema();
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-19001)`);
  const [job]=await tx.select().from(jobsTable).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,jobId))).for('update');
  if(!job)fail('Job not found',404);
  const parts=(Array.isArray(job.jobParts)?job.jobParts:[]) as any[];
  const old=parts.find(p=>p.inventoryItemId===itemId);
  const previousKit:StoredKitUse[]=Array.isArray(old?._kitUsage)?old._kitUsage:[];
  const kit=await readKitRatio(tx,tenantId,itemId);
  const componentIds=new Set<number>();
  for(const component of kit?.components??[])componentIds.add(component.inventoryItemId);
  for(const previous of previousKit)componentIds.add(previous.inventoryItemId);
  componentIds.delete(itemId);
  const lockIds=[itemId,...componentIds].sort((a,b)=>a-b);
  const locked=new Map<number,Item>();
  for(const id of lockIds){
   const [row]=await tx.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.tenantId,tenantId),eq(inventoryItemsTable.id,id))).for('update');
   if(row)locked.set(id,row);
  }
  const found=locked.get(itemId);
  if(!found){if(quantity===0&&old&&!old._stockUsage)return(await tx.update(jobsTable).set({jobParts:parts.filter(p=>p!==old)}).where(eq(jobsTable.id,jobId)).returning())[0];fail('Inventory item not found',404);}
  const item=found as Item;
  const ownerIds=[...new Set([stockOwnerId(item),...[...componentIds].flatMap(id=>{const row=locked.get(id);return row?[stockOwnerId(row)]:[];})])].filter(id=>!locked.has(id)).sort((a,b)=>a-b);
  for(const id of ownerIds){
   const [row]=await tx.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.tenantId,tenantId),eq(inventoryItemsTable.id,id))).for('update');
   if(row)locked.set(id,row);
  }
  const stockOf=(row:Item):Item=>{
   const owner=locked.get(stockOwnerId(row));
   if(!owner)fail('Shared stock item not found',409);
   return owner as Item;
  };
  const parentStock=stockOf(item);
  const [tenant]=await tx.select({defaultMarkupPct:tenantsTable.defaultMarkupPct}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  const sellOf=(row:Item)=>resolveInventorySell({cost:row.unitPrice,pricePerFoot:row.pricePerFoot,markedUpPrice:row.markedUpPrice,defaultMarkupPct:tenant?.defaultMarkupPct??20,itemMarkupPct:row.markupPct}).sellPrice;
  const starting:StockUsage=old?structuredClone(old._stockUsage??{legacyQuantity:old.quantity,legacyUnitCost:item.unitPrice,allocations:[],locations:[],total:old.quantity*item.unitPrice}):emptyUsage();
  const componentRows= [...componentIds].flatMap(id=>{
   const row=locked.get(id);
   if(!row)return [];
   const previous=previousKit.find(entry=>entry.inventoryItemId===id);
   const usage=previous?._stockUsage??emptyUsage();
   return [{
    inventoryItemId:id,
    name:row.name,
    unit:row.unit,
    onHand:stockOf(row).quantity,
    sellPrice:sellOf(row),
    legacyQuantity:usage.legacyQuantity??0,
    tracked:(usage.allocations??[]).reduce((n,a)=>n+a.quantity,0),
   }];
  });
  const plan=planLinkedUse({
   usedQuantity:quantity,
   parent:{
    inventoryItemId:item.id,
    name:item.name,
    unit:item.unit,
    onHand:parentStock.quantity,
    sellPrice:sellOf(item),
    legacyQuantity:starting.legacyQuantity,
    tracked:starting.allocations.reduce((n,a)=>n+a.quantity,0),
   },
   kit,
   components:componentRows,
  });
  if(plan.ok===false)fail(plan.message);
  const plannedLines=plan.ok?plan.lines:[];
  const combinedPrice=plan.ok?plan.combinedPrice:0;
  const pile=new Map<number,number>();
  const claim=(row:Item,desired:number,previous:StockUsage|null)=>{
   const owner=stockOf(row);
   const usage=previous??emptyUsage();
   const needed=onHandNeeded(desired,usage.legacyQuantity??0,(usage.allocations??[]).reduce((n,a)=>n+a.quantity,0));
   const have=pile.get(owner.id)??owner.quantity;
   if(needed>have)fail(`Not enough stock for ${row.name}: need ${formatKitAmount(needed)} more ${row.unit||'units'}, have ${formatKitAmount(have)} ${row.unit||'units'} on hand.`);
   pile.set(owner.id,have-needed);
  };
  claim(item,quantity,starting);
  for(const line of plannedLines){
   if(line.inventoryItemId===item.id)continue;
   const row=locked.get(line.inventoryItemId);
   if(!row)continue;
   const previous=previousKit.find(entry=>entry.inventoryItemId===line.inventoryItemId);
   claim(row,line.quantity,previous?._stockUsage??null);
  }
  const parentUsage=await applyDesiredQuantity(tx,tenantId,jobId,item,quantity,starting,parentStock);
  const storedKit:StoredKitUse[]=[];
  for(const line of plannedLines){
   if(line.inventoryItemId===item.id)continue;
   const row=locked.get(line.inventoryItemId);
   if(!row)continue;
   const previous=previousKit.find(entry=>entry.inventoryItemId===line.inventoryItemId);
   const usage=await applyDesiredQuantity(tx,tenantId,jobId,row,line.quantity,previous?._stockUsage??null,stockOf(row));
   if(line.quantity>0)storedKit.push({inventoryItemId:line.inventoryItemId,name:row.name,quantity:line.quantity,unit:row.unit,_stockUsage:usage});
  }
  if(storedKit.length)parentUsage.total=Math.round((parentUsage.total+storedKit.reduce((sum,component)=>sum+component._stockUsage.total,0))*1e6)/1e6;
  const priced=sellOf(item);
  const linked=storedKit.length>0;
  const linePrice=linked?kitJobLine(quantity,combinedPrice):null;
  const charged=linePrice?linePrice.unitPrice:(old?.unitPrice??priced);
  const total=linePrice?linePrice.total:charged*quantity;
  const part={
   inventoryItemId:item.id,
   name:old?.name??item.name,
   quantity,
   unitPrice:charged,
   unit:item.pricePerFoot!=null?'ft':(typeof old?.unit==='string'&&old.unit?old.unit:item.unit),
   total,
   _stockUsage:parentUsage,
   ...(storedKit.length?{
    _kitUsage:storedKit,
    kitComponents:storedKit.map(({_stockUsage,...component})=>component),
   }:{}),
  };
  return(await tx.update(jobsTable).set({jobParts:[...parts.filter(p=>p.inventoryItemId!==itemId),...(quantity?[part]:[])]}).where(eq(jobsTable.id,jobId)).returning())[0];
 });
}
