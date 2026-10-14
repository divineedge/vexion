import { describe,it,expect } from 'vitest';
import { kpiSettingsInput,kpiIds,defaultKpiSettings } from './kpiSettings';
describe('company KPI selection rules',()=>{
  it('accepts defaults, all KPIs and intentionally empty selections',()=>{
    expect(kpiSettingsInput.safeParse(defaultKpiSettings).success).toBe(true);
    expect(kpiSettingsInput.safeParse({mainKpis:[...kpiIds],detailKpis:[...kpiIds]}).success).toBe(true);
    expect(kpiSettingsInput.safeParse({mainKpis:[],detailKpis:[]}).success).toBe(true);
  });
  it('rejects unknown, duplicate, untyped and inconsistent selections',()=>{
    for(const input of [
      {mainKpis:['unknown'],detailKpis:[]},{mainKpis:['cash','cash'],detailKpis:['cash']},
      {mainKpis:['cash'],detailKpis:[]},{mainKpis:null,detailKpis:[]},{mainKpis:[],detailKpis:['cash'],tenantId:999},
    ]) expect(kpiSettingsInput.safeParse(input).success).toBe(false);
  });
});
