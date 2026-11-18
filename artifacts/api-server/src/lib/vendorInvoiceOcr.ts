import { tmpdir } from "node:os";
import { companyNameFromOcr } from "./vendorInvoiceOcrText";
import { invoiceLogoPngs } from "./vendorInvoiceIntake";

export { companyNameFromOcr };

/** Reads a letterhead logo when the seller name is not in the PDF text layer. */
export async function vendorNameFromPdf(pdf: Buffer): Promise<string> {
  const logos = invoiceLogoPngs(pdf);
  if (!logos.length) return "";
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, { cachePath: tmpdir() });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz&'- ",
    });
    const names: string[] = [];
    for (const logo of logos) {
      const result = await worker.recognize(logo);
      const name = companyNameFromOcr(String(result.data?.text ?? ""));
      if (name) names.push(name);
    }
    return names.join(" ").replace(/\s+/g, " ").trim();
  } finally {
    await worker.terminate();
  }
}
