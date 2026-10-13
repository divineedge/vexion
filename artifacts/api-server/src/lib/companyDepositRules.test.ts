import { describe, expect, it } from "vitest";
import { firstMatchingDepositRule, validateDepositRules, type DepositRule } from "./companyDepositRules";
import { propertyInvoiceGroups } from "./invoicePropertyGrouping";

const rule: DepositRule = { id: "fixture", name: "Matching rule", enabled: true, minTotal: 500, maxTotal: 1000,
  serviceIds: [1, 2], serviceMatch: "any", depositType: "percent", depositValue: 25 };

describe("configurable deposit matching and property grouping", () => {
  it("uses inclusive minimum and exclusive maximum, and both service and amount conditions", () => {
    expect(firstMatchingDepositRule([rule], 500, [1])).toBe(rule);
    expect(firstMatchingDepositRule([rule], 499.99, [1])).toBeUndefined();
    expect(firstMatchingDepositRule([rule], 1000, [1])).toBeUndefined();
    expect(firstMatchingDepositRule([rule], 600, [3])).toBeUndefined();
  });
  it("supports all-service matches, enabled state, ordered overlaps and unknown totals", () => {
    const all = { ...rule, serviceMatch: "all" as const };
    expect(firstMatchingDepositRule([all], 600, [1])).toBeUndefined();
    expect(firstMatchingDepositRule([all], 600, [1, 2])).toBe(all);
    expect(firstMatchingDepositRule([{...rule,enabled:false}],600,[1])).toBeUndefined();
    expect(firstMatchingDepositRule([rule,{...rule,id:"second"}],600,[1])).toBe(rule);
    expect(firstMatchingDepositRule([rule],undefined,[1])).toBeUndefined();
  });
  it("validates customizable amount types and rejects duplicate identities and invalid ranges", () => {
    expect(validateDepositRules([rule])).toBeNull();
    expect(validateDepositRules([{...rule,depositValue:101}])).not.toBeNull();
    expect(validateDepositRules([{...rule,maxTotal:500}])).not.toBeNull();
    expect(validateDepositRules([rule,rule])).not.toBeNull();
    expect(validateDepositRules([{...rule,depositType:"full",depositValue:null}])).toBeNull();
    expect(validateDepositRules([{...rule,depositType:"none",depositValue:null}])).toBeNull();
  });
  it("combines by default and splits by property without losing unassigned charges", () => {
    const lines = [{propertyId:1,total:100},{propertyId:2,total:200},{propertyId:1,total:50},{propertyId:null,total:10}];
    expect(propertyInvoiceGroups(lines,"combined")).toEqual([lines]);
    expect(propertyInvoiceGroups(lines,"by_property")).toEqual([[lines[0],lines[2]],[lines[1]],[lines[3]]]);
  });
});
