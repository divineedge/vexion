import { describe,it,expect } from "vitest";
import { generateRangeVisits,validateVisitRange,planDateInZone,VisitRangeError } from "./planVisitRange";
const services=[{serviceId:1,serviceName:"Lawn",frequencyDays:7}];
const base={firstServiceDate:"2027-04-01",lastServiceDate:"2027-08-29",totalVisits:5,spacingUnit:"weeks",preferredWeekday:1};
describe("Finite service-plan date ranges",()=>{
  it("splits 150 days into four gaps and keeps both endpoints among five visits",()=>{
    const visits=generateRangeVisits(base,services,"UTC");
    expect(visits.map(v=>v.date.toISOString().slice(0,10))).toEqual(["2027-04-01","2027-05-10","2027-06-14","2027-07-26","2027-08-29"]);
    expect(visits[1].idealDate.getTime()-visits[0].idealDate.getTime()).toBe(37.5*86400000);
    expect(visits.slice(1,-1).every(v=>v.date.getUTCDay()===1)).toBe(true);
    expect(visits.every(v=>!v.clustered)).toBe(true);
  });
  it("days and weeks express the same exact interval without rounding to whole weeks",()=>{
    expect(generateRangeVisits({...base,spacingUnit:"days"},services,"UTC").map(v=>v.date.toISOString()))
      .toEqual(generateRangeVisits(base,services,"UTC").map(v=>v.date.toISOString()));
    expect(validateVisitRange({...base,spacingUnit:undefined}).spacingUnit).toBe("weeks");
  });
  it("two visits are exactly the two chosen dates, regardless of preferred weekday",()=>{
    const visits=generateRangeVisits({...base,totalVisits:2},services,"America/Denver");
    expect(visits).toHaveLength(2);
    expect(visits[0].date).toEqual(planDateInZone(base.firstServiceDate,"America/Denver"));
    expect(visits[1].date).toEqual(planDateInZone(base.lastServiceDate,"America/Denver"));
  });
  it("uses the nearest weekday before or after the ideal day; ties go later",()=>{
    const visits=generateRangeVisits({firstServiceDate:"2027-04-01",lastServiceDate:"2027-04-15",totalVisits:3,spacingUnit:"weeks",preferredWeekday:1},services,"UTC");
    // Ideal Thursday Apr 8; Monday Apr 5 is closer than Apr 12.
    expect(visits[1].date.toISOString().slice(0,10)).toBe("2027-04-05");
  });
  it.each(["America/Denver","Pacific/Kiritimati","Pacific/Honolulu","Europe/London"])("keeps local dates and weekdays through DST and extreme offsets in %s",zone=>{
    const range={...base,firstServiceDate:"2027-02-01",lastServiceDate:"2027-05-31"};
    const visits=generateRangeVisits(range,services,zone);
    const date=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
    expect(date(visits[0].date)).toBe(range.firstServiceDate);
    expect(date(visits.at(-1)!.date)).toBe(range.lastServiceDate);
    for(const visit of visits.slice(1,-1))expect(new Intl.DateTimeFormat("en-US",{timeZone:zone,weekday:"long"}).format(visit.date)).toBe("Monday");
  });
  it("rejects overlapping preferred-weekday visits rather than silently dropping services",()=>{
    expect(()=>generateRangeVisits({...base,lastServiceDate:"2027-04-08",totalVisits:5},services,"UTC")).toThrow(VisitRangeError);
  });
  it.each([
    {totalVisits:1},{totalVisits:2.5},{totalVisits:10000},{preferredWeekday:7},
    {lastServiceDate:"2027-03-01"},{lastServiceDate:"2027-02-30"},{spacingUnit:"months"},{firstServiceDate:"not a date"},
  ])("rejects invalid input %j",bad=>expect(()=>validateVisitRange({...base,...bad})).toThrow(VisitRangeError));
  it("distributes a total visit count across services in template order, not five visits per service",()=>{
    const visits=generateRangeVisits(base,[...services,{serviceId:2,serviceName:"Treatment",frequencyDays:30}],"UTC");
    expect(visits.map(v=>v.serviceId)).toEqual([1,2,1,2,1]);
  });
});
