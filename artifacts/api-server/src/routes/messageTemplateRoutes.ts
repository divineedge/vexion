import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "crypto";
import {
  db, tenantsTable, servicesTable, customersTable, propertiesTable, estimatesTable, communicationsLogTable,
  broadcastTemplatesTable, communicationTemplatesTable, websiteFormTemplatesTable, websiteFormSubmissionsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { resolveRecipients, type BroadcastFilter } from "./broadcasts";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { intakeApplication } from "../lib/hiring";
import { HrError } from "../lib/hrAccess";
import {
  COMMUNICATION_CATEGORIES, normalizeAudience, normalizeFormFields, renderMergeTags, validateFormAnswers,
  TemplateInputError, type FormField,
} from "../lib/messageTemplates";

const router: IRouter = Router();
export const publicFormTemplateRouter: IRouter = Router();

function fail(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof TemplateInputError || error instanceof HrError) {
    res.status((error instanceof HrError ? error.status : 400)).json({ error: error.message });
    return;
  }
  const code = (error as { code?: string }).code;
  if (code === "23505") { res.status(409).json({ error: "A form with that link name already exists." }); return; }
  next(error);
}

async function admin(req: Request, res: Response) {
  if (!(await isAdminRole(getTenantId(req), getUserId(req)))) {
    res.status(403).json({ error: "Restricted to owner/admin roles" });
    return false;
  }
  return true;
}

function channelOf(value: unknown) {
  if (value !== "sms" && value !== "email") throw new TemplateInputError("Choose email or SMS.");
  return value;
}

function textOf(value: unknown, label: string, max: number, required = true) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new TemplateInputError(`${label} is required.`);
  if (text.length > max) throw new TemplateInputError(`${label} is too long.`);
  return text || null;
}

router.get("/broadcast-templates", async (req, res) => {
  const rows = await db.select().from(broadcastTemplatesTable).where(eq(broadcastTemplatesTable.tenantId, getTenantId(req))).orderBy(desc(broadcastTemplatesTable.updatedAt));
  res.json(rows);
});

router.post("/broadcast-templates", async (req, res) => {
  if (!(await admin(req, res))) return;
  const channel = channelOf(req.body.channel);
  const [row] = await db.insert(broadcastTemplatesTable).values({
    tenantId: getTenantId(req),
    name: textOf(req.body.name, "Template name", 120)!,
    channel,
    subject: channel === "email" ? textOf(req.body.subject, "Subject", 200) : null,
    body: textOf(req.body.body, "Message", 20000)!,
  }).returning();
  res.status(201).json(row);
});

router.patch("/broadcast-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [current] = await db.select().from(broadcastTemplatesTable).where(and(eq(broadcastTemplatesTable.id, Number(req.params.id)), eq(broadcastTemplatesTable.tenantId, getTenantId(req))));
  if (!current) { res.status(404).json({ error: "Template not found" }); return; }
  const channel = req.body.channel == null ? current.channel : channelOf(req.body.channel);
  const [row] = await db.update(broadcastTemplatesTable).set({
    name: req.body.name == null ? current.name : textOf(req.body.name, "Template name", 120)!,
    channel,
    subject: channel === "email" ? (req.body.subject == null ? current.subject : textOf(req.body.subject, "Subject", 200)) : null,
    body: req.body.body == null ? current.body : textOf(req.body.body, "Message", 20000)!,
    updatedAt: new Date(),
  }).where(eq(broadcastTemplatesTable.id, current.id)).returning();
  res.json(row);
});

router.delete("/broadcast-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [row] = await db.delete(broadcastTemplatesTable).where(and(eq(broadcastTemplatesTable.id, Number(req.params.id)), eq(broadcastTemplatesTable.tenantId, getTenantId(req)))).returning({ id: broadcastTemplatesTable.id });
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.sendStatus(204);
});

router.get("/communication-templates", async (req, res) => {
  const rows = await db.select().from(communicationTemplatesTable).where(eq(communicationTemplatesTable.tenantId, getTenantId(req))).orderBy(communicationTemplatesTable.category, communicationTemplatesTable.name);
  res.json(rows);
});

router.post("/communication-templates", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [row] = await db.insert(communicationTemplatesTable).values({ tenantId: getTenantId(req), ...communicationBody(req.body) }).returning();
  res.status(201).json(row);
});

router.patch("/communication-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [current] = await db.select().from(communicationTemplatesTable).where(and(eq(communicationTemplatesTable.id, Number(req.params.id)), eq(communicationTemplatesTable.tenantId, getTenantId(req))));
  if (!current) { res.status(404).json({ error: "Template not found" }); return; }
  const [row] = await db.update(communicationTemplatesTable).set({ ...communicationBody({ ...current, ...req.body }), updatedAt: new Date() }).where(eq(communicationTemplatesTable.id, current.id)).returning();
  res.json(row);
});

router.delete("/communication-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [row] = await db.delete(communicationTemplatesTable).where(and(eq(communicationTemplatesTable.id, Number(req.params.id)), eq(communicationTemplatesTable.tenantId, getTenantId(req)))).returning({ id: communicationTemplatesTable.id });
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.sendStatus(204);
});

function communicationBody(body: Record<string, unknown>) {
  const channel = channelOf(body.channel);
  const category = String(body.category ?? "");
  if (!(COMMUNICATION_CATEGORIES as readonly string[]).includes(category)) throw new TemplateInputError("Choose a communication category.");
  return {
    name: textOf(body.name, "Template name", 120)!,
    channel,
    category,
    subject: channel === "email" ? textOf(body.subject, "Subject", 200) : null,
    body: textOf(body.body, "Message", 20000)!,
  };
}

router.post("/communication-templates/preview", async (req, res) => {
  if (!(await admin(req, res))) return;
  const channel = channelOf(req.body.channel);
  const recipients = await resolveRecipients(getTenantId(req), channel, audienceFilter(req.body.audience));
  res.json({ count: recipients.length, sample: recipients.slice(0, 10).map(customer => ({ id: customer.id, name: customer.name, contact: channel === "sms" ? customer.phone : customer.email })) });
});

router.post("/communication-templates/:id/send", async (req, res) => {
  if (!(await admin(req, res))) return;
  const tenantId = getTenantId(req);
  const [template] = await db.select().from(communicationTemplatesTable).where(and(eq(communicationTemplatesTable.id, Number(req.params.id)), eq(communicationTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  const filter = audienceFilter(req.body.audience);
  const recipients = await resolveRecipients(tenantId, template.channel as "sms" | "email", filter);
  if (!recipients.length) { res.status(400).json({ error: "No customers match this audience." }); return; }
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const properties = await db.select({ customerId: propertiesTable.customerId, address: propertiesTable.address }).from(propertiesTable).where(and(eq(propertiesTable.tenantId, tenantId), inArray(propertiesTable.customerId, recipients.map(customer => customer.id))));
  const addressByCustomer = new Map(properties.map(property => [property.customerId, property.address]));
  let serviceName = "";
  if (filter.serviceId) {
    const [service] = await db.select({ name: servicesTable.name }).from(servicesTable).where(and(eq(servicesTable.id, filter.serviceId), eq(servicesTable.tenantId, tenantId)));
    serviceName = service?.name ?? "";
  }
  let sent = 0;
  let failed = 0;
  for (const customer of recipients) {
    const values = {
      customer_first_name: customer.name.split(" ")[0] ?? customer.name,
      property_address: addressByCustomer.get(customer.id) ?? customer.physicalAddress ?? customer.billingAddress ?? "",
      service_name: serviceName,
      company_name: tenant?.name ?? "",
    };
    const body = renderMergeTags(template.body, values);
    const subject = renderMergeTags(template.subject ?? "", values);
    const result = template.channel === "sms"
      ? await sendSms(smsConfig(tenant), customer.phone, body)
      : await sendEmail(emailConfig(tenant), customer.email, subject, body);
    await db.insert(communicationsLogTable).values({
      tenantId, customerId: customer.id, direction: "outbound", channel: template.channel,
      toAddress: template.channel === "sms" ? customer.phone : customer.email,
      subject: template.channel === "email" ? subject : null, body,
      status: result.success ? "sent" : "failed", externalId: result.externalId ?? null, errorNote: result.error ?? null,
      messageType: "template",
    });
    result.success ? sent++ : failed++;
  }
  res.json({ sent, failed, count: recipients.length });
});

function audienceFilter(input: unknown): BroadcastFilter {
  return normalizeAudience(input);
}

function smsConfig(tenant: typeof tenantsTable.$inferSelect | undefined): SmsProviderConfig {
  return {
    platform: (tenant?.phonePlatform as SmsProviderConfig["platform"]) ?? null,
    config: (tenant?.phonePlatformConfig as Record<string, string>) ?? {},
    fromNumber: tenant?.mainPhoneNumber ?? tenant?.marketingPhoneNumber ?? null,
  };
}
function emailConfig(tenant: typeof tenantsTable.$inferSelect | undefined): EmailProviderConfig {
  return {
    provider: (tenant?.emailProvider as EmailProviderConfig["provider"]) ?? null,
    config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
    fromAddress: (tenant?.emailProviderConfig as Record<string, string> | null)?.fromAddress ?? null,
  };
}

function slugify(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return slug || "form";
}

router.get("/website-form-templates", async (req, res) => {
  const rows = await db.select().from(websiteFormTemplatesTable).where(eq(websiteFormTemplatesTable.tenantId, getTenantId(req))).orderBy(desc(websiteFormTemplatesTable.updatedAt));
  res.json(rows.map(formLinks));
});

router.post("/website-form-templates", async (req, res) => {
  if (!(await admin(req, res))) return;
  const draft = formDraft(req.body);
  const [row] = await db.insert(websiteFormTemplatesTable).values({
    tenantId: getTenantId(req),
    embedToken: randomBytes(18).toString("base64url"),
    ...draft,
    slug: slugify(String(req.body.slug || draft.name)),
  }).returning();
  res.status(201).json(formLinks(row));
});

router.patch("/website-form-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [current] = await db.select().from(websiteFormTemplatesTable).where(and(eq(websiteFormTemplatesTable.id, Number(req.params.id)), eq(websiteFormTemplatesTable.tenantId, getTenantId(req))));
  if (!current) { res.status(404).json({ error: "Form not found" }); return; }
  const draft = formDraft({ ...current, fields: current.fields, ...req.body });
  const [row] = await db.update(websiteFormTemplatesTable).set({
    ...draft,
    slug: req.body.slug == null ? current.slug : slugify(String(req.body.slug)),
    updatedAt: new Date(),
  }).where(eq(websiteFormTemplatesTable.id, current.id)).returning();
  res.json(formLinks(row));
});

router.delete("/website-form-templates/:id", async (req, res) => {
  if (!(await admin(req, res))) return;
  const [used] = await db.select({ id: websiteFormSubmissionsTable.id }).from(websiteFormSubmissionsTable).where(and(eq(websiteFormSubmissionsTable.formId, Number(req.params.id)), eq(websiteFormSubmissionsTable.tenantId, getTenantId(req)))).limit(1);
  if (used) { res.status(409).json({ error: "This form has submissions. Unpublish it instead of deleting it." }); return; }
  const [row] = await db.delete(websiteFormTemplatesTable).where(and(eq(websiteFormTemplatesTable.id, Number(req.params.id)), eq(websiteFormTemplatesTable.tenantId, getTenantId(req)))).returning({ id: websiteFormTemplatesTable.id });
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  res.sendStatus(204);
});

function formDraft(body: Record<string, unknown>) {
  const purpose = body.purpose === "hiring" ? "hiring" : body.purpose === "quote" ? "quote" : null;
  if (!purpose) throw new TemplateInputError("Choose a quote form or a hiring form.");
  const serviceId = purpose === "quote" && body.serviceId != null && body.serviceId !== "" ? Number(body.serviceId) : null;
  if (serviceId != null && (!Number.isSafeInteger(serviceId) || serviceId <= 0)) throw new TemplateInputError("Choose a valid service.");
  return {
    name: textOf(body.name, "Form name", 120)!,
    purpose,
    serviceId,
    fields: normalizeFormFields(body.fields),
    published: body.published === true,
  };
}

function formLinks(row: typeof websiteFormTemplatesTable.$inferSelect) {
  return {
    ...row,
    fields: (row.fields as FormField[]) ?? [],
    publicPath: `/f/${row.embedToken}`,
    iframe: `<iframe src="/f/${row.embedToken}" title="${row.name.replace(/"/g, "")}" style="width:100%;min-height:720px;border:0"></iframe>`,
  };
}

publicFormTemplateRouter.get("/public/form-templates/:token", async (req, res) => {
  const form = await publishedForm(String(req.params.token));
  if (!form) { res.status(404).json({ error: "This form is not available." }); return; }
  const [tenant] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, form.tenantId));
  const [service] = form.serviceId
    ? await db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable).where(and(eq(servicesTable.id, form.serviceId), eq(servicesTable.tenantId, form.tenantId)))
    : [];
  res.json({ name: form.name, purpose: form.purpose, serviceId: form.serviceId, serviceName: service?.name ?? null, companyName: tenant?.name ?? "", fields: form.fields });
});

const formUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
publicFormTemplateRouter.post("/public/form-templates/:token", formUpload.single("resume"), async (req, res) => {
  const form = await publishedForm(String(req.params.token));
  if (!form) { res.status(404).json({ error: "This form is not available." }); return; }
  let parsed: unknown;
  try { parsed = typeof req.body?.answers === "string" ? JSON.parse(req.body.answers) : req.body?.answers; }
  catch { throw new TemplateInputError("Submit the form answers."); }
  const raw = parsed;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TemplateInputError("Submit the form answers.");
  const answers = raw as Record<string, unknown>;
  if (form.serviceId) answers.service_id = form.serviceId;
  const fields = (form.fields as FormField[]) ?? [];
  const problem = validateFormAnswers(fields, answers, form.serviceId);
  if (problem) throw new TemplateInputError(problem);
  const result = form.purpose === "hiring" ? await acceptHiring(form, answers, req.file) : await acceptQuote(form, answers);
  res.status(201).json(result);
});

async function publishedForm(token: string) {
  if (!token || token.length > 80) return null;
  const [form] = await db.select().from(websiteFormTemplatesTable).where(and(eq(websiteFormTemplatesTable.embedToken, token), eq(websiteFormTemplatesTable.published, true)));
  return form ?? null;
}

async function acceptQuote(form: typeof websiteFormTemplatesTable.$inferSelect, answers: Record<string, unknown>) {
  const name = textOf(answers.name, "Name", 200)!;
  const email = textOf(answers.email, "Email", 254)!.toLowerCase();
  const phone = textOf(answers.phone, "Phone", 40)!;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TemplateInputError("Enter a valid email.");
  const address = textOf(answers.address, "Address", 300, false);
  return db.transaction(async tx => {
    let [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.tenantId, form.tenantId), sql`lower(${customersTable.email}) = ${email}`)).limit(1);
    if (!customer) {
      [customer] = await tx.insert(customersTable).values({
        tenantId: form.tenantId, name, email, phone,
        billingAddress: address, physicalAddress: address,
        tags: ["website-lead"],
      }).returning();
    }
    let propertyId: number | null = null;
    if (address) {
      const [property] = await tx.insert(propertiesTable).values({ tenantId: form.tenantId, customerId: customer.id, address }).returning();
      propertyId = property.id;
    }
    const [service] = form.serviceId
      ? await tx.select().from(servicesTable).where(and(eq(servicesTable.id, form.serviceId), eq(servicesTable.tenantId, form.tenantId)))
      : [];
    const price = service?.basePrice ?? 0;
    const lineItems = service ? [{ id: randomUUID(), serviceId: service.id, description: service.name, qty: 1, unitPrice: price, markup: 0, discount: 0, isOptional: false, acceptedByCustomer: false }] : [];
    const [estimate] = await tx.insert(estimatesTable).values({
      tenantId: form.tenantId, customerId: customer.id, propertyId, status: "draft", visitMode: "scheduled",
      lineItems, subtotal: price, tax: 0, total: price, notes: answerNotes(answers), approvalToken: randomBytes(18).toString("base64url"),
    }).returning();
    await tx.insert(websiteFormSubmissionsTable).values({ tenantId: form.tenantId, formId: form.id, purpose: "quote", answers, customerId: customer.id, estimateId: estimate.id });
    return { customerId: customer.id, estimateId: estimate.id };
  });
}

async function acceptHiring(form: typeof websiteFormTemplatesTable.$inferSelect, answers: Record<string, unknown>, resume?: Express.Multer.File) {
  if (answers.consent !== true) throw new TemplateInputError("Consent to store this application is required.");
  const application = await intakeApplication(form.tenantId, null, {
    requestId: randomUUID(),
    fullName: textOf(answers.full_name ?? answers.name, "Full name", 200),
    email: textOf(answers.email, "Email", 254),
    phone: textOf(answers.phone, "Phone", 40),
    consent: true,
    answers,
  }, "website", resume, db, undefined, true);
  await db.insert(websiteFormSubmissionsTable).values({ tenantId: form.tenantId, formId: form.id, purpose: "hiring", answers, applicationId: application.id });
  return { applicationId: application.id };
}

function answerNotes(answers: Record<string, unknown>) {
  return Object.entries(answers).filter(([key]) => key !== "service_id").map(([key, value]) => `${key}: ${String(value)}`).join("\n").slice(0, 8000);
}

router.use(fail);
publicFormTemplateRouter.use(fail);
export default router;
