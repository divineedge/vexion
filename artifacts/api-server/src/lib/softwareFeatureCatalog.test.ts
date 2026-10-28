import { describe, expect, it } from "vitest";
import { featureCatalogDto, featureForApiPath, resolvePolicyFeatureKeys, validateFeatureKeys } from "./softwareFeatures";

describe("complete software feature catalog", () => {
  it.each([
    ["/vendors/1", "vendors"], ["/expenses", "vendors"], ["/expense-categories", "vendors"],
    ["/chemical-applications", "chemicals"], ["/jobs/1/chemical-weather", "chemicals"],
    ["/jobs/1/chemical-applications", "chemicals"], ["/callbacks", "callbacks"],
    ["/tasks", "tasks"], ["/task-bundles/1/start", "tasks"],
    ["/communications/quo/calls", "calls"], ["/followup-queue", "calls"], ["/reviews", "reviews"],
  ])("enforces %s through its actual module", (path, key) => {
    expect(featureForApiPath(path)?.key).toBe(key);
  });
  it("keeps core services visible but not selectable as paid entitlements", () => {
    const catalog = featureCatalogDto();
    expect(new Set(catalog.map(f => f.key)).size).toBe(catalog.length);
    const core = catalog.filter(f => "alwaysIncluded" in f && f.alwaysIncluded);
    expect(core.length).toBe(7);
    expect(core.every(f => f.appPaths.length === 0)).toBe(true);
    expect(() => validateFeatureKeys(core.map(f => f.key))).toThrow();
    expect(featureForApiPath("/customers")).toBeUndefined();
  });
  it("preserves previously unrestricted modules for old subscriptions", () => {
    expect(resolvePolicyFeatureKeys({ version: 1, featureKeys: ["invoices"] })).toEqual(
      expect.arrayContaining(["invoices", "vendors", "chemicals", "callbacks", "tasks", "calls", "reviews"]),
    );
    expect(resolvePolicyFeatureKeys({ featureKeys: ["invoices"] })).toContain("vendors");
    expect(resolvePolicyFeatureKeys({ version: 1, featureKeys: null })).toBeNull();
  });
  it("uses exact choices for newly purchased policies", () => {
    expect(resolvePolicyFeatureKeys({ version: 2, featureKeys: ["invoices"] })).toEqual(["invoices"]);
    expect(resolvePolicyFeatureKeys({ version: 2, featureKeys: [] })).toEqual([]);
    expect(() => resolvePolicyFeatureKeys({ version: 3, featureKeys: [] })).toThrow();
  });
});
