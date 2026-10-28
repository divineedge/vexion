import {describe,it,expect} from "vitest";
import {frozenUserSlots,slotPriceParams,subscriptionQuantity,userSlotPolicy,verifySlotPrice} from "./softwareUserSlots";
import type Stripe from "stripe";
describe("purchased extra software user slots",()=>{
  const policy={includedUsers:5,extraUserPriceCents:1000,basePriceCents:4900,interval:"month" as const};
  it("charges the base once, then only users over the included number",()=>{
    expect(slotPriceParams(policy)).toEqual({billing_scheme:"tiered",tiers_mode:"graduated",tiers:[{up_to:5,flat_amount:4900,unit_amount:0},{up_to:"inf",flat_amount:0,unit_amount:1000}]});
    expect(subscriptionQuantity(policy,1)).toBe(5);
    expect(subscriptionQuantity(policy,7)).toBe(7);
  });
  it("keeps ordinary unlimited and hard-cap plans at one subscription item",()=>{
    expect(subscriptionQuantity({...policy,includedUsers:null,extraUserPriceCents:null},100)).toBe(1);
    expect(()=>subscriptionQuantity({...policy,extraUserPriceCents:null},6)).toThrow();
    expect(slotPriceParams({...policy,extraUserPriceCents:null})).toEqual({unit_amount:4900});
  });
  it("preserves explicit zero rates and annual periods",()=>{
    expect(userSlotPolicy({maxUsers:5,extraUserPriceCents:0,price:0,billingInterval:"year"})).toEqual({...policy,extraUserPriceCents:0,basePriceCents:0,interval:"year"});
  });
  it("requires approved, matching provider tiers",()=>{
    const price={active:true,currency:"usd",recurring:{interval:"month",usage_type:"licensed"},billing_scheme:"tiered",tiers_mode:"graduated",tiers:[{up_to:5,flat_amount:4900,unit_amount:0},{up_to:null,flat_amount:0,unit_amount:1000}]} as Stripe.Price;
    expect(()=>verifySlotPrice(price,policy)).not.toThrow();
    expect(()=>verifySlotPrice({...price,tiers_mode:"volume"},policy)).toThrow();
    expect(()=>verifySlotPrice(price,{...policy,extraUserPriceCents:999})).toThrow();
    expect(()=>verifySlotPrice(price,{...policy,interval:"year"})).toThrow();
  });
  it("does not reinterpret legacy snapshots, and rejects corrupt slot policies",()=>{
    expect(frozenUserSlots({version:1,featureKeys:null})).toBeNull();
    expect(frozenUserSlots({userSlots:policy})).toEqual(policy);
    expect(()=>frozenUserSlots({userSlots:{...policy,includedUsers:null}})).toThrow();
    expect(()=>frozenUserSlots({userSlots:{...policy,extraUserPriceCents:-1}})).toThrow();
  });
});
