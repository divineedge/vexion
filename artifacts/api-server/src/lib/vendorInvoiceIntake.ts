import { crc32, deflateSync, inflateSync } from "node:zlib";

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
  bbox: { x: number; y: number; width: number; height: number; sku?: string; unit?: string };
  sku?: string;
  unit?: string;
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
  const flat = lines.map(line => line.replace(/\t+/g, " ").replace(/[ ]+/g, " ").trim()).join("\n");
  const vendorName = vendorFrom(lines.map(line => line.replace(/\t+/g, " ").replace(/[ ]+/g, " ").trim()));
  const invoiceNumber = flat.match(/invoice\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9-]{2,})/i)?.[1] ?? "";
  const dateMatch = flat.match(/invoice\s*date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)
    ?? flat.match(/\bdate\s*:?\s*(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    ?? flat.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const invoiceDate = dateMatch ? toIsoDate(dateMatch[1]) : new Date().toISOString().slice(0, 10);
  const taxAmount = lastLabeledMoney(flat, /(?:^|[^\w])tax\s*:?\s*\$?\s*([0-9,]+\.\d{2})/gi);
  const shippingAmount = lastLabeledMoney(flat, /(?:^|[^\w])shipping\s*:?\s*\$?\s*([0-9,]+\.\d{2})/gi);
  const totalAmount = lastLabeledMoney(flat, /(?:^|[^\w])total\s*:?\s*\$?\s*([0-9,]+\.\d{2})/gi);
  const columnar = parseColumnar(lines);
  return { vendorName, invoiceNumber, invoiceDate, totalAmount, taxAmount, shippingAmount, lines: columnar ?? parseItemLines(lines.map(line => line.replace(/\t+/g, " "))) };
}

/** Uses the PDF text layer when it has line items. Pasted photo text is the fallback. */
export function readInvoiceText(clientText: string, pdfBytes?: Buffer): ExtractedInvoice {
  const fromPdf = pdfBytes?.length ? extractInvoiceText(pdfText(pdfBytes)) : null;
  if (fromPdf && fromPdf.lines.length) return fromPdf;
  if (clientText.trim()) return extractInvoiceText(clientText);
  return fromPdf ?? extractInvoiceText("");
}

function lastLabeledMoney(text: string, pattern: RegExp): number {
  let found = 0;
  let matched = false;
  for (const match of text.matchAll(pattern)) {
    found = money(match[1] ?? "0");
    matched = true;
  }
  return matched ? found : 0;
}

function vendorFrom(lines: string[]): string {
  for (const line of lines) {
    if (/sold to|ship to|bill to/i.test(line)) break;
    if (looksLikeVendor(line)) return line;
  }
  return "";
}

function looksLikeVendor(line: string): boolean {
  const value = line.trim();
  if (value.length < 3 || value.length > 80) return false;
  if (!/[A-Za-z]{2}/.test(value)) return false;
  if (/\d{3}[-.)\s]\d{3}/.test(value)) return false;
  if (/\b\d{5}(?:-\d{4})?\b/.test(value) && /,/.test(value)) return false;
  if (/\d/.test(value) && /\b(rd|st|ave|road|street|drive|dr|blvd|ln|lane|way|pkwy|box)\b/i.test(value)) return false;
  if (/invoice|page\b|station|duplicate|sold to|ship to|quantity|description|subtotal|\btotal\b|\btax\b|terms|customer|sales rep|ship date|remit|received|billing|signature|item\s*#|ext prc|selling unit|po box|location|user:|\bnotes\b|\bprice\b|\bdate\b/i.test(value)) return false;
  return true;
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

function columnKind(header: string): "qty" | "sku" | "description" | "price" | "unit" | "ext" | null {
  const label = header.toLowerCase().replace(/[^a-z#]+/g, " ").trim();
  if (!label) return null;
  if (/qty|quantity/.test(label)) return "qty";
  if (/item|sku/.test(label)) return "sku";
  if (/desc/.test(label)) return "description";
  if (/ext|amount/.test(label)) return "ext";
  if (/price/.test(label)) return "price";
  if (/unit|uom/.test(label)) return "unit";
  return null;
}

/** Crystal Reports and similar invoices put each column in its own cell. */
function parseColumnar(lines: string[]): ExtractedLine[] | null {
  const headerIndex = lines.findIndex(line => {
    const cells = line.split("\t");
    if (cells.length < 3) return false;
    const kinds = cells.map(columnKind).filter(Boolean);
    return kinds.includes("description") && kinds.includes("qty") && (kinds.includes("price") || kinds.includes("ext"));
  });
  if (headerIndex < 0) return null;
  const kinds = lines[headerIndex].split("\t").map(cell => columnKind(cell.trim()));
  const parsed: ExtractedLine[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (/received by|subtotal|customer signature|remit to|print name|^\s*notes\b/i.test(line.replace(/\t/g, " "))) {
      if (parsed.length) break;
      continue;
    }
    const cells = line.split("\t").map(cell => cell.trim());
    const take = (kind: "qty" | "sku" | "description" | "price" | "unit" | "ext") => {
      const index = kinds.indexOf(kind);
      return index >= 0 ? cells[index] ?? "" : "";
    };
    const description = take("description").replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2}/.test(description)) continue;
    if (/^(description|item|price|quantity|qty|total|tax|subtotal|amount|ext prc)$/i.test(description)) continue;
    const unitPrice = money(take("price"));
    const extPrice = money(take("ext"));
    if (!(unitPrice > 0) && !(extPrice > 0)) continue;
    const quantity = Number(take("qty").replace(/,/g, ""));
    const qty = quantity > 0 ? quantity : 1;
    const totalPrice = extPrice > 0 ? extPrice : Math.round(qty * unitPrice * 100) / 100;
    const price = unitPrice > 0 ? unitPrice : Math.round((totalPrice / qty) * 100) / 100;
    const sku = take("sku").replace(/\s+/g, "");
    const unit = take("unit").replace(/\s+/g, " ").trim();
    const built = lineFrom(description, qty, price, totalPrice, parsed.length);
    if (!built) continue;
    if (/^[A-Za-z0-9][A-Za-z0-9-]{1,}$/.test(sku) && !isMoneyToken(sku)) built.sku = sku;
    if (unit && !isMoneyToken(unit)) built.unit = unit;
    if (built.sku) built.bbox = { ...built.bbox, sku: built.sku };
    if (built.unit) built.bbox = { ...built.bbox, unit: built.unit };
    parsed.push(built);
  }
  return parsed.length ? parsed : null;
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
  const [month, day, yearRaw] = value.split(/[/-]/);
  const yearNumber = Number(yearRaw);
  const year = yearRaw.length === 2 ? String(yearNumber >= 70 ? 1900 + yearNumber : 2000 + yearNumber) : yearRaw;
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

type PdfObject = { header: string; stream?: Buffer };

function parsePdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const latin = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const marker = /(\d+)\s+\d+\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(latin))) {
    const id = Number(match[1]);
    const start = match.index + match[0].length;
    const streamAt = latin.indexOf("stream", start);
    const endAt = latin.indexOf("endobj", start);
    if (endAt < 0) break;
    if (streamAt >= 0 && streamAt < endAt) {
      const header = latin.slice(start, streamAt);
      const length = Number(/\/Length\s+(\d+)/.exec(header)?.[1] ?? 0);
      let dataStart = streamAt + "stream".length;
      if (latin.charCodeAt(dataStart) === 13 && latin.charCodeAt(dataStart + 1) === 10) dataStart += 2;
      else if (latin.charCodeAt(dataStart) === 10) dataStart += 1;
      objects.set(id, { header, stream: pdf.subarray(dataStart, dataStart + length) });
      const after = latin.indexOf("endobj", dataStart + length);
      if (after > 0) marker.lastIndex = after + "endobj".length;
    } else {
      objects.set(id, { header: latin.slice(start, endAt) });
      marker.lastIndex = endAt + "endobj".length;
    }
  }
  return objects;
}

function inflateStream(header: string, stream: Buffer): Buffer | null {
  if (!stream.length) return null;
  if (!/FlateDecode/.test(header)) return /\/Filter/.test(header) ? null : stream;
  try {
    return inflateSync(stream);
  } catch {
    return null;
  }
}

type TextRun = { x: number; y: number; text: string };

function contentRuns(content: string): TextRun[] {
  const runs: TextRun[] = [];
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
  const tokens = pdfTokens(content);
  let array: { kind: "str" | "num"; val: string }[] | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "lbrack") {
      array = [];
      continue;
    }
    if (array && token.kind !== "op" && token.kind !== "rbrack") {
      if (token.kind === "str" || token.kind === "num") array.push({ kind: token.kind, val: token.val });
      continue;
    }
    if (token.kind !== "op") continue;
    if (token.val === "BT") {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      continue;
    }
    if (token.val === "Tm") {
      const nums = previousNumbers(tokens, index, 6);
      if (nums) [a, b, c, d, e, f] = nums;
      continue;
    }
    if (token.val === "Td" || token.val === "TD") {
      const nums = previousNumbers(tokens, index, 2);
      if (nums) {
        const [tx, ty] = nums;
        e = e + tx * a + ty * c;
        f = f + tx * b + ty * d;
      }
      continue;
    }
    if (token.val === "Tj" || token.val === "'" ) {
      const text = previousString(tokens, index);
      if (text.trim()) runs.push({ x: e, y: f, text });
      continue;
    }
    if (token.val === "TJ" && array) {
      let text = "";
      for (const part of array) {
        if (part.kind === "str") text += part.val;
        else if (Number(part.val) <= -180) text += " ";
      }
      if (text.trim()) runs.push({ x: e, y: f, text });
      array = null;
    }
  }
  return runs;
}

type PdfToken = { kind: "str" | "num" | "op" | "lbrack" | "rbrack" | "name"; val: string };

function pdfTokens(content: string): PdfToken[] {
  const tokens: PdfToken[] = [];
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n" || char === "\f") {
      index += 1;
      continue;
    }
    if (char === "%") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") index += 1;
      continue;
    }
    if (char === "(") {
      index += 1;
      let depth = 1;
      let raw = "";
      while (index < content.length && depth > 0) {
        if (content[index] === "\\") {
          raw += content.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (content[index] === "(") depth += 1;
        else if (content[index] === ")") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        raw += content[index];
        index += 1;
      }
      tokens.push({ kind: "str", val: pdfUnescape(raw) });
      continue;
    }
    if (char === "[") {
      tokens.push({ kind: "lbrack", val: "[" });
      index += 1;
      continue;
    }
    if (char === "]") {
      tokens.push({ kind: "rbrack", val: "]" });
      index += 1;
      continue;
    }
    if (char === "<") {
      const end = content.indexOf(">", index + 1);
      index = end < 0 ? content.length : end + 1;
      continue;
    }
    if (char === "/") {
      let end = index + 1;
      while (end < content.length && !" \t\r\n[]()<>{}/%".includes(content[end])) end += 1;
      tokens.push({ kind: "name", val: content.slice(index, end) });
      index = end;
      continue;
    }
    let end = index;
    while (end < content.length && !" \t\r\n[]()<>{}/%".includes(content[end])) end += 1;
    const word = content.slice(index, end);
    index = end;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) tokens.push({ kind: "num", val: word });
    else if (word) tokens.push({ kind: "op", val: word });
  }
  return tokens;
}

function pdfUnescape(raw: string): string {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\" || index + 1 >= raw.length) {
      out += raw[index];
      continue;
    }
    const next = raw[index + 1];
    const named: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    if (named[next]) {
      out += named[next];
      index += 1;
      continue;
    }
    if (/[0-7]/.test(next)) {
      let octal = "";
      let cursor = index + 1;
      while (cursor < raw.length && octal.length < 3 && /[0-7]/.test(raw[cursor])) {
        octal += raw[cursor];
        cursor += 1;
      }
      out += String.fromCharCode(Number.parseInt(octal, 8));
      index = cursor - 1;
      continue;
    }
    out += next;
    index += 1;
  }
  return out;
}

function previousNumbers(tokens: PdfToken[], index: number, count: number): number[] | null {
  const nums: number[] = [];
  for (let cursor = index - 1; cursor >= 0 && nums.length < count; cursor -= 1) {
    if (tokens[cursor].kind === "num") nums.push(Number(tokens[cursor].val));
    else break;
  }
  if (nums.length !== count) return null;
  return nums.reverse();
}

function previousString(tokens: PdfToken[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].kind === "str") return tokens[cursor].val;
    if (tokens[cursor].kind === "op") break;
  }
  return "";
}

function textFromContent(content: string): string {
  const rows: { y: number; runs: TextRun[] }[] = [];
  for (const run of contentRuns(content).sort((left, right) => left.y - right.y || left.x - right.x)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - run.y) <= 2.2) last.runs.push(run);
    else rows.push({ y: run.y, runs: [run] });
  }
  return rows.map(row => {
    const cells: { x: number; text: string }[] = [];
    for (const run of [...row.runs].sort((left, right) => left.x - right.x)) {
      const last = cells[cells.length - 1];
      if (!last || run.x - last.x > 10) cells.push({ x: run.x, text: run.text });
      else last.text += run.text;
    }
    return cells.map(cell => cell.text.replace(/\s+/g, " ").trim()).filter(Boolean).join("\t");
  }).filter(Boolean).join("\n");
}

/** Reads text operators, including FlateDecode streams Crystal Reports uses for invoices. */
export function pdfText(bytes: Buffer | string): string {
  const pdf = typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes;
  if (pdf.length < 5) return "";
  let objects: Map<number, PdfObject>;
  try {
    objects = parsePdfObjects(pdf);
  } catch {
    return "";
  }
  const pages: string[] = [];
  for (const object of objects.values()) {
    if (!object.stream) continue;
    if (/\/Subtype\s*\/Image|\/FontFile/.test(object.header)) continue;
    const inflated = inflateStream(object.header, object.stream);
    if (!inflated) continue;
    const content = inflated.toString("latin1");
    if (!content.includes("Tj") && !content.includes("TJ")) continue;
    const text = textFromContent(content);
    if (text) pages.push(text);
  }
  return pages.join("\n");
}

function resolveColorSpace(header: string, objects: Map<number, PdfObject>): string {
  const ref = /\/ColorSpace\s+(\d+)\s+0\s+R/.exec(header);
  if (ref) return objects.get(Number(ref[1]))?.header ?? "";
  return /\/ColorSpace\s*(\[[^\]]+\]|\/[A-Za-z0-9]+)/.exec(header)?.[1] ?? "";
}

function imageRgb(header: string, raw: Buffer, width: number, height: number, objects: Map<number, PdfObject>): Buffer | null {
  const space = resolveColorSpace(header, objects);
  if (/Indexed/.test(space) && /DeviceRGB/.test(space)) {
    const paletteRef = /(\d+)\s+0\s+R/.exec(space);
    const paletteObject = paletteRef ? objects.get(Number(paletteRef[1])) : undefined;
    const palette = paletteObject?.stream ? inflateStream(paletteObject.header, paletteObject.stream) : null;
    if (!palette || raw.length < width * height) return null;
    const rgb = Buffer.alloc(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const source = raw[pixel] * 3;
      rgb[pixel * 3] = palette[source] ?? 0;
      rgb[pixel * 3 + 1] = palette[source + 1] ?? 0;
      rgb[pixel * 3 + 2] = palette[source + 2] ?? 0;
    }
    return rgb;
  }
  if (/DeviceRGB/.test(space) && raw.length >= width * height * 3) return raw.subarray(0, width * height * 3);
  if (/DeviceGray/.test(space) && raw.length >= width * height) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      rgb[pixel * 3] = rgb[pixel * 3 + 1] = rgb[pixel * 3 + 2] = raw[pixel];
    }
    return rgb;
  }
  return null;
}

function logoPng(rgb: Buffer, width: number, top: number, bottom: number): Buffer {
  const scale = 8;
  const cropHeight = bottom - top + 1;
  const scaledWidth = width * scale;
  const scaledHeight = cropHeight * scale;
  const rows: Buffer[] = [];
  for (let y = 0; y < scaledHeight; y += 1) {
    const sourceY = top + Math.floor(y / scale);
    const row = Buffer.alloc(1 + scaledWidth * 3);
    for (let x = 0; x < scaledWidth; x += 1) {
      const source = (sourceY * width + Math.floor(x / scale)) * 3;
      const red = rgb[source];
      const green = rgb[source + 1];
      const blue = rgb[source + 2];
      const gray = Math.max(red, green, blue) - Math.min(red, green, blue) < 40;
      const value = gray && Math.max(red, green, blue) < 180 ? 0 : 255;
      const dest = 1 + x * 3;
      row[dest] = row[dest + 1] = row[dest + 2] = value;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(scaledWidth, 0);
  ihdr.writeUInt32BE(scaledHeight, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

/** Letterhead images, scaled and turned into dark-on-white so a logo name can be read. */
export function invoiceLogoPngs(pdf: Buffer): Buffer[] {
  let objects: Map<number, PdfObject>;
  try {
    objects = parsePdfObjects(pdf);
  } catch {
    return [];
  }
  const pngs: Buffer[] = [];
  for (const object of objects.values()) {
    if (!object.stream || !/\/Subtype\s*\/Image/.test(object.header)) continue;
    const width = Number(/\/Width\s+(\d+)/.exec(object.header)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(object.header)?.[1] ?? 0);
    const bits = Number(/\/BitsPerComponent\s+(\d+)/.exec(object.header)?.[1] ?? 8);
    if (bits !== 8 || width < 40 || height < 16 || width > 1400 || height > 900) continue;
    const raw = inflateStream(object.header, object.stream);
    if (!raw) continue;
    const rgb = imageRgb(object.header, raw, width, height, objects);
    if (!rgb) continue;
    const textRow = (y: number) => {
      let dark = 0;
      for (let x = 0; x < width; x += 1) {
        const source = (y * width + x) * 3;
        const red = rgb[source];
        const green = rgb[source + 1];
        const blue = rgb[source + 2];
        const gray = Math.max(red, green, blue) - Math.min(red, green, blue) < 40;
        if (gray && Math.max(red, green, blue) < 160) dark += 1;
      }
      return dark > width * 0.04;
    };
    const marked = Array.from({ length: height }, (_, y) => textRow(y));
    const bands: { top: number; bottom: number }[] = [];
    let bandStart = -1;
    for (let y = 0; y < height; y += 1) {
      if (marked[y]) {
        if (bandStart < 0) bandStart = y;
      } else if (bandStart >= 0) {
        if (y - bandStart >= 4) bands.push({ top: Math.max(0, bandStart - 2), bottom: Math.min(height - 1, y + 1) });
        bandStart = -1;
      }
    }
    if (bandStart >= 0 && height - bandStart >= 4) bands.push({ top: Math.max(0, bandStart - 2), bottom: height - 1 });
    if (!bands.length) bands.push({ top: 0, bottom: height - 1 });
    for (const band of bands) pngs.push(logoPng(rgb, width, band.top, band.bottom));
  }
  return pngs;
}
