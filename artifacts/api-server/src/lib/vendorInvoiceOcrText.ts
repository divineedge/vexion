/** Turns logo OCR into one seller name and drops invoice words. */
export function companyNameFromOcr(text: string): string {
  const lines = text.split(/\n/)
    .map(line => line.replace(/[^A-Za-z0-9&.' -]/g, " ").replace(/\s+/g, " ").trim())
    .filter(line => /[A-Za-z]{3}/.test(line) && line.length <= 48 && !/\d{3,}/.test(line));
  if (!lines.length) return "";
  const logo = lines.filter(line => line.split(" ").length <= 4).slice(0, 3);
  const name = (logo.length ? logo : lines.slice(0, 1)).join(" ").replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{3}/.test(name) || /invoice|page|sold to|ship to|crystal reports/i.test(name)) return "";
  return name;
}
