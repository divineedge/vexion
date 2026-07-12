import ExcelJS from "exceljs";
import multer from "multer";
import crypto from "crypto";
import type { Request, Response } from "express";
import { db, importBatchesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserId } from "./tenantHelper";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "xlsx";

export interface ExportColumn {
  key: string;
  header: string;
}

export interface ImportFieldMeta {
  key: string;
  header: string;
  required?: boolean;
  /** Short hint shown in the column-mapping UI, e.g. "Looked up by email" */
  hint?: string;
}

export type ParsedRow = Record<string, string>;

export interface RowParseSuccess {
  ok: true;
  values: Record<string, unknown>;
}
export interface RowParseFailure {
  ok: false;
  errors: string[];
}
export type RowParseResult = RowParseSuccess | RowParseFailure;

export interface ImportExportEntityConfig {
  /** Used in export filenames, e.g. "customers" */
  entityKey: string;
  /** Column metadata surfaced to the column-mapping UI + used for auto-mapping */
  fields: ImportFieldMeta[];
  /** Columns written to the export file, in order */
  exportColumns: ExportColumn[];
  /** Loads tenant-scoped, filtered rows ready to hand to the export writer */
  buildExportRows: (
    tenantId: number,
    query: Record<string, string>,
  ) => Promise<Record<string, unknown>[]>;
  /** Validates + coerces one mapped row. Must not touch the database. */
  parseRow: (
    tenantId: number,
    raw: ParsedRow,
    rowNumber: number,
  ) => Promise<RowParseResult>;
  /** Returns the id of an existing record this row should update, or null to create */
  findExisting: (
    tenantId: number,
    values: Record<string, unknown>,
  ) => Promise<number | null>;
  /** Inserts the row and returns the new record's id, so it can be undone later. */
  insert: (tenantId: number, values: Record<string, unknown>) => Promise<number>;
  update: (
    tenantId: number,
    id: number,
    values: Record<string, unknown>,
  ) => Promise<void>;
  /** Loads the current values of an existing record, used to snapshot state before an update so it can be reverted. */
  getById: (tenantId: number, id: number) => Promise<Record<string, unknown> | null>;
  /** Hard-deletes a record, used to undo a row this import created. */
  deleteById: (tenantId: number, id: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Import batch registry — lets the shared rollback/history endpoints look up
// the right entity config by entityKey without a circular import.
// ---------------------------------------------------------------------------

const importExportConfigRegistry = new Map<string, ImportExportEntityConfig>();

export function registerImportExportConfig(config: ImportExportEntityConfig): void {
  importExportConfigRegistry.set(config.entityKey, config);
}

export function getImportExportConfig(entityKey: string): ImportExportEntityConfig | undefined {
  return importExportConfigRegistry.get(entityKey);
}

// ---------------------------------------------------------------------------
// CSV helpers (hand-rolled — no extra dependency needed for such a small format)
// ---------------------------------------------------------------------------

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(columns: ExportColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c.key])).join(","));
  }
  // \r\n is the most broadly compatible CSV line ending (Excel, Sheets, etc.)
  return lines.join("\r\n") + "\r\n";
}

/** Parses raw CSV text into a header row + string data rows, handling quoted fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present (common when files are exported from Excel).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank trailing rows (common with trailing newlines)
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function buildExportFile(
  format: ExportFormat,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Export");
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 22 }));
    for (const row of rows) {
      sheet.addRow(row);
    }
    sheet.getRow(1).font = { bold: true };
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer as ArrayBuffer),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    };
  }

  const csv = rowsToCsv(columns, rows);
  return { buffer: Buffer.from(csv, "utf-8"), contentType: "text/csv", extension: "csv" };
}

export async function handleExportRequest(
  req: Request,
  res: Response,
  tenantId: number,
  config: ImportExportEntityConfig,
): Promise<void> {
  const format: ExportFormat = req.query.format === "xlsx" ? "xlsx" : "csv";
  const rows = await config.buildExportRows(tenantId, req.query as Record<string, string>);
  const { buffer, contentType, extension } = await buildExportFile(
    format,
    config.exportColumns,
    rows,
  );
  const filename = `${config.entityKey}-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

// ---------------------------------------------------------------------------
// Upload parsing (CSV or XLSX -> headers + string rows)
// ---------------------------------------------------------------------------

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export async function parseUploadedSpreadsheet(
  buffer: Buffer,
  originalName: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const isXlsx = /\.xlsx$/i.test(originalName);
  const isCsv = /\.csv$/i.test(originalName);

  if (isXlsx || (!isCsv && buffer.slice(0, 2).toString("hex") === "504b")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };
    const all: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1); // exceljs pads index 0
      all.push(
        values.map((v) => {
          if (v === null || v === undefined) return "";
          if (v instanceof Date) return v.toISOString();
          if (typeof v === "object" && v !== null && "text" in (v as Record<string, unknown>)) {
            return String((v as { text: unknown }).text ?? "");
          }
          if (typeof v === "object" && v !== null && "result" in (v as Record<string, unknown>)) {
            return String((v as { result: unknown }).result ?? "");
          }
          return String(v);
        }),
      );
    });
    const [headers, ...rows] = all;
    return { headers: headers ?? [], rows };
  }

  const text = buffer.toString("utf-8");
  const all = parseCsv(text);
  const [headers, ...rows] = all;
  return { headers: headers ?? [], rows };
}

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function suggestMapping(
  uploadedHeaders: string[],
  fields: ImportFieldMeta[],
): Record<string, string | null> {
  const normalizedUploaded = uploadedHeaders.map(normalizeHeader);
  const mapping: Record<string, string | null> = {};
  for (const field of fields) {
    const targets = [field.key, field.header].map(normalizeHeader);
    let matchIdx = normalizedUploaded.findIndex((h) => targets.includes(h));
    if (matchIdx === -1) {
      matchIdx = normalizedUploaded.findIndex(
        (h) => h.length > 0 && targets.some((t) => h.includes(t) || t.includes(h)),
      );
    }
    mapping[field.key] = matchIdx >= 0 ? uploadedHeaders[matchIdx] : null;
  }
  return mapping;
}

export interface ImportPreviewResponse {
  headers: string[];
  fields: ImportFieldMeta[];
  suggestedMapping: Record<string, string | null>;
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export async function handleImportPreview(
  req: Request,
  res: Response,
  tenantId: number,
  config: ImportExportEntityConfig,
): Promise<void> {
  void tenantId;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
    return;
  }
  const { headers, rows } = await parseUploadedSpreadsheet(file.buffer, file.originalname);
  if (headers.length === 0) {
    res.status(400).json({ error: "Could not read any columns from the uploaded file" });
    return;
  }

  const sampleRows = rows.slice(0, 5).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });

  const response: ImportPreviewResponse = {
    headers,
    fields: config.fields,
    suggestedMapping: suggestMapping(headers, config.fields),
    sampleRows,
    totalRows: rows.length,
  };
  res.json(response);
}

export interface ImportRowError {
  row: number;
  errors: string[];
}
export interface ImportCommitResponse {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  /** Id of the import_batches record tracking this commit, usable to roll it back. */
  batchId: number;
}

export interface ImportRowAction {
  row: number;
  action: "created" | "updated";
  recordId: number;
  /** Only set for "updated" rows — the values that were in place before this import overwrote them. */
  priorValues?: Record<string, unknown>;
}

const MAX_REPORTED_ERRORS = 100;

export async function handleImportCommit(
  req: Request,
  res: Response,
  tenantId: number,
  config: ImportExportEntityConfig,
): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
    return;
  }
  let mapping: Record<string, string | null>;
  try {
    mapping = JSON.parse(String(req.body.mapping ?? "{}"));
  } catch {
    res.status(400).json({ error: "Invalid mapping JSON" });
    return;
  }

  const { headers, rows } = await parseUploadedSpreadsheet(file.buffer, file.originalname);
  const headerIndex = new Map(headers.map((h, i) => [h, i]));

  const result: ImportCommitResponse = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    batchId: 0,
  };
  const rowActions: ImportRowAction[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 1-based, plus header row
    const rawRow = rows[i];
    const isBlank = rawRow.every((v) => (v ?? "").trim() === "");
    if (isBlank) {
      result.skipped++;
      continue;
    }

    const raw: ParsedRow = {};
    for (const field of config.fields) {
      const header = mapping[field.key];
      const idx = header != null ? headerIndex.get(header) : undefined;
      raw[field.key] = idx !== undefined ? (rawRow[idx] ?? "").trim() : "";
    }

    try {
      const parsed = await config.parseRow(tenantId, raw, rowNumber);
      if (!parsed.ok) {
        result.failed++;
        if (result.errors.length < MAX_REPORTED_ERRORS) {
          result.errors.push({ row: rowNumber, errors: parsed.errors });
        }
        continue;
      }

      const existingId = await config.findExisting(tenantId, parsed.values);
      if (existingId != null) {
        const priorValues = await config.getById(tenantId, existingId);
        await config.update(tenantId, existingId, parsed.values);
        result.updated++;
        rowActions.push({
          row: rowNumber,
          action: "updated",
          recordId: existingId,
          priorValues: priorValues ?? undefined,
        });
      } else {
        const newId = await config.insert(tenantId, parsed.values);
        result.created++;
        rowActions.push({ row: rowNumber, action: "created", recordId: newId });
      }
    } catch (err) {
      result.failed++;
      if (result.errors.length < MAX_REPORTED_ERRORS) {
        result.errors.push({
          row: rowNumber,
          errors: [err instanceof Error ? err.message : "Unknown error"],
        });
      }
    }
  }

  const userId = getUserId(req);
  const [batch] = await db
    .insert(importBatchesTable)
    .values({
      tenantId,
      userId,
      entityKey: config.entityKey,
      fileName: file.originalname,
      status: "committed",
      totalRows: result.total,
      createdCount: result.created,
      updatedCount: result.updated,
      skippedCount: result.skipped,
      failedCount: result.failed,
      rowActions,
    })
    .returning({ id: importBatchesTable.id });
  result.batchId = batch.id;

  res.json(result);
}

// ---------------------------------------------------------------------------
// Import batch history + rollback
// ---------------------------------------------------------------------------

export interface ImportBatchSummary {
  id: number;
  entityKey: string;
  fileName: string | null;
  status: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  createdByName: string | null;
  createdAt: string;
  rolledBackAt: string | null;
}

export async function handleListImportBatches(req: Request, res: Response, tenantId: number): Promise<void> {
  const entityKey = typeof req.query.entity === "string" ? req.query.entity : undefined;
  const where = entityKey
    ? and(eq(importBatchesTable.tenantId, tenantId), eq(importBatchesTable.entityKey, entityKey))
    : eq(importBatchesTable.tenantId, tenantId);

  const rows = await db
    .select({ batch: importBatchesTable, userName: usersTable.name })
    .from(importBatchesTable)
    .leftJoin(usersTable, eq(importBatchesTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(importBatchesTable.createdAt))
    .limit(50);

  const summaries: ImportBatchSummary[] = rows.map((r) => ({
    id: r.batch.id,
    entityKey: r.batch.entityKey,
    fileName: r.batch.fileName,
    status: r.batch.status,
    totalRows: r.batch.totalRows,
    created: r.batch.createdCount,
    updated: r.batch.updatedCount,
    skipped: r.batch.skippedCount,
    failed: r.batch.failedCount,
    createdByName: r.userName ?? null,
    createdAt: r.batch.createdAt.toISOString(),
    rolledBackAt: r.batch.rolledBackAt?.toISOString() ?? null,
  }));
  res.json(summaries);
}

// Prior-row snapshots are stored in a jsonb column, so any Date values
// captured via getById round-trip through JSON as ISO strings. Revive them
// before handing them back to `update`, which expects real Date instances
// for timestamp columns.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function reviveDates(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = typeof value === "string" && ISO_DATE_RE.test(value) ? new Date(value) : value;
  }
  return result;
}

export interface ImportBatchRollbackResponse {
  deletedCount: number;
  revertedCount: number;
  failedCount: number;
  errors: string[];
}

export async function handleRollbackImportBatch(req: Request, res: Response, tenantId: number, userId: number): Promise<void> {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const batchId = parseInt(rawId, 10);
  if (Number.isNaN(batchId)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }

  const [batch] = await db
    .select()
    .from(importBatchesTable)
    .where(and(eq(importBatchesTable.id, batchId), eq(importBatchesTable.tenantId, tenantId)))
    .limit(1);
  if (!batch) {
    res.status(404).json({ error: "Import batch not found" });
    return;
  }
  if (batch.status === "rolled_back") {
    res.status(400).json({ error: "This import has already been rolled back" });
    return;
  }

  const config = getImportExportConfig(batch.entityKey);
  if (!config) {
    res.status(500).json({ error: `No import handler registered for entity "${batch.entityKey}"` });
    return;
  }

  const actions = (batch.rowActions as ImportRowAction[]) ?? [];
  const response: ImportBatchRollbackResponse = { deletedCount: 0, revertedCount: 0, failedCount: 0, errors: [] };

  // Undo in reverse order in case later rows in the same file depended on earlier ones.
  for (const action of [...actions].reverse()) {
    try {
      if (action.action === "created") {
        await config.deleteById(tenantId, action.recordId);
        response.deletedCount++;
      } else if (action.action === "updated") {
        if (action.priorValues) {
          await config.update(tenantId, action.recordId, reviveDates(action.priorValues));
          response.revertedCount++;
        }
      }
    } catch (err) {
      response.failedCount++;
      response.errors.push(
        `Row ${action.row} (record ${action.recordId}): ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  await db
    .update(importBatchesTable)
    .set({ status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: userId })
    .where(eq(importBatchesTable.id, batchId));

  res.json(response);
}

// ---------------------------------------------------------------------------
// Field-level coercion helpers shared by entity parseRow implementations
// ---------------------------------------------------------------------------

export function requireString(raw: string, fieldLabel: string, errors: string[]): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.push(`${fieldLabel} is required`);
    return undefined;
  }
  return trimmed;
}

export function optionalString(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function optionalNumber(raw: string, fieldLabel: string, errors: string[]): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    errors.push(`${fieldLabel} must be a number (got "${raw}")`);
    return undefined;
  }
  return n;
}

export function optionalBoolean(raw: string): boolean | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  return ["true", "yes", "y", "1"].includes(trimmed);
}

export function optionalDate(raw: string, fieldLabel: string, errors: string[]): Date | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    errors.push(`${fieldLabel} is not a valid date (got "${raw}")`);
    return undefined;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Line items cell encoding — shared convention for jobs + estimates imports
// ---------------------------------------------------------------------------
//
// The `lineItems` jsonb column on jobs/estimates is a variable-length array
// that doesn't map onto flat spreadsheet columns. Rather than requiring a
// secondary "line items" sheet/file (which the shared row-by-row import
// engine above doesn't support — one spreadsheet row is always one entity
// row), line items are packed into a single "Line Items" cell using a
// documented mini-syntax:
//
//   <item>; <item>; ...
//
// where each <item> is a set of `|`-separated `key=value` pairs:
//
//   description=<text>|qty=<number>|unitprice=<number>|markup=<pct>|discount=<pct>|optional=true|accepted=true
//
// - `description` is required; all other keys are optional and default to
//   qty=1, unitprice=0, markup=0, discount=0, optional=false (accepted=true).
// - `optional=true` marks an upsell/add-on line; `accepted` only matters for
//   optional lines (whether the customer has accepted it).
// - Literal `|` or `;` inside a value must be escaped as `\|` / `\;`.
//
// Example cell value:
//   "Mow lawn|qty=1|unitprice=75; Trim hedges|qty=2|unitprice=40|optional=true"
//
// Export re-encodes stored line items back into this exact format, so a
// round-trip export -> edit -> import is lossless (aside from `id`, which is
// regenerated on import, and `serviceId`, which is not represented in CSV).

export interface LineItemCsvShape {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  acceptedByCustomer: boolean;
}

function escapeLineItemField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/;/g, "\\;");
}

/** Splits on `delimiter`, honoring `\`-escaped occurrences of it. */
function splitEscaped(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      current += text[i + 1];
      i++;
    } else if (ch === delimiter) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function encodeLineItemsCell(items: LineItemCsvShape[]): string {
  return items
    .filter((item) => item != null)
    .map((item) => {
      const parts = [
        `description=${escapeLineItemField(item.description ?? "")}`,
        `qty=${item.qty ?? 1}`,
        `unitprice=${item.unitPrice ?? 0}`,
      ];
      if (item.markup) parts.push(`markup=${item.markup}`);
      if (item.discount) parts.push(`discount=${item.discount}`);
      if (item.isOptional) {
        parts.push("optional=true");
        parts.push(`accepted=${item.acceptedByCustomer ? "true" : "false"}`);
      }
      return parts.join("|");
    })
    .join("; ");
}

/** Parses a "Line Items" cell into line-item objects. Appends human-readable messages to `errors` for malformed segments (does not throw). */
export function decodeLineItemsCell(raw: string | undefined, errors: string[]): LineItemCsvShape[] {
  if (!raw || !raw.trim()) return [];
  const items: LineItemCsvShape[] = [];
  const itemStrs = splitEscaped(raw, ";").map((s) => s.trim()).filter(Boolean);

  for (const itemStr of itemStrs) {
    const pairStrs = splitEscaped(itemStr, "|").map((s) => s.trim()).filter(Boolean);
    const fields: Record<string, string> = {};
    for (const pairStr of pairStrs) {
      const eqIdx = pairStr.indexOf("=");
      if (eqIdx === -1) {
        errors.push(`Invalid line item segment "${pairStr}" in "${itemStr}" — expected key=value`);
        continue;
      }
      fields[pairStr.slice(0, eqIdx).trim().toLowerCase()] = pairStr.slice(eqIdx + 1).trim();
    }
    if (!fields.description) {
      errors.push(`Line item is missing required "description" (in "${itemStr}")`);
      continue;
    }
    const qty = fields.qty !== undefined ? Number(fields.qty) : 1;
    const unitPrice = fields.unitprice !== undefined ? Number(fields.unitprice) : 0;
    const markup = fields.markup !== undefined ? Number(fields.markup) : 0;
    const discount = fields.discount !== undefined ? Number(fields.discount) : 0;
    if ([qty, unitPrice, markup, discount].some((n) => Number.isNaN(n))) {
      errors.push(`Line item "${fields.description}" has a non-numeric qty/unitprice/markup/discount`);
      continue;
    }
    const isOptional = (fields.optional ?? "").toLowerCase() === "true";
    items.push({
      id: crypto.randomUUID(),
      description: fields.description,
      qty,
      unitPrice,
      markup,
      discount,
      isOptional,
      acceptedByCustomer: isOptional ? (fields.accepted ?? "").toLowerCase() === "true" : true,
    });
  }
  return items;
}

/** Sum of accepted line items (base qty*unitPrice with markup/discount applied). Unaccepted optional items are excluded, matching billing behavior elsewhere. */
export function sumLineItems(items: LineItemCsvShape[]): number {
  let total = 0;
  for (const item of items) {
    if (item.isOptional && !item.acceptedByCustomer) continue;
    const base = item.qty * item.unitPrice;
    const afterMarkup = base * (1 + item.markup / 100);
    const afterDiscount = afterMarkup * (1 - item.discount / 100);
    total += afterDiscount;
  }
  return total;
}

export function optionalEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  fieldLabel: string,
  errors: string[],
): T | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  const match = allowed.find((a) => a.toLowerCase() === trimmed);
  if (!match) {
    errors.push(`${fieldLabel} must be one of: ${allowed.join(", ")} (got "${raw}")`);
    return undefined;
  }
  return match;
}
