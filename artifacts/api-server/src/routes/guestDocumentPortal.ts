import { Router, type IRouter } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, activityLogTable, customersTable, estimatesTable, invoicesTable, jobsTable, propertiesTable, tenantsTable } from "@workspace/db";
import { ConfirmGuestDocumentPortalBody, GetGuestDocumentPortalResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const address = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");

/** The opaque document token is the only authority, never a portal/staff session or caller ID. */
export async function resolveGuestDocument(kind: string, token: string) {
  if (!["estimate", "invoice"].includes(kind) || !token || token.length > 256) return null;
  const [document] = kind === "estimate"
    ? await db.select().from(estimatesTable).where(eq(estimatesTable.approvalToken, token))
    : await db.select().from(invoicesTable).where(eq(invoicesTable.publicToken, token));
  if (!document || !document.customerId) return null;
  const [customer] = await db.select().from(customersTable).where(and(
    eq(customersTable.id, document.customerId), eq(customersTable.tenantId, document.tenantId),
  ));
  const [company] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, document.tenantId));
  if (!customer || !company) return null;
  const propertyIds = new Set<number>();
  if ("propertyId" in document && document.propertyId) propertyIds.add(document.propertyId);
  const items = Array.isArray(document.lineItems) ? document.lineItems : [];
  for (const item of items) {
    if (item && typeof item === "object" && "propertyId" in item && Number.isSafeInteger(item.propertyId) && Number(item.propertyId) > 0) {
      propertyIds.add(Number(item.propertyId));
    }
  }
  if (kind === "invoice") {
    const jobId = "jobId" in document ? document.jobId : null;
    const jobs = await db.select({ propertyId: jobsTable.propertyId }).from(jobsTable).where(and(
      eq(jobsTable.tenantId, document.tenantId), eq(jobsTable.customerId, customer.id),
      jobId ? or(eq(jobsTable.invoiceId, document.id), eq(jobsTable.id, jobId)) : eq(jobsTable.invoiceId, document.id),
    ));
    for (const job of jobs) if (job.propertyId) propertyIds.add(job.propertyId);
  }
  // Never return all of a customer's unrelated properties as a fallback.
  const properties = propertyIds.size ? await db.select({
    id: propertiesTable.id, address: propertiesTable.address, city: propertiesTable.city,
    state: propertiesTable.state, zip: propertiesTable.zip, lat: propertiesTable.lat,
    lng: propertiesTable.lng, measurementPolygons: propertiesTable.measurementPolygons,
  }).from(propertiesTable).where(and(
    eq(propertiesTable.tenantId, document.tenantId), eq(propertiesTable.customerId, customer.id),
    inArray(propertiesTable.id, [...propertyIds]),
  )) : [];
  return { document, customer, company, properties };
}

router.get("/public/document-portal/:kind/:token", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
  const scope = await resolveGuestDocument(req.params.kind, req.params.token);
  if (!scope) { res.status(404).json({ error: "Document link not found" }); return; }
  const { document, customer, company, properties } = scope;
  const showMeasurements = company.portalShowMeasurements !== false;
  const payload = {
    kind: req.params.kind, documentNumber: "invoiceNumber" in document ? document.invoiceNumber : String(document.id),
    companyName: company.name, logoUrl: company.logoUrl, companyPhone: company.businessPhone,
    customerName: customer.name, email: customer.email, phone: customer.phone,
    address: address(customer.billingAddress, customer.billingCity, customer.billingState, customer.billingZip),
    showMeasurements,
    properties: properties.map(p => ({
      id: p.id, address: address(p.address, p.city, p.state, p.zip), lat: p.lat, lng: p.lng,
      measurementZones: showMeasurements && Array.isArray(p.measurementPolygons) ? p.measurementPolygons : [],
    })),
  };
  // Legacy zones may omit defaulted fields. Expose only customer-safe geometry, never property notes.
  payload.properties = payload.properties.map(p => ({
    ...p, measurementZones: p.measurementZones.filter((z: unknown) => z && typeof z === "object").map((raw: unknown) => {
      const z = raw as Record<string, unknown>;
      return {
        id: String(z.id ?? ""), label: typeof z.label === "string" ? z.label : "Measured area",
        vertices: Array.isArray(z.vertices) ? z.vertices.filter((v: unknown) => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n))) : [],
        areaSqft: typeof z.areaSqft === "number" && Number.isFinite(z.areaSqft) ? z.areaSqft : 0,
        lengthFt: typeof z.lengthFt === "number" && Number.isFinite(z.lengthFt) ? z.lengthFt : null,
        mode: z.mode === "linear" ? "linear" : "area", enabled: z.enabled !== false,
        color: typeof z.color === "string" && /^#[0-9a-f]{3,8}$/i.test(z.color) ? z.color : "#16a34a",
      };
    }),
  }));
  res.json(GetGuestDocumentPortalResponse.parse(payload));
});

router.post("/public/document-portal/:kind/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const parsed = ConfirmGuestDocumentPortalBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmed !== true) {
    res.status(400).json({ error: "Please review and confirm your contact and property information." }); return;
  }
  const scope = await resolveGuestDocument(req.params.kind, req.params.token);
  if (!scope) { res.status(404).json({ error: "Document link not found" }); return; }
  const input = parsed.data;
  const allowed = scope.properties.map(p => p.id).sort((a,b) => a-b);
  const reviewed = [...new Set(input.propertyIds)].sort((a,b) => a-b);
  if (JSON.stringify(allowed) !== JSON.stringify(reviewed) ||
      (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))) {
    res.status(400).json({ error: "Review the properties shown and provide a valid email address, or leave it blank if none." }); return;
  }
  // A shared link is not proof of identity. Record proposed corrections for office review,
  // never overwrite the email/phone used for account authentication or saved property geometry.
  await db.insert(activityLogTable).values({
    tenantId: scope.document.tenantId, entityId: scope.customer.id, type: "customer_information_confirmation",
    message: `Guest link information review for ${req.params.kind} ${scope.document.id}: ${JSON.stringify({
      email: input.email.trim(), phone: input.phone.trim(), address: input.address.trim(),
      propertyIds: allowed, corrections: input.corrections?.trim() ?? "", source: "document_link_not_identity_verified",
    })}`,
  });
  res.json({ ok: true, message: "Your information review has been recorded. The office will review any corrections before changing your account." });
});

export default router;
