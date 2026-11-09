import { describe, expect, it } from "vitest";
import { coerceEstimateDepositSettings, defaultEstimateDepositSettings, depositInvoiceSatisfied, estimateDepositSettingsDocument, firstMatchingDepositRule, linkAcceptancePayment, mergeEstimateDepositSettings, readEstimateDepositSettings, readScheduleDeposit, schedulingDepositTarget, unpaidScheduleDepositMessage, validateDepositRules, validateScheduleDeposit, type DepositRule } from "./companyDepositRules";
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
  it("requires a fixed or percentage deposit before a job can be scheduled", () => {
    expect(validateScheduleDeposit({ enabled: false, mode: "fixed", value: null })).toBeNull();
    expect(validateScheduleDeposit({ enabled: true, mode: "percent", value: 25 })).toBeNull();
    expect(validateScheduleDeposit({ enabled: true, mode: "percent", value: 101 })).not.toBeNull();
    expect(unpaidScheduleDepositMessage({ enabled: true, mode: "fixed", value: 50 }, 0, 0)).toBe("Deposit of $50.00 required prior to scheduling");
    expect(unpaidScheduleDepositMessage({ enabled: true, mode: "percent", value: 20 }, 200, 0)).toBe("Deposit of $40.00 required prior to scheduling");
    expect(unpaidScheduleDepositMessage({ enabled: true, mode: "fixed", value: 50 }, 200, 50)).toBeNull();
    expect(unpaidScheduleDepositMessage({ enabled: true, mode: "percent", value: 10 }, 0, 0)).toContain("positive");
  });
  it("keeps deposit choices in one estimate settings document", () => {
    const stored = { estimate_deposit_settings: { enabled: true, defaultType: "fixed", defaultAmount: 50, requireBeforeScheduling: true, allowEstimateOverrides: false, rules: [] } };
    expect(readEstimateDepositSettings(stored)).toMatchObject({ enabled: true, defaultType: "fixed", defaultAmount: 50, requireBeforeScheduling: true, allowEstimateOverrides: false });
    expect(readScheduleDeposit({ estimate_deposit_settings: { enabled: true, defaultType: "percent", defaultAmount: 20, requireBeforeScheduling: false, allowEstimateOverrides: false, rules: [] } })).toMatchObject({ enabled: false, value: 20 });
    const legacy = readEstimateDepositSettings({ depositType: "percent", depositValue: 25, depositRules: [rule], scheduleDeposit: { enabled: false, mode: "fixed", value: null } });
    expect(legacy).toMatchObject({ enabled: true, defaultAmount: 25, allowEstimateOverrides: true, requireBeforeScheduling: true });
    expect(readEstimateDepositSettings({ depositRules: [{ ...rule, minTotal: null, maxTotal: null }] }).requireBeforeScheduling).toBe(true);
    const merged = mergeEstimateDepositSettings({ depositType: "percent", depositValue: 25, depositRules: [rule] }, { requireBeforeScheduling: false, allowEstimateOverrides: false });
    expect(merged.requireBeforeScheduling).toBe(false);
    expect(estimateDepositSettingsDocument(merged).scheduleDeposit).toMatchObject({ enabled: false, mode: "percent", value: 25 });
    expect(readEstimateDepositSettings({})).toMatchObject({ enabled: false, requireBeforeScheduling: false });
    expect(coerceEstimateDepositSettings(undefined)).toEqual(defaultEstimateDepositSettings);
    expect(coerceEstimateDepositSettings({ enabled: true, defaultAmount: 25 }).defaultType).toBe("percent");
    expect(depositInvoiceSatisfied({ status: "paid", total: 40 })).toBe(true);
    expect(depositInvoiceSatisfied({ status: "draft", total: 40, creditApplied: 40 })).toBe(true);
    expect(depositInvoiceSatisfied({ status: "sent", total: 40 })).toBe(false);
    expect(schedulingDepositTarget("percent", 25, 200).amount).toBe(50);
    expect(schedulingDepositTarget("fixed", 100, 80).amount).toBe(80);
    expect(schedulingDepositTarget("fixed", 100, 0).amount).toBe(100);
    const withSchedule = readEstimateDepositSettings({ estimate_deposit_settings: { enabled: true, defaultType: "percent", defaultAmount: 10, requireBeforeScheduling: true, allowEstimateOverrides: false, rules: [], scheduling_deposit_type: "fixed", scheduling_deposit_value: 100, scheduling_deposit_fixed: 100, scheduling_deposit_percent: 15 } });
    expect(withSchedule.scheduling_deposit_type).toBe("fixed");
    expect(withSchedule.schedulingDepositValue).toBe(100);
    expect(withSchedule.schedulingDepositPercent).toBe(15);
    expect(readScheduleDeposit({ estimate_deposit_settings: withSchedule })).toMatchObject({ enabled: true, mode: "fixed", value: 100 });
  });
  it("keeps card-on-file and prepayment together", () => {
    expect(linkAcceptancePayment(false, false)).toBe(false);
    expect(linkAcceptancePayment(true, false)).toBe(true);
    expect(coerceEstimateDepositSettings(undefined).require_card_on_acceptance).toBe(false);
    const turnedOn = mergeEstimateDepositSettings({}, { require_card_on_acceptance: true, require_prepayment_on_acceptance: false });
    expect(turnedOn.requireCardOnAcceptance).toBe(true);
    expect(turnedOn.require_prepayment_on_acceptance).toBe(true);
    const kept = mergeEstimateDepositSettings({ estimate_deposit_settings: turnedOn }, { enabled: true });
    expect(kept.requirePrepaymentOnAcceptance).toBe(true);
  });
  it("combines by default and splits by property without losing unassigned charges", () => {
    const lines = [{propertyId:1,total:100},{propertyId:2,total:200},{propertyId:1,total:50},{propertyId:null,total:10}];
    expect(propertyInvoiceGroups(lines,"combined")).toEqual([lines]);
    expect(propertyInvoiceGroups(lines,"by_property")).toEqual([[lines[0],lines[2]],[lines[1]],[lines[3]]]);
  });
});
