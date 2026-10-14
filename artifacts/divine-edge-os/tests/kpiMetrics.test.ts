import { describe, it, expect } from 'vitest';
import { buildKpiMetrics } from '../src/lib/kpiMetrics';
import { defaultBudgetYear } from '../src/lib/budgetCalc';
import { pricingBudgetRate } from '../src/lib/pricingBudget';
import type { KpiReport, KpiJob, KpiId } from '../src/lib/kpiApi';

function fixture(): KpiReport {
  return { from:'2025-01-01',to:'2026-12-31',timezone:'UTC',asOf:'2026-10-14T12:00:00Z',budgetJson:null,
    jobs:[],invoices:[],estimates:[],callbacks:[],previousCustomers:[],unbilled:[],
    clock:{paidMinutes:0,jobMinutes:0,other:[],openEntries:0},receipts:{deposits:0,prepayments:0} };
}
const metric=(r:KpiReport,id:KpiId)=>buildKpiMetrics(r).find(m=>m.id===id)!;
const job:KpiJob={id:1,title:'Lawn job',customerId:10,customerName:'Customer',serviceId:7,crewId:2,crewName:'Solo',
  status:'completed',scheduledDate:'2026-06-01',completedDate:'2026-06-01',total:100,minutes:60,budgetMinutes:120,
  openTimers:false,materialSell:20,materialCost:10,laborCost:30,fuelCost:5,materialsInvalid:false,
  workers:[{id:4,name:'Owner working in field',minutes:60}]};

describe('company KPI calculations',()=>{
  it('offers all thirteen KPIs and distinguishes unavailable denominators from zero cash',()=>{
    const r=fixture();expect(buildKpiMetrics(r)).toHaveLength(13);
    for(const id of ['revenue_hour','efficiency','margin','acceptance','callbacks','retention','schedule','productive','customer_spend'] as KpiId[])
      expect(metric(r,id).value).toBeNull();
    expect(metric(r,'cash').value).toBe(0);
  });
  it('calculates selected-range spend by distinct customers, with independent annual averages',()=>{
    const r=fixture();
    r.invoices=[
      {id:1,number:'A',customerId:10,customerName:'A',total:100,status:'paid',balance:0,cash:70,paidDate:'2025-06-01',dueDate:null},
      {id:2,number:'B',customerId:10,customerName:'A',total:200,status:'paid',balance:0,cash:200,paidDate:'2026-06-01',dueDate:null},
      {id:3,number:'C',customerId:11,customerName:'B',total:300,status:'paid',balance:0,cash:300,paidDate:'2026-06-01',dueDate:null},
      {id:4,number:'D',customerId:12,customerName:'C',total:500,status:'sent',balance:500,cash:0,paidDate:null,dueDate:null},
    ];
    const m=metric(r,'customer_spend');expect(m.value).toBe(300);
    expect(m.rows.find(x=>x.label.startsWith('2025'))?.value).toContain('100.00');
    expect(m.rows.find(x=>x.label.startsWith('2026'))?.value).toContain('250.00');
    r.receipts={deposits:30,prepayments:20};expect(metric(r,'cash').value).toBe(620);
  });
  it('uses comparable person-hours and attributes the same efficiency to a one-worker crew and owner',()=>{
    const r=fixture();r.jobs=[job,{...job,id:2,budgetMinutes:0,minutes:300,openTimers:true}];
    expect(metric(r,'revenue_hour').value).toBe(80);
    const e=metric(r,'efficiency');expect(e.value).toBe(200);
    expect(e.rows.find(x=>x.label==='Crew: Solo')?.value).toBe('200.0%');
    expect(e.rows.find(x=>x.label.includes('Owner'))?.value).toBe('200.0%');
  });
  it('applies the service budget minimum before materials when identifying underpriced work',()=>{
    const r=fixture();const year=defaultBudgetYear(2026);year.divisions[0].serviceIds=[7];year.divisions[0].minimumVisitHours=2;
    r.budgetJson=JSON.stringify([year]);const rate=pricingBudgetRate(year,7)!;
    r.jobs=[{...job,minutes:15,total:rate.floor-1}];
    expect(metric(r,'underpriced').value).toBe(100);
    r.jobs=[{...job,minutes:15,total:rate.floor+20}];expect(metric(r,'underpriced').value).toBe(0);
  });
  it('excludes unknown costs instead of treating them as zero margin costs',()=>{
    const r=fixture();r.jobs=[job];expect(metric(r,'margin').value).toBe(55);
    r.jobs=[{...job,laborCost:null}];expect(metric(r,'margin').value).toBeNull();
  });
  it('separates review-needed work from billing holds and scheduled cycles',()=>{
    const r=fixture();r.unbilled=[
      {id:1,title:'Review',customerName:'A',totalAmount:100,reason:'No invoice',needsAttention:true,canInvoice:true},
      {id:2,title:'Hold',customerName:'A',totalAmount:200,reason:'Billing hold: review',needsAttention:true,canInvoice:false},
      {id:3,title:'Cycle',customerName:'A',totalAmount:300,reason:'Waiting for scheduled billing cycle',needsAttention:false,canInvoice:false},
    ];
    expect(metric(r,'unbilled').value).toBe(100);expect(metric(r,'unbilled').rows).toHaveLength(3);
  });
  it('uses sent estimate cohorts, every callback ticket and repeat-service customer cohorts',()=>{
    const r=fixture();r.jobs=[job];r.estimates=[
      {id:1,customerName:'A',total:100,status:'approved',reason:null},{id:2,customerName:'B',total:300,status:'declined',reason:'Price'},
    ];r.callbacks=[{id:1,jobId:1,title:'Lawn',reason:'A',crewName:'Solo'},{id:2,jobId:1,title:'Lawn',reason:'B',crewName:'Solo'}];
    r.previousCustomers=[10,11];expect(metric(r,'acceptance').value).toBe(50);expect(metric(r,'acceptance').summary).toContain('25.0% by value');
    expect(metric(r,'callbacks').value).toBe(200);expect(metric(r,'retention').value).toBe(50);
  });
  it('does not count future completions as scheduled work completed within the range',()=>{
    const r=fixture();r.to='2026-06-01';r.jobs=[job,{...job,id:2,completedDate:'2026-06-02'}];
    expect(metric(r,'schedule').value).toBe(50);
    r.clock={paidMinutes:120,jobMinutes:60,other:[{type:'travel',minutes:30}],openEntries:0};
    expect(metric(r,'productive').value).toBe(50);
  });
});
