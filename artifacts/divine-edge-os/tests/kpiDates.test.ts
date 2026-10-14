import {describe,it,expect} from 'vitest';
import {getKpiDefaultRange,validateKpiRange} from '../src/lib/kpiDates';
import type {KpiSettings} from '../src/lib/kpiApi';
const base:KpiSettings={mainKpis:[],detailKpis:[]};
describe('KPI dashboard date defaults',()=>{
  it('preserves legacy selections while using year to date',()=>{
    expect(getKpiDefaultRange(base,'2026-10-14')).toEqual({from:'2026-01-01',to:'2026-10-14'});
  });
  it('calculates inclusive calendar ranges without local-time DST shifts',()=>{
    const today='2026-03-01';
    for(const [preset,from,to] of [
      ['today',today,today],['week_to_date','2026-02-23',today],
      ['month_to_date','2026-03-01',today],['last_30_days','2026-01-31',today],
      ['previous_year','2025-01-01','2025-12-31'],
    ] as const) expect(getKpiDefaultRange({...base,defaultDateRange:preset},today)).toEqual({from,to});
    expect(getKpiDefaultRange({...base,defaultDateRange:'week_to_date'},'2026-01-01').from).toBe('2025-12-29');
    expect(getKpiDefaultRange({...base,defaultDateRange:'last_30_days'},'2024-03-01').from).toBe('2024-02-01');
  });
  it('honors saved custom years, rejects invalid dates and overly long ranges',()=>{
    expect(getKpiDefaultRange({...base,defaultDateRange:'custom',customFrom:'2024-02-29',customTo:'2026-10-14'},'2026-10-14')).toEqual({from:'2024-02-29',to:'2026-10-14'});
    expect(validateKpiRange('2024-02-29','2026-10-14')).toBeNull();
    for(const [from,to] of [['2025-02-29','2026-01-01'],['','2026-10-14'],['2027-01-01','2026-10-14'],['2010-01-01','2026-10-14']])
      expect(validateKpiRange(from,to)).not.toBeNull();
  });
});
