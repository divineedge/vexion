import { sql, type SQL } from 'drizzle-orm';

/** Comparison keys only: never write these over the customer's original details. */
export function addressComparisonKey(value: SQL): SQL<string> {
  let key = sql`regexp_replace(lower(coalesce(${value}, '')),
    '([[:alpha:]])[.](?=$|[[:space:],])', '\\1', 'g')`;
  // Only expand suffixes at the end of a street, not words within a street name
  // (e.g. "10 Street Road" must not become "10 St Road").
  for (const [full, short] of [
    ['street', 'st'], ['avenue', 'ave'], ['road', 'rd'], ['drive', 'dr'],
    ['boulevard', 'blvd'], ['lane', 'ln'], ['court', 'ct'], ['circle', 'cir'],
    ['place', 'pl'], ['terrace', 'ter'], ['parkway', 'pkwy'], ['highway', 'hwy'],
  ]) {
    const pattern = `\\m${full}\\M(?=[[:space:]]*($|,|#)|[[:space:]]+(apt|apartment|unit|suite|ste)\\M)`;
    key = sql`regexp_replace(${key}, ${pattern}, ${short}, 'g')`;
  }
  // Preserve unit identifiers, house-number punctuation and locality text.
  return sql<string>`trim(regexp_replace(replace(${key}, ',', ' '), '[[:space:]]+', ' ', 'g'))`;
}

export function phoneComparisonKey(value: SQL): SQL<string> {
  const digits = sql`regexp_replace(coalesce(${value}, ''), '[^0-9]', '', 'g')`;
  // 00 is an explicit international prefix. Only NANP's country code 1
  // can be inferred for a ten-digit local number; never compare last N digits.
  const international = sql`regexp_replace(${digits}, '^00', '')`;
  return sql<string>`regexp_replace(${international}, '^1([0-9]{10})$', '\\1')`;
}
