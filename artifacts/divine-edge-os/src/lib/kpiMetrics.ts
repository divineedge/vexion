import { KPI_CATALOG, type KpiReport, type KpiMetric, type KpiJob, type KpiDetailRow, type KpiId } from './kpiApi';
import { migrateBudgetPayload } from './budgetCalc';
import { pricingBudgetRate, recommendedJobPrice } from './pricingBudget';

const sum = <T,>(items: T[], fn: (item: T) => number) => items.reduce((total, item) => total + fn(item), 0);
const dollars = (value: number) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const pct = (n: number, d: number) => d > 0 ? n / d * 100 : null;
const round = (value: number) => Math.round(value * 100) / 100;
export function buildKpiMetrics(report: KpiReport): KpiMetric[] {
  let years: ReturnType<typeof migrateBudgetPayload> = [];
  try { years = report.budgetJson ? migrateBudgetPayload(JSON.parse(report.budgetJson)) : []; } catch { /* Missing budget remains explicitly unavailable. */ }
  const inRange = (date: string | null) => date != null && date >= report.from && date <= report.to;
  const complete = report.jobs.filter(j => j.status === 'completed' && inRange(j.completedDate));
  const jobRow = (j: KpiJob, value: string, note?: string): KpiDetailRow =>
    ({ label: `${j.title} · ${j.customerName}`, value, note, href: `/schedule?jobId=${j.id}` });
  const validLabor = complete.filter(j => j.minutes > 0 && !j.openTimers && j.total > 0 && !j.materialsInvalid && j.total >= j.materialSell);
  const priced = validLabor.map(j => {
    const year = years.find(y => y.year === Number(j.completedDate?.slice(0, 4)));
    const rate = pricingBudgetRate(year, j.serviceId);
    return { j, rate, recommended: rate && rate.hourly > 0 && Number.isFinite(rate.hourly) && Number.isFinite(rate.floor)
      ? recommendedJobPrice(j.minutes / 60, j.materialSell, rate) : null };
  });
  const comparable = priced.filter(p => p.recommended != null);
  const laborHours = sum(validLabor, j => j.minutes) / 60;
  const targetHours = sum(comparable, p => p.j.minutes) / 60;
  const target = targetHours ? sum(comparable, p => p.j.minutes / 60 * p.rate!.hourly) / targetHours : null;
  const hourlyJobs = target == null ? validLabor : comparable.map(p=>p.j);
  const hourlyHours = sum(hourlyJobs,j=>j.minutes)/60;
  const budgeted = complete.filter(j => j.budgetMinutes > 0 && j.minutes > 0 && !j.openTimers);
  const under = comparable.filter(p => Math.round(p.j.total * 100) < Math.round(p.recommended! * 100));
  const marginJobs = complete.filter(j => j.total > 0 && j.minutes > 0 && !j.openTimers && !j.materialsInvalid && j.materialCost != null && j.laborCost != null);
  const marginRevenue = sum(marginJobs, j => j.total);
  const marginDollars = sum(marginJobs, j => j.total - j.materialCost! - j.laborCost! - j.fuelCost);
  const asOfDay = new Intl.DateTimeFormat('en-CA', {timeZone:report.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(report.asOf));
  const overdue = report.invoices.filter(i => ['sent','overdue'].includes(i.status) && i.balance > 0 && i.dueDate != null && i.dueDate <= asOfDay);
  const paid = report.invoices.filter(i => i.status === 'paid' && inRange(i.paidDate));
  const accepted = report.estimates.filter(e => e.status === 'approved' || e.status === 'accepted');
  const estimateValue = sum(report.estimates, e => e.total);
  const acceptanceValue = pct(sum(accepted, e => e.total), estimateValue);
  const currentCustomers = new Set(complete.flatMap(j => j.customerId == null ? [] : [j.customerId]));
  const previousCustomers = new Set(report.previousCustomers);
  const retained = [...previousCustomers].filter(id => currentCustomers.has(id));
  const scheduled = report.jobs.filter(j => inRange(j.scheduledDate) && j.status !== 'cancelled');
  const finishedScheduled = scheduled.filter(j => j.status === 'completed' && j.completedDate != null && j.completedDate <= report.to);
  const spend = new Map<number, { name: string; total: number; count: number }>();
  const byYear = new Map<string, { total: number; customers: Set<number> }>();
  for (let year=Number(report.from.slice(0,4));year<=Number(report.to.slice(0,4));year++)
    byYear.set(String(year),{total:0,customers:new Set<number>()});
  for (const invoice of paid) {
    const customer = spend.get(invoice.customerId) ?? { name: invoice.customerName, total: 0, count: 0 };
    customer.total += invoice.total; customer.count++; spend.set(invoice.customerId, customer);
    const year = invoice.paidDate!.slice(0, 4);
    const annual = byYear.get(year) ?? { total: 0, customers: new Set<number>() };
    annual.total += invoice.total; annual.customers.add(invoice.customerId); byYear.set(year, annual);
  }
  const spendTotal = sum(paid, i => i.total);
  const crewEfficiency = new Map<string, { budget: number; actual: number; jobs: number }>();
  const employeeEfficiency = new Map<number, { name: string; budget: number; actual: number }>();
  for (const j of budgeted) {
    const key = `${j.crewId ?? 'none'}:${j.crewName}`;
    const crew = crewEfficiency.get(key) ?? { budget: 0, actual: 0, jobs: 0 };
    crew.budget += j.budgetMinutes; crew.actual += j.minutes; crew.jobs++; crewEfficiency.set(key, crew);
    for (const w of j.workers ?? []) {
      const worker = employeeEfficiency.get(w.id) ?? { name: w.name, budget: 0, actual: 0 };
      worker.actual += w.minutes; worker.budget += j.budgetMinutes * w.minutes / j.minutes;
      employeeEfficiency.set(w.id, worker);
    }
  }
  const held = report.unbilled.filter(j => j.reason.startsWith('Billing hold'));
  const waiting = report.unbilled.filter(j => !j.needsAttention);
  const attention = report.unbilled.filter(j => j.needsAttention && !j.reason.startsWith('Billing hold'));
  const invoiceCash = sum(paid, i => i.cash);
  const activities = sum(report.clock.other, a => a.minutes);
  const definitions: Record<KpiId, Omit<KpiMetric, 'id' | 'name'>> = {
    revenue_hour: {
      value: hourlyHours ? sum(hourlyJobs, j => j.total - j.materialSell) / hourlyHours : null, format: 'money',
      summary: `${hourlyJobs.length} comparable jobs · ${hourlyHours.toFixed(2)} person-hours${target != null ? ` · weighted budget target ${dollars(target)}/hour (same jobs)` : ' · no budget target available'}`,
      formula: 'Recorded service/labor revenue (job price minus material selling prices) ÷ closed person-hours. Budget targets follow each completion year and service division.',
      warning: `${complete.length - hourlyJobs.length} jobs excluded from the aggregate for missing prices, incomplete time, invalid materials or unavailable budget targets when comparing against budget. Material amounts must be recorded to separate them from labor revenue.`,
      rows: priced.map(({ j, rate }) => jobRow(j, `${dollars((j.total - j.materialSell) / (j.minutes / 60))}/hour`, rate ? `${rate.label}: ${dollars(rate.hourly)}/hour; minimum ${dollars(rate.floor)}` : 'Budget not configured for completion year')),
    },
    efficiency: {
      value: pct(sum(budgeted, j => j.budgetMinutes), sum(budgeted, j => j.minutes)), format: 'percent',
      summary: `${budgeted.length} comparable completed jobs · 100% means on budget`,
      formula: 'Budgeted person-minutes ÷ actual person-minutes on the same completed, budgeted jobs × 100. Employee budget shares are allocated in proportion to recorded contribution.',
      warning: `${complete.length - budgeted.length} jobs lack a usable time budget or closed time. Owner job time is included like other contributors. This is not clock utilization.`,
      rows: [
        ...[...crewEfficiency.entries()].map(([key, c]) => ({ label: `Crew: ${key.slice(key.indexOf(':') + 1)}`, value: `${(c.budget / c.actual * 100).toFixed(1)}%`, note: `${c.jobs} jobs; ${(c.budget / 60).toFixed(2)} budget / ${(c.actual / 60).toFixed(2)} actual person-hours` })),
        ...[...employeeEfficiency.values()].map(w => ({ label: `Employee: ${w.name}`, value: w.actual ? `${(w.budget / w.actual * 100).toFixed(1)}%` : 'Not enough data', note: 'Same completed-job cohort; proportional budget attribution' })),
        ...budgeted.map(j => jobRow(j, `${(j.budgetMinutes / j.minutes * 100).toFixed(1)}%`, `${j.crewName}: ${j.budgetMinutes} budget / ${j.minutes.toFixed(1)} actual person-minutes`)),
      ],
    },
    margin: {
      value: pct(marginDollars, marginRevenue), format: 'percent',
      summary: `${dollars(marginDollars)} estimated direct margin on ${marginJobs.length} comparable jobs`,
      formula: '(Job revenue − historical hourly labor estimate − snapshotted material purchase cost − linked fuel cost) ÷ job revenue × 100.',
      warning: `Estimated, not accounting profit: excludes unallocated payroll burden, P4P adjustments, equipment wear and subcontractor costs. ${complete.length - marginJobs.length} jobs excluded for missing costs, rates or closed time; no missing cost is treated as zero.`,
      rows: marginJobs.map(j => jobRow(j, dollars(j.total - j.materialCost! - j.laborCost! - j.fuelCost), `Estimated: labor ${dollars(j.laborCost!)}, materials ${dollars(j.materialCost!)}, linked fuel ${dollars(j.fuelCost)}`)),
    },
    underpriced: {
      value: pct(under.length, comparable.length), format: 'percent',
      summary: `${under.length} of ${comparable.length} comparable jobs; ${complete.length - comparable.length} excluded`,
      formula: 'Comparable completed jobs below their service division recommendation ÷ comparable jobs × 100. Recommendation = max(person-hours × budget hourly target, minimum visit charge) + material selling prices.',
      warning: 'Advisory only. No historical price or matrix is changed. Open Pricing Review for whole-matrix recommendations.',
      rows: [{ label: 'Review pricing and service matrices', value: `${under.length} underpriced jobs`, href: '/pricing-review' },
        ...under.map(p => jobRow(p.j, `Shortfall ${dollars(p.recommended! - p.j.total)}`, `Charged ${dollars(p.j.total)}; recommended ${dollars(p.recommended!)}; ${p.rate!.label}`))],
    },
    unbilled: {
      value: sum(attention, j => j.totalAmount), format: 'money',
      summary: `${attention.length} need review · ${held.length} on hold · ${waiting.length} waiting for billing cycles`,
      formula: 'Value of uncovered completed jobs flagged for admin attention. Intentional holds and work waiting for a valid billing cycle are identified separately.',
      warning: `Current backlog as of ${report.asOf.slice(0,10)}, not limited to the selected completion period. Free work and missing-price jobs can require review even when the dollar total is zero.`,
      rows: report.unbilled.map(j => ({ label: `${j.title} · ${j.customerName ?? 'No customer'}`, value: dollars(j.totalAmount), note: j.reason, href: `/schedule?jobId=${j.id}` })),
    },
    overdue: {
      value: sum(overdue, i => i.balance), format: 'money',
      summary: `${overdue.length} overdue invoices · current outstanding balance`,
      formula: 'Unpaid sent/overdue invoice totals less already applied deposits and prepaid credit, where the due date has passed.',
      warning: `Current snapshot as of ${report.asOf.slice(0,10)}, independent of the selected period. Paid, draft, void and archived invoices are excluded.`,
      rows: overdue.map(i => {
        const days = Math.max(0, Math.floor((Date.parse(report.asOf.slice(0,10)) - Date.parse(i.dueDate!)) / 86400000));
        return { label: `${i.number} · ${i.customerName}`, value: dollars(i.balance), note: `${days} days overdue · ${days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+'} day group`, href: `/invoices?invoiceId=${i.id}` };
      }),
    },
    cash: {
      value: invoiceCash + report.receipts.deposits + report.receipts.prepayments, format: 'money',
      summary: 'Recorded gross receipts; credit applications are not new cash',
      formula: 'New money received on paid invoices + estimate deposits received + prepaid purchases received during the selected period.',
      warning: 'Not earned revenue or net bank cash flow. Applied deposits/credits are subtracted from invoice receipts to avoid double counting. Refunds and chargebacks require reconciliation.',
      rows: [
        { label: 'New invoice payments', value: dollars(invoiceCash) },
        { label: 'Deposits received', value: dollars(report.receipts.deposits) },
        { label: 'Prepaid purchases received', value: dollars(report.receipts.prepayments) },
        ...paid.map(i => ({ label: `${i.number} · ${i.customerName}`, value: dollars(i.cash), note: `Paid ${i.paidDate}; excludes previously received credit/deposits`, href: `/invoices?invoiceId=${i.id}` })),
      ],
    },
    acceptance: {
      value: pct(accepted.length, report.estimates.length), format: 'percent',
      summary: `${accepted.length} accepted / ${report.estimates.length} sent${acceptanceValue != null ? ` · ${acceptanceValue.toFixed(1)}% by value` : ''}`,
      formula: 'Currently accepted estimates ÷ estimates first sent during the selected period × 100. Dollar acceptance uses accepted total ÷ sent total from the same cohort.',
      warning: 'Pending, declined and expired estimates remain in the denominator. Drafts are excluded. Recent estimates have had less time to receive a response.',
      rows: report.estimates.map(e => ({ label: `Estimate #${e.id} · ${e.customerName}`, value: `${e.status} · ${dollars(e.total)}`, note: e.reason ? `Declined: ${e.reason}` : undefined, href: `/estimates?estimateId=${e.id}` })),
    },
    callbacks: {
      value: pct(report.callbacks.length, complete.length), format: 'percent',
      summary: `${report.callbacks.length} callback tickets / ${complete.length} completed jobs`,
      formula: 'Every callback ticket created in the selected period ÷ every job completed in that same period × 100. Multiple tickets against the same job count separately.',
      rows: report.callbacks.map(c => ({ label: `${c.title} · ${c.crewName}`, value: `Ticket #${c.id}`, note: c.reason, href: `/schedule?jobId=${c.jobId}` })),
    },
    retention: {
      value: pct(retained.length, previousCustomers.size), format: 'percent',
      summary: `${retained.length} returning / ${previousCustomers.size} customers served in the preceding equal-length period`,
      formula: 'Customers with completed service in both this period and the preceding equal-length calendar period ÷ customers served in that prior period × 100.',
      warning: 'Repeat-service retention, not a contract renewal or cancellation rate. Seasonal and one-off work affect this measure; it does not infer why a customer left.',
      rows: [...previousCustomers].map(id => ({ label: complete.find(j => j.customerId === id)?.customerName ?? `Customer #${id}`, value: currentCustomers.has(id) ? 'Returned' : 'No completed service in selected period', href: `/customers/${id}` })),
    },
    schedule: {
      value: pct(finishedScheduled.length, scheduled.length), format: 'percent',
      summary: `${finishedScheduled.length} completed / ${scheduled.length} scheduled · ${report.jobs.filter(j => inRange(j.scheduledDate) && j.status === 'cancelled').length} cancelled`,
      formula: 'Non-cancelled jobs scheduled in the selected period and completed by its end ÷ non-cancelled jobs scheduled in the selected period × 100.',
      warning: 'Uses current scheduled dates, not a historical snapshot before rescheduling. Jobs completed later than the selected end date do not count as completed for this measure.',
      rows: scheduled.map(j => jobRow(j, finishedScheduled.some(f => f.id === j.id) ? 'Completed' : 'Not completed by period end', `Scheduled ${j.scheduledDate}; ${j.status}`)),
    },
    productive: {
      value: pct(report.clock.jobMinutes, report.clock.paidMinutes), format: 'percent',
      summary: `${(report.clock.jobMinutes/60).toFixed(2)} job / ${(report.clock.paidMinutes/60).toFixed(2)} master-clock hours`,
      formula: 'Job timer minutes within the selected date boundaries ÷ master-clock minutes within those same boundaries × 100. Adjusted times take precedence; open clocks run through the report time.',
      warning: `${report.clock.openEntries} master clocks still open. Travel, loading and maintenance are legitimate non-job work. Overlapping timers or missing master clocks can produce results over 100% and require review.`,
      rows: [
        { label: 'Job work', value: `${(report.clock.jobMinutes/60).toFixed(2)} hours` },
        ...report.clock.other.map(a => ({ label: a.type, value: `${(a.minutes/60).toFixed(2)} hours` })),
        { label: 'Master time not categorized', value: `${(Math.max(0,report.clock.paidMinutes-report.clock.jobMinutes-activities)/60).toFixed(2)} hours`, href: '/time-tracking' },
      ],
    },
    customer_spend: {
      value: spend.size ? spendTotal / spend.size : null, format: 'money',
      summary: `${dollars(spendTotal)} paid invoice value / ${spend.size} paying customers in selected range`,
      formula: 'Gross paid invoice value (including tax) ÷ distinct customers with paid invoices in the selected period. Applied prepaid funds/deposits count toward the invoice value once, not as additional purchases.',
      warning: 'This is the selected-range average, not automatically annualized. Annual rows use each year’s paying-customer count. Partial-year ranges show only the selected portion of that year; unpaid invoices and unused deposits/prepayments are excluded.',
      rows: [
        ...[...byYear.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([year,a])=>({ label: `${year} average customer spend`, value: a.customers.size ? dollars(a.total/a.customers.size) : 'Not enough data', note: `${dollars(a.total)} / ${a.customers.size} paying customers (selected dates only)` })),
        ...[...spend.entries()].sort(([,a],[,b])=>b.total-a.total).map(([id,c])=>({ label: c.name, value: dollars(c.total), note: `${c.count} paid invoice${c.count===1?'':'s'}`, href: `/customers/${id}` })),
      ],
    },
  };
  return KPI_CATALOG.map(k => ({ id:k.id, name:k.name, ...definitions[k.id],
    value: definitions[k.id].value == null || !Number.isFinite(definitions[k.id].value!) ? null : round(definitions[k.id].value!) }));
}
