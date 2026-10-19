import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, usersTable } from "@workspace/db";
import { GetScheduleWeatherQueryParams, GetScheduleWeatherResponse } from "@workspace/api-zod";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { loadScheduleForecast } from "../lib/scheduleWeather";

const router: IRouter = Router();
const forecastRoles = new Set(["company_owner", "office_manager", "department_manager", "crew_manager"]);

router.get("/schedule/weather", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const tenantId = getTenantId(req);
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(and(
    eq(usersTable.id, getUserId(req)), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true),
  ));
  if (!user || !forecastRoles.has(user.role)) {
    res.status(403).json({ error: "Only company admins and managers can view the scheduling forecast." }); return;
  }
  const params = GetScheduleWeatherQueryParams.safeParse(req.query);
  if (!params.success || !Number.isSafeInteger(params.data.propertyId)) {
    res.status(400).json({ error: "Choose a valid property for the weather forecast." }); return;
  }
  const [property] = await db.select({
    lat: propertiesTable.lat, lng: propertiesTable.lng, address: propertiesTable.address,
    city: propertiesTable.city, state: propertiesTable.state, timezone: tenantsTable.timezone,
  }).from(propertiesTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, propertiesTable.tenantId))
    .where(and(eq(propertiesTable.id, params.data.propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) {
    res.status(404).json({ error: "Property not found." }); return;
  }
  if (property.lat == null || property.lng == null || !Number.isFinite(property.lat) || !Number.isFinite(property.lng)
    || Math.abs(property.lat) > 90 || Math.abs(property.lng) > 180) {
    res.status(422).json({ error: "Set this property's map pin before loading its forecast." }); return;
  }
  try {
    const forecast = await loadScheduleForecast({
      tenantId, propertyId: params.data.propertyId, lat: property.lat, lng: property.lng,
      address: [property.address, property.city, property.state].filter(Boolean).join(", "),
      timezone: property.timezone,
    });
    res.json(GetScheduleWeatherResponse.parse(forecast));
  } catch (err) {
    req.log?.warn({ err }, "Scheduling forecast unavailable");
    res.status(503).json({ error: "The weather forecast is unavailable right now. Retry shortly; the crew schedule is still available." });
  }
});

export default router;
