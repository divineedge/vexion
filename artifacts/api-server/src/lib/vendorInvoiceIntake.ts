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

const money = (value: string) => Number(value.replace(/,/g, ""));

export function extractInvoiceText(raw: string): ExtractedInvoice {
  const text = raw.replace(/\r/g, "").trim();
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const vendorName = lines.find(line => !/invoice|bill to|date|total|qty|quantity/i.test(line)) ?? "";
  const invoiceNumber = text.match(/invoice\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Z0-9-]+)/i)?.[1] ?? "";
  const dateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/) ?? text.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/);
  const invoiceDate = dateMatch ? toIsoDate(dateMatch[1]) : new Date().toISOString().slice(0, 10);
  const taxAmount = money(text.match(/tax\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  const shippingAmount = money(text.match(/shipping\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  const totalAmount = money(text.match(/total\s*[:$]?\s*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? "0");
  const parsed: ExtractedLine[] = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+\$?([0-9,]+\.\d{2,4})\s+\$?([0-9,]+\.\d{2})$/);
    if (!match) return;
    const description = match[1].trim();
    const quantity = Number(match[2]);
    const unitPrice = money(match[3]);
    const totalPrice = money(match[4]);
    const fuel = /diesel|gasoline|unleaded|fuel/i.test(description);
    parsed.push({
      description,
      quantity,
      unitPrice,
      totalPrice,
      destinationType: fuel ? "bulk_fuel" : "inventory",
      bbox: { x: 6, y: Math.min(88, 12 + index * 6), width: 88, height: 5 },
    });
  });
  return { vendorName, invoiceNumber, invoiceDate, totalAmount, taxAmount, shippingAmount, lines: parsed };
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
  const found = [...bytes.matchAll(/\(([^()\\]{2,})\)/g)].map(match => match[1]);
  return found.join("\n");
}
