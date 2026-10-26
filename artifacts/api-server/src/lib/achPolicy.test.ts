import { describe, it, expect } from "vitest";
import { achPolicySchema, allowedInvoiceMethods, readAchPolicy } from "./achPolicy";

describe("ACH invoice policy: exact-cent thresholds, safe legacy default",()=>{
  it("leaves existing companies card-only without silently activating bank debits",()=>{
    expect(readAchPolicy(null)).toEqual({mode:"disabled",threshold:500});
    expect(readAchPolicy({depositType:"full",requirePrepay:true}).mode).toBe("disabled");
  });
  it.each([
    ["disabled",0,["card"]],["disabled",100_000,["card"]],
    ["optional",1,["card","us_bank_account"]],["optional",100_000,["card","us_bank_account"]],
    ["offer_above",49_999,["card"]],["offer_above",50_000,["card","us_bank_account"]],["offer_above",50_001,["card","us_bank_account"]],
    ["require_above",49_999,["card"]],["require_above",50_000,["us_bank_account"]],["require_above",50_001,["us_bank_account"]],
  ] as const)("%s at %s cents resolves allowed methods",(mode,cents,expected)=>{
    expect(allowedInvoiceMethods({mode,threshold:500},cents)).toEqual(expected);
  });
  it("supports zero and fractional-dollar thresholds without floating-point boundary mistakes",()=>{
    expect(allowedInvoiceMethods({mode:"require_above",threshold:0},1)).toEqual(["us_bank_account"]);
    expect(allowedInvoiceMethods({mode:"require_above",threshold:0.29},28)).toEqual(["card"]);
    expect(allowedInvoiceMethods({mode:"require_above",threshold:0.29},29)).toEqual(["us_bank_account"]);
  });
  it.each([-1,Infinity,NaN,1_000_001,0.001,"500",null])("rejects invalid threshold %s",threshold=>{
    expect(achPolicySchema.safeParse({mode:"require_above",threshold}).success).toBe(false);
  });
  it("rejects unsupported modes and unknown keys rather than storing arbitrary settings",()=>{
    expect(achPolicySchema.safeParse({mode:"anything",threshold:5}).success).toBe(false);
    expect(achPolicySchema.safeParse({mode:"optional",threshold:5,tenantId:999}).success).toBe(false);
    expect(()=>readAchPolicy({ach:{mode:"require_above",threshold:-5}})).toThrow();
    expect(()=>allowedInvoiceMethods({mode:"optional",threshold:1},1.5)).toThrow();
  });
});
