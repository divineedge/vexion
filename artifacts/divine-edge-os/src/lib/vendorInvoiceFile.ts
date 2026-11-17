/** Matches the API limit in vendor invoice intake. */
export const MAX_VENDOR_INVOICE_BYTES = 12 * 1024 * 1024;

export type PdfTextItem = { str?: string; transform?: number[] };

/** Keeps words that share a baseline on one line so invoice rows stay readable. */
export function groupPdfTextItems(items: PdfTextItem[]): string {
  const rows: { y: number; parts: string[] }[] = [];
  for (const item of items) {
    const text = (item.str ?? "").replace(/\u0000/g, "");
    if (!text.trim()) continue;
    const y = Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0;
    const baseline = Number.isFinite(y) ? y : 0;
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - baseline) <= 2) last.parts.push(text);
    else rows.push({ y: baseline, parts: [text] });
  }
  return rows.map(row => row.parts.join(" ").replace(/[ ]+/g, " ").trim()).filter(Boolean).join("\n");
}
