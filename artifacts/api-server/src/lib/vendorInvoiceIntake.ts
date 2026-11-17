export type VendorCandidate = { id: number; name: string };

export function normalizeVendorName(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|co|company)\b/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = a[i - 1] === b[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = current;
    }
  }
  return row[b.length];
}

export function matchVendor(extracted: string, vendors: VendorCandidate[]): { vendorId: number | null; vendorName: string | null; confidence: number; confident: boolean } {
  const needle = normalizeVendorName(extracted);
  if (!needle) return { vendorId: null, vendorName: null, confidence: 0, confident: false };
  let best: { id: number; name: string; confidence: number } | null = null;
  for (const vendor of vendors) {
    const hay = normalizeVendorName(vendor.name);
    if (!hay) continue;
    const distance = levenshtein(needle, hay);
    const ratio = 1 - distance / Math.max(needle.length, hay.length);
    const contains = hay.includes(needle) || needle.includes(hay) ? 0.9 : 0;
    const confidence = Math.max(ratio, contains);
    if (!best || confidence > best.confidence) best = { id: vendor.id, name: vendor.name, confidence };
  }
  if (!best) return { vendorId: null, vendorName: null, confidence: 0, confident: false };
  return { vendorId: best.id, vendorName: best.name, confidence: Math.round(best.confidence * 1000) / 1000, confident: best.confidence >= 0.84 };
}

export type ExtractedLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  destinationType: "inventory" | "bulk_fuel" | "equipment" | "job_direct_expense" | "overhead";
  bbox: { x: number; y: number; width: number; height: number };
};

export type ExtractedInvoice = {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  taxAmount: number;
  shippingAmount: number;
  lines: ExtractedLine[];
};

const money = (value: string) => {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

/** Phone photos of invoices are often several megabytes. JSON bodies are capped far below this. */
export const MAX_VENDOR_INVOICE_BYTES = 12 * 1024 * 1024;

export function sanitizeUploadName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  return cleaned || "invoice";
}

export function detectInvoiceFile(bytes: Buffer, _fileName = "", _mime = ""): { kind: "pdf" | "image"; contentType: string } | null {
  if (bytes.length < 5 || bytes.length > MAX_VENDOR_INVOICE_BYTES) return null;
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", contentType: "application/pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "image", contentType: "image/jpeg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", contentType: "image/png" };
  if (bytes.length >= 6) {
    const gif = bytes.subarray(0, 6).toString("latin1");
    if (gif === "GIF87a" || gif === "GIF89a") return { kind: "image", contentType: "image/gif" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return { kind: "image", contentType: "image/webp" };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1)$/.test(brand)) return { kind: "image", contentType: "image/heic" };
  }
  return null;
}

export function invoiceDataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export function bytesFromDataUrl(fileUrl: string): { contentType: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(fileUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length) return null;
  return { contentType: match[1], bytes };
}

export function extractInvoiceText(raw: string): ExtractedInvoice {
  const text = raw.replace(/\u0000/g, "").replace(/\r/g, "").trim();
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const vendorName = lines.find(line => !/invoice|bill to|date|total|qty|quantity/i.test(line)) ?? "";
  const invoiceNumber = text.match(/invoice\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Z0-9-]+)/i)?.[1] ?? "";
  const dateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/) ?? text.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/);
  const invoiceDate = dateMatch ? toIsoDate(dateMatch[1]) : new Date().toISOString().slice(0, 10);
  const taxAmount = money(text.match(/tax\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  const shippingAmount = money(text.match(/shipping\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  const totalAmount = money(text.match(/total\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  return { vendorName, invoiceNumber, invoiceDate, totalAmount, taxAmount, shippingAmount, lines: parseItemLines(lines) };
}

const qtyToken = String.raw`(\d+(?:\.\d+)?)`;
const moneyToken = String.raw`\$?([0-9,]+\.\d{2,4})`;
const descriptionFirst = new RegExp(`^(.+?)\\s+${qtyToken}\\s+${moneyToken}\\s+${moneyToken}$`);
const quantityFirst = new RegExp(`^${qtyToken}\\s+(.+?)\\s+${moneyToken}\\s+${moneyToken}$`);
const withoutTotal = new RegExp(`^(.+?)\\s+${qtyToken}\\s+${moneyToken}$`);

function isQuantityToken(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function isMoneyToken(value: string): boolean {
  return /^\$?[0-9,]+\.\d{2,4}$/.test(value);
}

function lineFrom(description: string, quantity: number, unitPrice: number, totalPrice: number, index: number): ExtractedLine | null {
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned || !(quantity > 0) || /^(subtotal|total|tax|shipping|balance|amount due|invoice|description|item|qty|quantity|price|amount)$/i.test(cleaned)) return null;
  const fuel = /diesel|gasoline|unleaded|fuel/i.test(cleaned);
  return {
    description: cleaned,
    quantity,
    unitPrice,
    totalPrice,
    destinationType: fuel ? "bulk_fuel" : "inventory",
    bbox: { x: 6, y: Math.min(88, 12 + index * 6), width: 88, height: 5 },
  };
}

/** Reads a parts row whether the quantity is before or after the description. */
export function parseItemLine(line: string, index: number): ExtractedLine | null {
  const direct = descriptionFirst.exec(line);
  if (direct) return lineFrom(direct[1], Number(direct[2]), money(direct[3]), money(direct[4]), index);
  const leadingQuantity = quantityFirst.exec(line);
  if (leadingQuantity) return lineFrom(leadingQuantity[2], Number(leadingQuantity[1]), money(leadingQuantity[3]), money(leadingQuantity[4]), index);
  const priceOnly = withoutTotal.exec(line);
  if (priceOnly) {
    const quantity = Number(priceOnly[2]);
    const unitPrice = money(priceOnly[3]);
    return lineFrom(priceOnly[1], quantity, unitPrice, Math.round(quantity * unitPrice * 100) / 100, index);
  }
  return null;
}

function parseItemLines(lines: string[]): ExtractedLine[] {
  const parsed: ExtractedLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const direct = parseItemLine(lines[index], index);
    if (direct) {
      parsed.push(direct);
      continue;
    }
    const description = lines[index];
    const quantity = lines[index + 1];
    const unit = lines[index + 2];
    const total = lines[index + 3];
    if (!description || !quantity || !unit || !total) continue;
    if (!isQuantityToken(quantity) || !isMoneyToken(unit) || !isMoneyToken(total) || isQuantityToken(description) || isMoneyToken(description)) continue;
    const joined = parseItemLine(`${description} ${quantity} ${unit} ${total}`, index);
    if (!joined) continue;
    parsed.push(joined);
    index += 3;
  }
  return parsed;
}

export type InventoryCandidate = { id: number; name: string; sku?: string | null };

/** Suggests an existing inventory part. An unsure guess stays unmatched so the user can add a new part. */
export function matchInventoryItem(description: string, items: InventoryCandidate[]): { itemId: number | null; itemName: string | null; confidence: number; confident: boolean } {
  const needle = normalizeVendorName(description);
  if (!needle) return { itemId: null, itemName: null, confidence: 0, confident: false };
  let best: { id: number; name: string; confidence: number } | null = null;
  for (const item of items) {
    const hay = normalizeVendorName(item.name);
    const sku = normalizeVendorName(item.sku ?? "");
    const distance = hay ? levenshtein(needle, hay) : needle.length;
    const ratio = hay ? 1 - distance / Math.max(needle.length, hay.length) : 0;
    const contains = hay && (hay.includes(needle) || needle.includes(hay)) ? 0.9 : 0;
    const skuHit = sku.length >= 3 && (needle.includes(sku) || sku === needle) ? 0.97 : 0;
    const confidence = Math.max(ratio, contains, skuHit);
    if (!best || confidence > best.confidence) best = { id: item.id, name: item.name, confidence };
  }
  if (!best) return { itemId: null, itemName: null, confidence: 0, confident: false };
  return { itemId: best.id, itemName: best.name, confidence: Math.round(best.confidence * 1000) / 1000, confident: best.confidence >= 0.84 };
}

function toIsoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [month, day, year] = value.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function fuelCapacityCheck(currentGallons: number, maxCapacity: number | null, purchasedGallons: number): { ok: boolean; available: number | null; message?: string } {
  if (!(purchasedGallons > 0)) return { ok: false, available: null, message: "Enter the gallons purchased." };
  if (maxCapacity == null) return { ok: true, available: null };
  const available = Math.round((maxCapacity - currentGallons) * 1000) / 1000;
  if (currentGallons + purchasedGallons > maxCapacity + 0.0001) {
    return { ok: false, available, message: `Tank capacity exceeded! Max capacity: ${maxCapacity} gal, Current: ${currentGallons} gal, Available: ${available} gal.` };
  }
  return { ok: true, available };
}

export function rollingAverageCost(currentGallons: number, currentAverage: number, purchasedGallons: number, purchasedUnitCost: number): number {
  const total = currentGallons + purchasedGallons;
  if (!(total > 0)) return 0;
  return Math.round(((currentGallons * currentAverage + purchasedGallons * purchasedUnitCost) / total) * 10000) / 10000;
}

export function pdfText(bytes: string): string {
  const found = [...bytes.replace(/\u0000/g, "").matchAll(/\(([^()\\]{2,})\)/g)].map(match => match[1]);
  return found.join("\n");
}
