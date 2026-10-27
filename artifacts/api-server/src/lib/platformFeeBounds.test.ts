import { describe,it,expect } from "vitest";
import { feeCents,effectivePlatformFees,platformSettingsInput } from "./platformBillingPolicy";
import { validateFeatureKeys,featureForApiPath } from "./softwareFeatures";

describe("added platform fee limits",()=>{
  const settings={id:1,enabled:true,cardFeeBps:100,cardFeeFixedCents:25,achFeeBps:50,achFeeFixedCents:0,
    cardFeeMinCents:100,cardFeeMaxCents:1000,achFeeMinCents:50,achFeeMaxCents:500};
  it.each([
    [10000,100,0,250,1000,250],
    [10000,2000,50,100,1000,1000],
    [100,100,0,250,1000,100],
    [0,100,25,100,1000,0],
    [10000,100,25,null,null,125],
    [10000,100,25,0,0,0],
  ])("applies percentage + fixed, then bounds, without increasing the payment", (amount,bps,fixed,min,max,expected)=>{
    expect(feeCents(amount!,bps!,fixed!,min,max)).toBe(expected);
  });
  it("rejects a minimum above the maximum and invalid cents",()=>{
    expect(()=>feeCents(10000,100,0,200,100)).toThrow();
    expect(()=>feeCents(10000,100,0,-1,null)).toThrow();
    expect(()=>feeCents(10000,100,0,0.5,null)).toThrow();
    const {id:_id,...input}=settings;
    expect(platformSettingsInput.safeParse(input).success).toBe(true);
    expect(platformSettingsInput.safeParse({...input,cardFeeMinCents:2000}).success).toBe(false);
  });
  it("inherits blank per-plan bounds and applies explicit plan overrides",()=>{
    const inherited=effectivePlatformFees(undefined,settings,{cardFeeMinCents:null,cardFeeMaxCents:null});
    expect(inherited.cardFeeMinCents).toBe(100);expect(inherited.cardFeeMaxCents).toBe(1000);
    const overridden=effectivePlatformFees(undefined,settings,{cardFeeMinCents:200,cardFeeMaxCents:700,achFeeMaxCents:300});
    expect(overridden.cardFeeMinCents).toBe(200);expect(overridden.cardFeeMaxCents).toBe(700);
    expect(overridden.achFeeMaxCents).toBe(300);
  });
  it("uses the frozen subscriber version instead of later published plan edits",()=>{
    const newer={publishedFeePolicy:{cardFeeBps:900,cardFeeMinCents:900}};
    const fees=effectivePlatformFees(newer as Parameters<typeof effectivePlatformFees>[0],settings,{cardFeeBps:200,cardFeeMinCents:150});
    expect(fees.cardFeeBps).toBe(200);expect(fees.cardFeeMinCents).toBe(150);
  });
  it("rejects inherited contradictory bounds",()=>{
    expect(()=>effectivePlatformFees(undefined,settings,{cardFeeMaxCents:10})).toThrow();
  });
  it("only publishes actual feature keys",()=>{
    expect(validateFeatureKeys(["invoices","scheduling","invoices"])).toEqual(["invoices","scheduling"]);
    expect(()=>validateFeatureKeys(["Any feature I typed"])).toThrow();
  });
  it("matches nested module APIs without misclassifying their parent",()=>{
    expect(featureForApiPath("/jobs/123/forms/4")?.key).toBe("forms");
    expect(featureForApiPath("/users/123/history")?.key).toBe("employee_records");
    expect(featureForApiPath("/reports/pricing-review")?.key).toBe("budget");
    expect(featureForApiPath("/jobs/123")?.key).toBe("scheduling");
    expect(featureForApiPath("/customers")).toBeUndefined();
  });
});
