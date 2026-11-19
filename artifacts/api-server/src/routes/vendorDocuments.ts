import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { isMissingColumnError } from "../lib/settingsFallback";
import { bytesFromDataUrl, detectInvoiceFile, fuelCapacityCheck, invoiceDataUrl, matchInventoryItem, MAX_VENDOR_INVOICE_BYTES, pdfText, readInvoiceText, resolveInvoiceVendor, rollingAverageCost, sanitizeUploadName, sellerBesidesCustomer } from "../lib/vendorInvoiceIntake";
import { vendorNameFromPdf } from "../lib/vendorInvoiceOcr";

const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VENDOR_INVOICE_BYTES, files: 1, fields: 4, fieldSize: 1_000_000 },
});

const router: IRouter = Router();
const destinations = new Set(["inventory", "bulk_fuel", "equipment", "job_direct_expense", "overhead"]);

class IntakeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function office(req: import("express").Request, res: import("express").Response): Promise<number | null> {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) {
    res.status(403).json({ error: "Office access required" });
    return null;
  }
  return tenantId;
}

const TOO_LARGE = "That file is too large to review here. Use a PDF or image under 12 MB.";
const SCHEMA_NOT_READY = "Vendor document tables are not ready yet. Reload and try the upload again.";

/** Drizzle wraps the Postgres error, so the SQLSTATE lives on `cause`, not the thrown error. */
function schemaNotReady(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (isMissingColumnError(current)) return true;
    if ("code" in current && (current as { code?: unknown }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function parseInvoiceUpload(req: Request, res: Response, next: NextFunction): void {
  const type = String(req.headers["content-type"] ?? "");
  if (!type.includes("multipart/form-data")) {
    next();
    return;
  }
  invoiceUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: TOO_LARGE });
      return;
    }
    if (error) {
      res.status(400).json({ error: "Upload a PDF or image to review." });
      return;
    }
    next();
  });
}

function invoiceBytes(req: Request): { fileName: string; bytes: Buffer; ocrText: string } | { error: string; status: number } {
  const ocrText = typeof req.body?.ocrText === "string" ? req.body.ocrText : "";
  if (req.file) {
    return { fileName: sanitizeUploadName(req.file.originalname || "invoice"), bytes: req.file.buffer, ocrText };
  }
  const fileName = sanitizeUploadName(String(req.body?.fileName ?? ""));
  const fileUrl = String(req.body?.fileUrl ?? "");
  if (!String(req.body?.fileName ?? "").trim() || !fileUrl.startsWith("data:")) return { error: "Upload a PDF or image to review.", status: 400 };
  const decoded = bytesFromDataUrl(fileUrl);
  if (!decoded) return { error: "Upload a PDF or image to review.", status: 400 };
  if (decoded.bytes.length > MAX_VENDOR_INVOICE_BYTES) return { error: TOO_LARGE, status: 413 };
  return { fileName, bytes: decoded.bytes, ocrText };
}

router.post("/vendor-documents", parseInvoiceUpload, async (req, res): Promise<void> => {
  const companyId = await office(req, res);
  if (companyId == null) return;
  const uploaded = invoiceBytes(req);
  if ("error" in uploaded) {
    res.status(uploaded.status).json({ error: uploaded.error });
    return;
  }
  const detected = detectInvoiceFile(uploaded.bytes);
  if (!detected) {
    res.status(400).json({ error: "Upload a PDF or image to review." });
    return;
  }
  const fileName = uploaded.fileName;
  const fileType = detected.kind;
  const fileUrl = invoiceDataUrl(detected.contentType, uploaded.bytes);
  const suppliedText = uploaded.ocrText.replace(/\u0000/g, "").slice(0, 200_000);
  const typedName = typeof req.body?.vendorName === "string" ? req.body.vendorName.trim().slice(0, 200) : "";
  let extracted = readInvoiceText(suppliedText, fileType === "pdf" ? uploaded.bytes : undefined);
  if (!extracted.vendorName && fileType === "pdf") {
    try {
      const named = await vendorNameFromPdf(uploaded.bytes);
      if (named) extracted = { ...extracted, vendorName: named };
    } catch (error) {
      const log = (req as Request & { log?: { error: (obj: unknown, msg?: string) => void } }).log;
      log?.error({ err: error }, "Vendor logo text was not read");
    }
  }
  const sourceText = [suppliedText, fileType === "pdf" ? pdfText(uploaded.bytes) : ""].filter(Boolean).join("\n");
  extracted = { ...extracted, vendorName: sellerBesidesCustomer(extracted.vendorName, sourceText) };
  const documentId = randomUUID();
  const invoiceId = randomUUID();
  try {
    const vendors = await db.execute(sql`SELECT id, name FROM vendors WHERE tenant_id=${companyId} AND is_draft=false ORDER BY name`);
    const resolved = resolveInvoiceVendor(typedName, extracted.vendorName, vendors.rows.map(row => ({ id: Number(row.id), name: String(row.name) })));
    // A typed name is kept. An existing vendor is selected when the names agree.
    // Stray invoice text, including Sold to / Ship to, never becomes a new vendor.
    const vendorId = resolved.vendorId;
    const draftVendorName = vendorId == null && resolved.vendorName ? resolved.vendorName : null;
    const catalogRows = await db.execute(sql`SELECT id, name, sku FROM inventory_items WHERE tenant_id=${companyId} ORDER BY name`);
    const catalog = catalogRows.rows.map(row => ({ id: Number(row.id), name: String(row.name ?? ""), sku: row.sku == null ? null : String(row.sku) }));
    await db.execute(sql`INSERT INTO document_uploads (id, company_id, file_url, file_name, file_type, processed_status)
      VALUES (${documentId}, ${companyId}, ${fileUrl}, ${fileName}, ${fileType}, 'pending')`);
    await db.execute(sql`INSERT INTO vendor_invoice_records (id, company_id, document_id, vendor_id, draft_vendor_name, invoice_number, invoice_date, total_amount, tax_amount, shipping_amount, raw_ocr_json)
      VALUES (${invoiceId}, ${companyId}, ${documentId}, ${vendorId}, ${draftVendorName}, ${extracted.invoiceNumber}, ${extracted.invoiceDate || null}, ${extracted.totalAmount}, ${extracted.taxAmount}, ${extracted.shippingAmount}, ${JSON.stringify(extracted)}::jsonb)`);
    for (const line of extracted.lines) {
      const matched = line.destinationType === "inventory" ? matchInventoryItem([line.sku, line.description].filter(Boolean).join(" "), catalog) : null;
      const destinationId = matched?.confident && matched.itemId != null ? String(matched.itemId) : null;
      await db.execute(sql`INSERT INTO vendor_invoice_line_items (id, invoice_id, description, quantity, unit_price, total_price, destination_type, destination_id, bbox)
        VALUES (${randomUUID()}, ${invoiceId}, ${line.description}, ${line.quantity}, ${line.unitPrice}, ${line.totalPrice}, ${line.destinationType}, ${destinationId}, ${JSON.stringify(line.bbox)}::jsonb)`);
    }
    const loaded = await loadInvoice(companyId, invoiceId);
    res.status(201).json({
      ...loaded,
      vendorId,
      enteredVendorName: resolved.vendorName,
      draftVendorName,
      vendorWarning: draftVendorName ? `New vendor detected: '${draftVendorName}'. Create new profile or merge with existing?` : null,
    });
  } catch (error) {
    if (schemaNotReady(error)) {
      res.status(503).json({ error: SCHEMA_NOT_READY });
      return;
    }
    const log = (req as Request & { log?: { error: (obj: unknown, msg?: string) => void } }).log;
    log?.error({ err: error }, "Vendor invoice upload failed");
    res.status(500).json({ error: "Could not read that invoice. Try the upload again." });
  }
});

router.get("/vendor-documents/:invoiceId/file", async (req, res): Promise<void> => {
  const companyId = await office(req, res);
  if (companyId == null) return;
  const invoiceId = String(req.params.invoiceId);
  try {
    const stored = await db.execute(sql`SELECT d.file_url, d.file_name, d.file_type FROM vendor_invoice_records r JOIN document_uploads d ON d.id=r.document_id WHERE r.id=${invoiceId} AND r.company_id=${companyId}`);
    const row = stored.rows[0];
    const decoded = row ? bytesFromDataUrl(String(row.file_url ?? "")) : null;
    const detected = decoded ? detectInvoiceFile(decoded.bytes) : null;
    if (!row || !decoded || !detected) {
      res.status(404).json({ error: "Invoice file not found" });
      return;
    }
    const name = sanitizeUploadName(String(row.file_name ?? "invoice")).replace(/["\r\n]/g, "");
    res.setHeader("Content-Type", detected.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(decoded.bytes);
  } catch (error) {
    if (schemaNotReady(error)) {
      res.status(503).json({ error: SCHEMA_NOT_READY });
      return;
    }
    const log = (req as Request & { log?: { error: (obj: unknown, msg?: string) => void } }).log;
    log?.error({ err: error }, "Vendor invoice file failed");
    res.status(500).json({ error: "Could not open that invoice file." });
  }
});

router.get("/vendor-documents/:invoiceId", async (req, res): Promise<void> => {
  const companyId = await office(req, res);
  if (companyId == null) return;
  const invoice = await loadInvoice(companyId, String(req.params.invoiceId));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(invoice);
});

router.post("/vendor-documents/:invoiceId/commit", async (req, res): Promise<void> => {
  const companyId = await office(req, res);
  if (companyId == null) return;
  const invoiceId = String(req.params.invoiceId);
  if (req.body?.vendorConfirmed !== true || !Number.isInteger(req.body?.vendorId)) {
    res.status(400).json({ error: "Confirm the vendor before posting this invoice." });
    return;
  }
  const vendorId = Number(req.body.vendorId);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  try {
    await db.transaction(async tx => {
      const current = await tx.execute(sql`SELECT * FROM vendor_invoice_records WHERE id=${invoiceId} AND company_id=${companyId} FOR UPDATE`);
      if (!current.rows.length) throw new IntakeError(404, "Invoice not found");
      if (current.rows[0].vendor_confirmed === true) throw new IntakeError(409, "This invoice is already posted.");
      const stored = await tx.execute(sql`SELECT id FROM vendor_invoice_line_items WHERE invoice_id=${invoiceId}`);
      if (lines.length !== stored.rows.length) throw new IntakeError(400, "Assign every line before posting.");
      const hasDraftColumn = await vendorsDraftColumn(tx);
      const vendor = hasDraftColumn
        ? await tx.execute(sql`SELECT id, is_draft FROM vendors WHERE id=${vendorId} AND tenant_id=${companyId}`)
        : await tx.execute(sql`SELECT id FROM vendors WHERE id=${vendorId} AND tenant_id=${companyId}`);
      if (!vendor.rows.length) throw new IntakeError(400, "Choose a vendor from this company.");
      const draftId = current.rows[0].vendor_id == null ? null : Number(current.rows[0].vendor_id);
      const vendorName = typeof req.body?.vendorName === "string" ? req.body.vendorName.trim().slice(0, 200) : "";
      const confirmedIsDraft = hasDraftColumn && vendor.rows[0].is_draft === true;
      if (confirmedIsDraft && vendorName) await tx.execute(sql`UPDATE vendors SET name=${vendorName} WHERE id=${vendorId} AND tenant_id=${companyId} AND is_draft=true`);
      if (confirmedIsDraft) await tx.execute(sql`UPDATE vendors SET is_draft=false WHERE id=${vendorId} AND tenant_id=${companyId}`);
      const invoiceDate = typeof req.body?.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.invoiceDate) ? req.body.invoiceDate : String(current.rows[0].invoice_date ?? "").slice(0, 10);
      for (const line of lines) {
        const lineId = String(line.id ?? "");
        const destinationType = destinations.has(line.destinationType) ? String(line.destinationType) : "overhead";
        const destinationId = line.destinationId == null || line.destinationId === "" ? null : String(line.destinationId);
        const fillDate = typeof line.fillDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(line.fillDate) ? line.fillDate : invoiceDate;
        const owned = await tx.execute(sql`SELECT id, description, quantity, unit_price, total_price, bbox FROM vendor_invoice_line_items WHERE id=${lineId} AND invoice_id=${invoiceId}`);
        if (!owned.rows.length) throw new IntakeError(400, "A line on this invoice could not be found.");
        const priced = editedLine(owned.rows[0], line);
        if (destinationType === "bulk_fuel") await receiveFuel(tx, companyId, Number(destinationId), priced, fillDate, current.rows[0]);
        if (destinationType === "inventory" || destinationType === "job_direct_expense") await receiveStock(tx, companyId, destinationType, destinationId, lineId, priced);
        await tx.execute(sql`UPDATE vendor_invoice_line_items SET description=${priced.description}, quantity=${priced.quantity}, unit_price=${priced.unit_price}, total_price=${priced.total_price}, bbox=${JSON.stringify(priced.bbox)}::jsonb, destination_type=${destinationType}, destination_id=${destinationId}, fill_date=${fillDate} WHERE id=${lineId}`);
      }
      const total = Number(req.body?.totalAmount ?? current.rows[0].total_amount);
      const paymentStatus = req.body?.paymentStatus === "paid" || req.body?.paymentStatus === "partially_paid" ? req.body.paymentStatus : "unpaid";
      await tx.execute(sql`UPDATE vendor_invoice_records SET vendor_id=${vendorId}, vendor_confirmed=true, draft_vendor_name=NULL, invoice_number=${String(req.body?.invoiceNumber ?? current.rows[0].invoice_number ?? "")}, invoice_date=${invoiceDate}, total_amount=${total}, tax_amount=${Number(req.body?.taxAmount ?? current.rows[0].tax_amount ?? 0)}, shipping_amount=${Number(req.body?.shippingAmount ?? current.rows[0].shipping_amount ?? 0)}, payment_status=${paymentStatus} WHERE id=${invoiceId}`);
      await tx.execute(sql`UPDATE document_uploads SET processed_status='processed' WHERE id=${current.rows[0].document_id} AND company_id=${companyId}`);
      await tx.execute(sql`INSERT INTO expense_entries (tenant_id, vendor_id, date, amount, category, description) VALUES (${companyId}, ${vendorId}, ${invoiceDate}, ${total}, 'materials', ${`Vendor invoice ${String(req.body?.invoiceNumber ?? current.rows[0].invoice_number ?? "")}`})`);
      await removeOrphanDraft(tx, companyId, draftId, vendorId, hasDraftColumn);
    });
    res.json(await loadInvoice(companyId, invoiceId));
  } catch (error) {
    const status = error instanceof IntakeError ? error.status : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Could not post the invoice" });
  }
});

router.get("/inventory-reservations", async (req, res): Promise<void> => {
  const companyId = getTenantId(req);
  try {
    const rows = await db.execute(sql`SELECT r.id, r.job_id AS "jobId", j.title AS "jobTitle", j.status, i.name, r.quantity::float AS quantity, r.unit_cost::float AS "unitCost"
      FROM inventory_reservations r JOIN jobs j ON j.id=r.job_id JOIN inventory_items i ON i.id=r.inventory_item_id
      WHERE r.company_id=${companyId} AND r.status='reserved' AND j.status='completed' ORDER BY j.completed_at DESC NULLS LAST`);
    res.json({ reservations: rows.rows });
  } catch (error) {
    if (isMissingColumnError(error) || (error as { code?: string }).code === "42P01") { res.json({ reservations: [] }); return; }
    throw error;
  }
});

router.get("/jobs/:id/inventory-reconciliation", async (req, res): Promise<void> => {
  const companyId = getTenantId(req);
  res.json({ jobId: Number(req.params.id), reservations: await reservationsFor(companyId, Number(req.params.id)) });
});

router.post("/jobs/:id/inventory-reconciliation", async (req, res): Promise<void> => {
  const companyId = getTenantId(req);
  const jobId = Number(req.params.id);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  await db.transaction(async tx => {
    const job = await tx.execute(sql`SELECT job_parts FROM jobs WHERE id=${jobId} AND tenant_id=${companyId} FOR UPDATE`);
    if (!job.rows.length) throw new IntakeError(404, "Job not found");
    let parts = Array.isArray(job.rows[0].job_parts) ? job.rows[0].job_parts as Record<string, unknown>[] : [];
    for (const line of lines) {
      const reservation = await tx.execute(sql`SELECT id, inventory_item_id, quantity, unit_cost FROM inventory_reservations WHERE id=${String(line.reservationId)} AND company_id=${companyId} AND job_id=${jobId} AND status='reserved' FOR UPDATE`);
      if (!reservation.rows.length) continue;
      const reserved = Number(reservation.rows[0].quantity);
      const consumed = Math.min(reserved, Math.max(0, Number(line.consumedQuantity) || 0));
      const leftover = Math.round((reserved - consumed) * 1000) / 1000;
      const itemId = Number(reservation.rows[0].inventory_item_id);
      const cost = Math.round(consumed * Number(reservation.rows[0].unit_cost) * 100) / 100;
      await tx.execute(sql`UPDATE inventory_reservations SET consumed_quantity=${consumed}, status='reconciled' WHERE id=${String(line.reservationId)}`);
      await tx.execute(sql`UPDATE inventory_items AS stock SET quantity=GREATEST(0, stock.quantity-${Math.round(consumed)}), reserved_for_job_id=CASE WHEN EXISTS (SELECT 1 FROM inventory_reservations WHERE inventory_item_id=stock.id AND status='reserved') THEN stock.reserved_for_job_id ELSE NULL END FROM inventory_items AS chosen WHERE chosen.id=${itemId} AND chosen.tenant_id=${companyId} AND stock.id=COALESCE(chosen.stock_item_id, chosen.id) AND stock.tenant_id=${companyId}`);
      parts = parts.map(part => String(part.inventoryItemId) === String(itemId) && part.staged === true ? { ...part, quantity: consumed, total: cost, staged: false, leftover } : part);
    }
    await tx.execute(sql`UPDATE jobs SET job_parts=${JSON.stringify(parts)}::jsonb WHERE id=${jobId} AND tenant_id=${companyId}`);
  });
  res.json({ jobId, returnedToGeneralInventory: true, reservations: await reservationsFor(companyId, jobId) });
});

async function receiveFuel(tx: { execute: typeof db.execute }, companyId: number, tankId: number, line: Record<string, unknown>, fillDate: string, invoice: Record<string, unknown>) {
  const gallons = Number(line.quantity);
  const tank = await tx.execute(sql`SELECT available_thousandths, capacity_thousandths, inventory_value_cents, current_gallons, max_capacity, rolling_avg_cost_per_gallon FROM bulk_fuel_tanks WHERE id=${tankId} AND tenant_id=${companyId} FOR UPDATE`);
  if (!tank.rows.length) throw new IntakeError(400, "Choose a bulk fuel tank for the fuel line.");
  const row = tank.rows[0];
  const current = row.current_gallons == null ? Number(row.available_thousandths) / 1000 : Number(row.current_gallons);
  const max = row.max_capacity == null ? (row.capacity_thousandths == null ? null : Number(row.capacity_thousandths) / 1000) : Number(row.max_capacity);
  const check = fuelCapacityCheck(current, max, gallons);
  if (!check.ok) throw new IntakeError(409, check.message ?? "Tank capacity exceeded.");
  const average = rollingAverageCost(current, Number(row.rolling_avg_cost_per_gallon ?? (Number(row.available_thousandths) > 0 ? (Number(row.inventory_value_cents) / Number(row.available_thousandths)) * 10 : 0)), gallons, Number(line.unit_price));
  const nextGallons = Math.round((current + gallons) * 1000) / 1000;
  const addedCents = Math.round(Number(line.total_price) * 100);
  const nextCents = Number(row.inventory_value_cents) + addedCents;
  const nextThousandths = Math.round(nextGallons * 1000);
  const capacityThousandths = max == null ? row.capacity_thousandths : Math.round(max * 1000);
  await tx.execute(sql`UPDATE bulk_fuel_tanks SET available_thousandths=${nextThousandths}, capacity_thousandths=${capacityThousandths}, inventory_value_cents=${nextCents}, current_gallons=${nextGallons}, max_capacity=${max}, rolling_avg_cost_per_gallon=${average} WHERE id=${tankId}`);
  await tx.execute(sql`INSERT INTO bulk_fuel_transactions (tank_id, tenant_id, type, date, gallons_thousandths, total_cost_cents, reference, notes, before_thousandths, after_thousandths, before_value_cents, after_value_cents)
    VALUES (${tankId}, ${companyId}, 'delivery', ${fillDate}, ${Math.round(gallons * 1000)}, ${addedCents}, ${String(invoice.invoice_number ?? "")}, 'Vendor invoice delivery', ${Number(row.available_thousandths)}, ${nextThousandths}, ${Number(row.inventory_value_cents)}, ${nextCents})`);
}

function editedLine(stored: Record<string, unknown>, line: Record<string, unknown>): Record<string, unknown> {
  const description = typeof line.description === "string" && line.description.trim() ? line.description.trim().slice(0, 500) : String(stored.description ?? "");
  const quantity = line.quantity == null || line.quantity === "" ? Number(stored.quantity) : Number(line.quantity);
  const unitPrice = line.unitPrice == null || line.unitPrice === "" ? Number(stored.unit_price) : Number(line.unitPrice);
  const totalPrice = line.totalPrice == null || line.totalPrice === "" ? Number(stored.total_price) : Number(line.totalPrice);
  if (!description) throw new IntakeError(400, "Enter a description for every line.");
  if (!Number.isFinite(quantity) || quantity < 0) throw new IntakeError(400, "Enter a quantity for every line.");
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(totalPrice) || totalPrice < 0) throw new IntakeError(400, "Enter a price for every line.");
  const bbox = stored.bbox && typeof stored.bbox === "object" ? { ...(stored.bbox as Record<string, unknown>) } : {};
  if (typeof line.sku === "string") bbox.sku = line.sku.trim().slice(0, 80);
  if (typeof line.unit === "string") bbox.unit = line.unit.trim().slice(0, 40);
  return { ...stored, description, quantity, unit_price: unitPrice, total_price: totalPrice, bbox };
}

async function receiveStock(tx: { execute: typeof db.execute }, companyId: number, destinationType: string, destinationId: string | null, lineId: string, line: Record<string, unknown>) {
  const jobId = destinationType === "job_direct_expense" ? Number(destinationId) : null;
  if (destinationType === "job_direct_expense" && !Number.isInteger(jobId)) throw new IntakeError(400, "Choose the job that should receive this material.");
  const quantity = Math.max(0, Math.round(Number(line.quantity)));
  const description = String(line.description);
  const unitCost = Number(line.unit_price);
  const destinationNumber = Number(destinationId);
  let itemId = destinationType === "inventory" && Number.isInteger(destinationNumber) && destinationNumber > 0 ? destinationNumber : 0;
  if (!itemId) {
    const existing = await tx.execute(sql`SELECT id FROM inventory_items WHERE tenant_id=${companyId} AND lower(name)=lower(${description}) ORDER BY id LIMIT 1`);
    if (existing.rows.length) itemId = Number(existing.rows[0].id);
    else {
      const bbox = line.bbox && typeof line.bbox === "object" ? line.bbox as { sku?: unknown; unit?: unknown } : {};
      const sku = typeof bbox.sku === "string" && bbox.sku.trim() ? bbox.sku.trim().slice(0, 80) : `OCR-${randomUUID().slice(0, 8)}`;
      const unit = typeof bbox.unit === "string" && bbox.unit.trim() ? bbox.unit.trim().slice(0, 40) : "each";
      const created = await tx.execute(sql`INSERT INTO inventory_items (tenant_id, name, sku, unit_price, quantity, unit) VALUES (${companyId}, ${description}, ${sku}, ${unitCost}, 0, ${unit}) RETURNING id`);
      itemId = Number(created.rows[0].id);
    }
  }
  const owned = await tx.execute(sql`SELECT id FROM inventory_items WHERE id=${itemId} AND tenant_id=${companyId}`);
  if (!owned.rows.length) throw new IntakeError(400, "Choose an inventory item from this company.");
  if (jobId) await tx.execute(sql`UPDATE inventory_items AS stock SET quantity=stock.quantity+${quantity}, unit_price=${unitCost}, reserved_for_job_id=${jobId} FROM inventory_items AS chosen WHERE chosen.id=${itemId} AND chosen.tenant_id=${companyId} AND stock.id=COALESCE(chosen.stock_item_id, chosen.id) AND stock.tenant_id=${companyId}`);
  else await tx.execute(sql`UPDATE inventory_items AS stock SET quantity=stock.quantity+${quantity}, unit_price=${unitCost} FROM inventory_items AS chosen WHERE chosen.id=${itemId} AND chosen.tenant_id=${companyId} AND stock.id=COALESCE(chosen.stock_item_id, chosen.id) AND stock.tenant_id=${companyId}`);
  if (!jobId) return;
  const job = await tx.execute(sql`SELECT id, job_parts FROM jobs WHERE id=${jobId} AND tenant_id=${companyId} FOR UPDATE`);
  if (!job.rows.length) throw new IntakeError(400, "Choose a job from this company.");
  await tx.execute(sql`INSERT INTO inventory_reservations (id, company_id, inventory_item_id, job_id, invoice_line_id, quantity, unit_cost) VALUES (${randomUUID()}, ${companyId}, ${itemId}, ${jobId}, ${lineId}, ${quantity}, ${unitCost})`);
  const parts = Array.isArray(job.rows[0].job_parts) ? job.rows[0].job_parts : [];
  const total = Math.round(quantity * unitCost * 100) / 100;
  parts.push({ id: `staged-${lineId}`, name: description, quantity, total, inventoryItemId: itemId, staged: true });
  await tx.execute(sql`UPDATE jobs SET job_parts=${JSON.stringify(parts)}::jsonb WHERE id=${jobId} AND tenant_id=${companyId}`);
}

async function reservationsFor(companyId: number, jobId: number) {
  const rows = await db.execute(sql`SELECT r.id, r.inventory_item_id AS "inventoryItemId", i.name, r.quantity::float AS quantity, r.unit_cost::float AS "unitCost"
    FROM inventory_reservations r JOIN inventory_items i ON i.id=r.inventory_item_id
    WHERE r.company_id=${companyId} AND r.job_id=${jobId} AND r.status='reserved'`);
  return rows.rows;
}

type Queryable = { execute: typeof db.execute };

/** True when this database has vendors.is_draft. Older production databases do not. */
async function vendorsDraftColumn(tx: Queryable): Promise<boolean> {
  const found = await tx.execute(sql`SELECT 1 AS present FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vendors' AND column_name = 'is_draft'`);
  return found.rows.length > 0;
}

/**
 * Drop an upload draft only after the invoice points at the confirmed vendor.
 * vendor_invoice_records.vendor_id references vendors, so deleting first raises
 * Failed query: DELETE FROM vendors ... is_draft=true. A real vendor is never deleted.
 * If cleanup itself hits a constraint, the posted invoice still commits.
 */
async function removeOrphanDraft(tx: Queryable, companyId: number, draftId: number | null, vendorId: number, hasDraftColumn: boolean): Promise<void> {
  if (!hasDraftColumn || draftId == null || draftId === vendorId) return;
  const draft = await tx.execute(sql`SELECT is_draft FROM vendors WHERE id=${draftId} AND tenant_id=${companyId}`);
  if (draft.rows[0]?.is_draft !== true) return;
  const referenced = await tx.execute(sql`SELECT 1 AS referenced FROM vendor_invoice_records WHERE company_id=${companyId} AND vendor_id=${draftId} LIMIT 1`);
  if (referenced.rows.length) return;
  await tx.execute(sql`SAVEPOINT draft_vendor_cleanup`);
  try {
    await tx.execute(sql`DELETE FROM vendors WHERE id=${draftId} AND tenant_id=${companyId} AND is_draft=true`);
    await tx.execute(sql`RELEASE SAVEPOINT draft_vendor_cleanup`);
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT draft_vendor_cleanup`);
    logger.error({ err: error, draftId, companyId }, "Draft vendor cleanup was skipped so the confirmed invoice could post");
  }
}

async function loadInvoice(companyId: number, invoiceId: string) {
  const invoice = await db.execute(sql`SELECT r.id, r.document_id AS "documentId", r.vendor_id AS "vendorId", r.draft_vendor_name AS "draftVendorName", r.invoice_number AS "invoiceNumber", r.invoice_date AS "invoiceDate", r.total_amount AS "totalAmount", r.tax_amount AS "taxAmount", r.shipping_amount AS "shippingAmount", r.payment_status AS "paymentStatus", r.vendor_confirmed AS "vendorConfirmed", d.file_url AS "fileUrl", d.file_name AS "fileName", d.file_type AS "fileType", d.processed_status AS "processedStatus"
    FROM vendor_invoice_records r JOIN document_uploads d ON d.id=r.document_id WHERE r.id=${invoiceId} AND r.company_id=${companyId}`);
  if (!invoice.rows.length) return null;
  const lines = await db.execute(sql`SELECT id, description, quantity, unit_price AS "unitPrice", total_price AS "totalPrice", destination_type AS "destinationType", destination_id AS "destinationId", fill_date AS "fillDate", bbox FROM vendor_invoice_line_items WHERE invoice_id=${invoiceId} ORDER BY description`);
  const lineRows = lines.rows.map(row => {
    const bbox = row.bbox && typeof row.bbox === "object" ? row.bbox as { sku?: unknown; unit?: unknown } : {};
    return { ...row, sku: typeof bbox.sku === "string" ? bbox.sku : "", unit: typeof bbox.unit === "string" ? bbox.unit : "" };
  });
  const hasDraftColumn = await vendorsDraftColumn(db);
  const vendors = hasDraftColumn
    ? await db.execute(sql`SELECT id, name, is_draft AS "isDraft" FROM vendors WHERE tenant_id=${companyId} ORDER BY is_draft, name`)
    : await db.execute(sql`SELECT id, name, false AS "isDraft" FROM vendors WHERE tenant_id=${companyId} ORDER BY name`);
  const tanks = await db.execute(sql`SELECT id, name, COALESCE(current_gallons, available_thousandths / 1000.0) AS "currentGallons", COALESCE(max_capacity, capacity_thousandths / 1000.0) AS "maxCapacity" FROM bulk_fuel_tanks WHERE tenant_id=${companyId} AND is_active=true ORDER BY name`);
  const jobs = await db.execute(sql`SELECT id, title, status FROM jobs WHERE tenant_id=${companyId} AND status IN ('scheduled', 'in_progress', 'pending', 'on_hold') ORDER BY scheduled_at LIMIT 100`);
  const items = await db.execute(sql`SELECT id, name, sku, quantity, unit, unit_price AS "unitPrice" FROM inventory_items WHERE tenant_id=${companyId} ORDER BY name`);
  const row = invoice.rows[0];
  const draftName = row.draftVendorName == null ? null : String(row.draftVendorName);
  const storedUrl = String(row.fileUrl ?? "");
  const fileUrl = storedUrl.startsWith("data:") ? `/api/vendor-documents/${row.id}/file` : storedUrl;
  return { ...row, fileUrl, lines: lineRows, vendors: vendors.rows, tanks: tanks.rows, jobs: jobs.rows, items: items.rows, vendorWarning: draftName ? `New vendor detected: '${draftName}'. Create new profile or merge with existing?` : null };
}

export default router;
