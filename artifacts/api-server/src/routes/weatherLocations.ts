import { Router } from "express";
import { db,tenantsTable } from "@workspace/db";
import { eq,sql } from "drizzle-orm";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { getCallerRole,isAdminRole } from "../lib/roles";
import { savedWeatherLocations,weatherLocationsInput } from "../lib/weatherLocations";

const router=Router();
router.get("/settings/weather-locations",async(req,res,next)=>{
  try{
    const tenantId=getTenantId(req);
    if(!["company_owner","office_manager","department_manager","crew_manager"].includes(await getCallerRole(tenantId,getUserId(req)))){
      res.status(403).json({error:"Admin or manager access required."});return;
    }
    const [tenant]=await db.select({locations:tenantsTable.scheduleWeatherLocations}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    res.json({locations:savedWeatherLocations(tenant?.locations)});
  }catch(error){next(error);}
});
router.put("/settings/weather-locations",async(req,res,next)=>{
  try{
    const tenantId=getTenantId(req);
    if(!await isAdminRole(tenantId,getUserId(req))){res.status(403).json({error:"Company admin access required."});return;}
    const input=weatherLocationsInput.safeParse(req.body);
    if(!input.success){res.status(400).json({error:input.error.issues[0]?.message??"Invalid forecast locations."});return;}
    // Raw JSON update avoids dropping a newly introduced jsonb field in older ORM mappings.
    await db.execute(sql`UPDATE tenants SET schedule_weather_locations=${JSON.stringify(input.data.locations)}::jsonb WHERE id=${tenantId}`);
    res.json(input.data);
  }catch(error){next(error);}
});
export default router;
