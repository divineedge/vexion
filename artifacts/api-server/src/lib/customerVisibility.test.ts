import { describe, expect, it } from "vitest";
import { isHiddenColumnMissing } from "./customerVisibility";

describe("isHiddenColumnMissing", () => {
  it("recognizes the wrapped Postgres error from the customer list query", () => {
    const cause = Object.assign(new Error('column "hidden_at" does not exist'), { code: "42703" });
    const wrapped = new Error('Failed query: select count(*) from "customers" where "hidden_at" is null', { cause });
    expect(isHiddenColumnMissing(wrapped)).toBe(true);
  });

  it("ignores a different missing column and a query that merely mentions the filter", () => {
    const cause = Object.assign(new Error('column "archived_at" does not exist'), { code: "42703" });
    const wrapped = new Error('Failed query: select "hidden_at" from "customers"', { cause });
    expect(isHiddenColumnMissing(wrapped)).toBe(false);
    expect(isHiddenColumnMissing(new Error("connection refused"))).toBe(false);
  });
});
