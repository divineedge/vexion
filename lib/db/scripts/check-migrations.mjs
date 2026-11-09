import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../drizzle");
const files = (await readdir(dir)).filter(name => name.endsWith(".sql")).sort();
const problems = [];
for (const name of files) {
  const lines = (await readFile(path.join(dir, name), "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    if (/\bADD\s+COLUMN\b/i.test(line) && !/\bIF\s+NOT\s+EXISTS\b/i.test(line)) {
      problems.push(`${where} add the column with IF NOT EXISTS`);
    }
    if (/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(line) && !/destructive-allowed/i.test(line)) {
      problems.push(`${where} destructive SQL needs a -- destructive-allowed comment`);
    }
  });
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} migrations.`);
