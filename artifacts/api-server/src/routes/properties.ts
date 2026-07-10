import { Router, type IRouter } from "express";
import { db, propertiesTable, customersTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatProperty(p: typeof propertiesTable.$inferSelect, customerName?: string | null) {
  return {
    ...p,
    customerName: customerName ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/properties", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, q } = req.query as Record<string, string>;

  let baseWhere = eq(propertiesTable.tenantId, tenantId);
  if (customerId) {
    const cid = parseInt(customerId, 10);
    baseWhere = and(baseWhere, eq(propertiesTable.customerId, cid)) as typeof baseWhere;
  }
  if (q) {
    baseWhere = and(baseWhere, ilike(propertiesTable.address, `%${q}%`)) as typeof baseWhere;
  }

  const rows = await db
    .select({
      property: propertiesTable,
      customerName: customersTable.name,
    })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(baseWhere)
    .orderBy(propertiesTable.createdAt);

  res.json(rows.map(r => formatProperty(r.property, r.customerName)));
});

router.post("/properties", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, address, city, state, zip, lat, lng, notes, type } = req.body;
  if (!customerId || !address) {
    res.status(400).json({ error: "customerId and address are required" });
    return;
  }

  const [property] = await db.insert(propertiesTable).values({
    tenantId,
    customerId: parseInt(customerId, 10),
    address,
    city: city ?? null,
    state: state ?? null,
    zip: zip ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    notes: notes ?? null,
    type: type ?? null,
  }).returning();

  res.status(201).json(formatProperty(property));
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ property: propertiesTable, customerName: customersTable.name })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatProperty(row.property, row.customerName));
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { address, city, state, zip, lat, lng, notes, type } = req.body;
  const [updated] = await db.update(propertiesTable)
    .set({ ...(address && { address }), ...(city !== undefined && { city }), ...(state !== undefined && { state }), ...(zip !== undefined && { zip }), ...(lat !== undefined && { lat }), ...(lng !== undefined && { lng }), ...(notes !== undefined && { notes }), ...(type !== undefined && { type }) })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatProperty(updated, row?.customerName));
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.patch("/properties/:id/geofence", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { lat, lng, radius } = req.body;

  const [updated] = await db.update(propertiesTable)
    .set({ geofenceLat: lat, geofenceLng: lng, ...(radius && { geofenceRadius: radius }) })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatProperty(updated, row?.customerName));
});

export default router;
