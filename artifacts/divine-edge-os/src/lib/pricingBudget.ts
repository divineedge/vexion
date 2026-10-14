import { computeCompanyTotal, computeDivision, type BudgetYear } from './budgetCalc';

export function pricingBudgetRate(year: BudgetYear | undefined, serviceId: number | null, target = 'auto') {
  if (!year) return null;
  const matches = target === 'auto'
    ? year.divisions.filter(d => serviceId != null && d.serviceIds.includes(serviceId))
    : year.divisions.filter(d => d.id === target);
  // Do not choose arbitrarily if legacy/imported data links a service twice.
  if (target === 'auto' && matches.length > 1) return null;
  if (matches.length === 1 && target !== 'company') {
    const d = matches[0];
    const result = computeDivision(d);
    return { hourly: result.requiredHourlyRate, floor: result.minimumShowUpCost, label: `${year.year} ${d.name} division` };
  }
  if (target !== 'company' && target !== 'auto') return null;
  const result = computeCompanyTotal(year);
  return {
    hourly: result.combinedRequiredHourlyRate, floor: result.combinedMinimumShowUpCost,
    label: `${year.year} company total${target === 'auto' ? ' (service unassigned)' : ''}`,
  };
}

export function recommendedJobPrice(hours: number, materialSellAmount: number, rate: { hourly: number; floor: number }) {
  return Math.round((Math.max(hours * rate.hourly, rate.floor) + materialSellAmount) * 100) / 100;
}
