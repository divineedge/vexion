import { describe, expect, it } from "vitest";
import { customerListPage } from "./customerListPage";

describe("customerListPage", () => {
  it("does not clamp a page large enough for a full imported list", () => {
    expect(customerListPage("2", "500")).toEqual({ page: 2, limit: 500 });
    expect(customerListPage("9", "100")).toEqual({ page: 9, limit: 100 });
  });

  it("returns every row when the caller asks for the full list", () => {
    expect(customerListPage("3", "0")).toEqual({ page: 1, limit: null });
    expect(customerListPage(undefined, "all")).toEqual({ page: 1, limit: null });
  });
});
