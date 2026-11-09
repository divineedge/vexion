/** Page size for GET /customers. A missing or zero limit returns every matching row. */
export function customerListPage(rawPage: string | undefined, rawLimit: string | undefined): { page: number; limit: number | null } {
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  if (rawLimit == null || rawLimit.trim() === "" || rawLimit === "0" || rawLimit.toLowerCase() === "all") {
    return { page: 1, limit: null };
  }
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return { page, limit: 100 };
  return { page, limit: parsed };
}
