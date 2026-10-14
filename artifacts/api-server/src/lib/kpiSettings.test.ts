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
  it('defaults legacy preferences and validates custom date ranges',()=>{
    const base={mainKpis:[],detailKpis:[]};
    expect(kpiSettingsInput.parse(base).defaultDateRange).toBe('year_to_date');
    for(const defaultDateRange of ['today','week_to_date','month_to_date','year_to_date','last_30_days','previous_year'])
      expect(kpiSettingsInput.safeParse({...base,defaultDateRange}).success).toBe(true);
    expect(kpiSettingsInput.safeParse({...base,defaultDateRange:'custom',customFrom:'2024-02-29',customTo:'2026-10-14'}).success).toBe(true);
    for(const input of [
      {defaultDateRange:'unknown'}, {defaultDateRange:'custom'},
      {defaultDateRange:'custom',customFrom:'2025-02-29',customTo:'2026-01-01'},
      {defaultDateRange:'custom',customFrom:'2026-10-15',customTo:'2026-10-14'},
      {defaultDateRange:'custom',customFrom:'2010-01-01',customTo:'2026-10-14'},
    ]) expect(kpiSettingsInput.safeParse({...base,...input}).success).toBe(false);
  });
});
