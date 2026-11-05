import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccountFreeDemo, grantAccountFreeDemo, hasAccountFreeDemo } from './demoAccess';
import {
  DEMO_MODE_KEY,
  buildDemoSandbox,
  crewEfficiency,
  customerById,
  financialSummary,
  invoiceAmount,
  loadDemoSandbox,
  propertyById,
} from './demoSandbox';

describe('demo CRM sandbox', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });

  afterEach(() => {
    clearAccountFreeDemo();
    vi.unstubAllGlobals();
  });

  it('turns on is_demo_mode and stores a linked dataset', () => {
    grantAccountFreeDemo();
    expect(localStorage.getItem(DEMO_MODE_KEY)).toBe('true');
    expect(hasAccountFreeDemo()).toBe(true);
    const sandbox = loadDemoSandbox();
    expect(sandbox).not.toBeNull();
    expect(sandbox!.customers).toHaveLength(5);
    expect(new Set(sandbox!.customers.map(customer => customer.kind))).toEqual(new Set(['residential', 'hoa', 'commercial']));
    for (const customer of sandbox!.customers) {
      expect(customer.primaryContact.name).toBeTruthy();
      expect(customer.propertyIds.length).toBeGreaterThan(0);
      for (const propertyId of customer.propertyIds) {
        const property = propertyById(sandbox!, propertyId);
        expect(property?.customerId).toBe(customer.id);
        expect(property?.gateCode).toBeTruthy();
        expect(property?.sqft).toBeGreaterThan(0);
        expect(property?.lawnCondition).toBeTruthy();
      }
    }
  });

  it('covers dispatch statuses, both crews, and a 115% mowing crew', () => {
    const sandbox = buildDemoSandbox(new Date('2026-11-05T15:00:00.000Z'));
    expect(new Set(sandbox.jobs.filter(job => job.scheduledAt.startsWith('2026-11-05')).map(job => job.status))).toEqual(
      new Set(['completed', 'in_progress', 'en_route', 'scheduled']),
    );
    expect(sandbox.crews.map(crew => crew.focus)).toEqual(['Mowing', 'Fertilization/Chemical']);
    expect(crewEfficiency(sandbox.jobs, 'crew-a')).toBe(115);
    for (const job of sandbox.jobs) {
      expect(customerById(sandbox, job.customerId)).not.toBeNull();
      expect(propertyById(sandbox, job.propertyId)?.customerId).toBe(job.customerId);
      if (job.status === 'completed') {
        expect(job.clockIn).toBeTruthy();
        expect(job.clockOut).toBeTruthy();
      }
    }
    expect(sandbox.jobs.some(job => job.breaks.length > 0)).toBe(true);
  });

  it('links invoices, estimates, chemical logs, and month profit', () => {
    const sandbox = buildDemoSandbox(new Date('2026-11-05T15:00:00.000Z'));
    expect(new Set(sandbox.invoices.map(invoice => invoice.status))).toEqual(new Set(['paid', 'pending', 'past_due']));
    for (const invoice of sandbox.invoices) {
      expect(customerById(sandbox, invoice.customerId)).not.toBeNull();
      expect(invoice.lines.length).toBeGreaterThan(0);
      expect(invoiceAmount(invoice)).toBeGreaterThan(0);
    }
    expect(sandbox.estimates.every(estimate => estimate.status === 'pending_approval')).toBe(true);
    for (const log of sandbox.chemicalLogs) {
      expect(sandbox.jobs.some(job => job.id === log.jobId)).toBe(true);
      expect(log.epaNumber).toMatch(/\d/);
      expect(log.targetPest).toBeTruthy();
      expect(log.windMph).toBeGreaterThan(0);
      expect(log.tempF).toBeGreaterThan(0);
      expect(log.rate).toContain('sq ft');
      expect(log.signature).toBe(log.technician);
    }
    const summary = financialSummary(sandbox);
    expect(summary.paid).toBeGreaterThan(0);
    expect(summary.past_due).toBeGreaterThan(0);
    expect(summary.pending).toBeGreaterThan(0);
    expect(summary.revenue).toBe(summary.paid);
    expect(summary.profit).toBeLessThan(summary.revenue);
  });
});
