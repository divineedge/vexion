import { describe, expect, it } from "vitest";
import { jobMeasurement, materialBreakdown, reportCostTotals } from "./jobEconomics";

describe("job economics purchase-cost evidence",()=>{
  it("uses frozen highest-cost stock usage rather than current or selling prices",()=>{
    const result=materialBreakdown([{name:"Seed",quantity:2,unitPrice:100,total:200,costPrice:5,_stockUsage:{total:30}}],[]);
    expect(result.materialCost).toBe(30);
    expect(result.materials[0].unitCost).toBe(15);
  });
  it("uses saved legacy purchase cost, never a selling total",()=>{
    expect(materialBreakdown([{name:"Part",quantity:3,costPrice:4,total:90}],[]).materialCost).toBe(12);
    expect(materialBreakdown([{name:"Part",quantity:3,total:90}],[]).materialCost).toBeNull();
  });
  it("does not report no supplies when planned supply usage is unrecorded",()=>{
    expect(materialBreakdown([],[{inventoryItemId:1,quantity:2}]).materialCost).toBeNull();
    expect(materialBreakdown(null,[]).materialCost).toBeNull();
    expect(materialBreakdown([],[]).materialCost).toBe(0);
  });
  it("missing costs cannot become a reported profit",()=>{
    expect(reportCostTotals(null,10,5,20,100)).toEqual({knownCost:35,totalCost:null,profit:null,marginPct:null});
    expect(reportCostTotals(60,10,5,20,100)).toEqual({knownCost:95,totalCost:95,profit:5,marginPct:5});
    expect(reportCostTotals(60,10,5,40,100).profit).toBe(-15);
    expect(reportCostTotals(60,10,5,40,0).marginPct).toBeNull();
    expect(reportCostTotals(null,null,5,20,100,10,30)).toEqual({knownCost:65,totalCost:null,profit:null,marginPct:null});
  });
});
describe("job measurement and matrix classification",()=>{
  const zones=[{id:"lawn",name:"Lawn",mode:"area"},{id:"edge",name:"Edging",mode:"linear"}];
  const property={serviceableAreaSqft:9999,measurementPolygons:[
    {zoneTypeId:"lawn",areaSqft:1000},{label:"Lawn",areaSqft:500},
    {zoneTypeId:"lawn",areaSqft:800,enabled:false},{zoneTypeId:"edge",mode:"linear",lengthFt:200},
  ]};
  it("uses enabled linked zones and resolves legacy labels, not the full property",()=>{
    expect(jobMeasurement({pricingMode:"matrix",linkedZoneTypeId:"lawn",pricingMatrix:[
      {minSqft:0,maxSqft:1000,price:25},{minSqft:1001,maxSqft:null,price:50},
    ]},property,zones)).toMatchObject({measurement:1500,measurementUnit:"sqft",matrixLabel:"1,001–above sq ft"});
  });
  it("keeps linear measurements separate from area",()=>{
    expect(jobMeasurement({pricingMode:"matrix",linkedZoneTypeId:"edge",pricingMatrix:[]},property,zones))
      .toMatchObject({measurement:200,measurementUnit:"linear_ft"});
  });
  it("never substitutes another zone or a zero measurement for missing evidence",()=>{
    expect(jobMeasurement({pricingMode:"matrix",linkedZoneTypeId:"absent"},property,zones).measurement).toBeNull();
    expect(jobMeasurement({pricingMode:"per_sqft"},{serviceableAreaSqft:0},zones).measurement).toBeNull();
    expect(jobMeasurement({pricingMode:"per_sqft"},{serviceableAreaSqft:4500},zones).measurement).toBe(4500);
  });
});
