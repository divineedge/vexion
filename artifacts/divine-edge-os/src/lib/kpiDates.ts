import type { KpiSettings } from './kpiApi';

export const KPI_DATE_PRESETS = [
  {value:'today',label:'Today'},
  {value:'week_to_date',label:'Week to date (Monday start)'},
  {value:'month_to_date',label:'Month to date'},
  {value:'year_to_date',label:'Year to date'},
  {value:'last_30_days',label:'Last 30 days'},
  {value:'previous_year',label:'Previous calendar year'},
  {value:'custom',label:'Custom date range'},
] as const;
export type KpiDatePreset = typeof KPI_DATE_PRESETS[number]['value'];
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T00:00:00Z`))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export function validateKpiRange(from:string,to:string):string|null {
  if(!validDate(from)||!validDate(to)) return 'Choose valid start and end dates.';
  if(from>to) return 'Start date must be on or before end date.';
  if(Date.parse(to)-Date.parse(from)>3660*86400000) return 'Date range can span at most ten years.';
  return null;
}
/** Today is a company-calendar key, never a device-local Date carrier. */
export function getKpiDefaultRange(settings:KpiSettings,today:string):{from:string;to:string} {
  const year=Number(today.slice(0,4));
  const d=new Date(`${today}T00:00:00Z`);
  const previous=(days:number)=>new Date(d.getTime()-days*86400000).toISOString().slice(0,10);
  switch(settings.defaultDateRange??'year_to_date') {
    case 'today':return {from:today,to:today};
    case 'week_to_date':return {from:previous((d.getUTCDay()+6)%7),to:today};
    case 'month_to_date':return {from:`${today.slice(0,7)}-01`,to:today};
    case 'last_30_days':return {from:previous(29),to:today};
    case 'previous_year':return {from:`${year-1}-01-01`,to:`${year-1}-12-31`};
    case 'custom':return {from:settings.customFrom??'',to:settings.customTo??''};
    default:return {from:`${year}-01-01`,to:today};
  }
}
