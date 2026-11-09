import { db, jobsTable, servicesTable, subTimersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { billableHours, hourlyLineDescription, hourlyTotal, minutesFromTimers } from "./hourlyBillingMath";

export { billableHours, hourlyLineDescription, hourlyTotal, minutesFromTimers };

type HourlyLine = {
  serviceId: number;
  description: string;
  quantity: number;
  qty: number;
  unitPrice: number;
  total: number;
  billingType: "hourly";
  hourlyRate: number;
  billableHours: number;
  priceOverridden?: boolean;
  hoursOverridden?: boolean;
};

function overriddenLine(items: unknown, serviceId: number): HourlyLine | null {
  if (!Array.isArray(items)) return null;
  const line = items.find(item => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (row.priceOverridden === true || row.hoursOverridden === true) && (row.serviceId === serviceId || row.billingType === "hourly");
  }) as HourlyLine | undefined;
  return line ?? null;
}

export async function hourlyChargeForJob(tenantId: number, jobId: number, asOf: Date): Promise<{
  lineItems: HourlyLine[];
  totalAmount: number;
  billableMinutes: number;
} | null> {
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!job?.serviceId) return null;
  const [service] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, job.serviceId), eq(servicesTable.tenantId, tenantId)));
  if (!service || service.pricingMode !== "hourly") return null;
  const kept = overriddenLine(job.lineItems, service.id);
  if (kept) {
    const total = Number(kept.total) || hourlyTotal(Number(kept.quantity) || 0, Number(kept.unitPrice) || 0);
    return { lineItems: [{ ...kept, total }], totalAmount: total, billableMinutes: job.billableMinutes ?? Math.round((Number(kept.billableHours) || 0) * 60) };
  }
  const timers = await db.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId, tenantId), eq(subTimersTable.jobId, jobId)));
  let worked = minutesFromTimers(timers, asOf);
  if (worked <= 0 && job.clockInAt) {
    const end = job.completedAt ?? asOf;
    worked = Math.max(0, (end.getTime() - new Date(job.clockInAt).getTime()) / 60000);
  }
  const rate = service.hourlyRate ?? service.basePrice ?? 0;
  const hours = billableHours(worked, service.minimumBillableMinutes);
  const total = hourlyTotal(hours, rate);
  const line: HourlyLine = {
    serviceId: service.id,
    description: hourlyLineDescription(service.name, hours, rate),
    quantity: hours,
    qty: hours,
    unitPrice: rate,
    total,
    billingType: "hourly",
    hourlyRate: rate,
    billableHours: hours,
    priceOverridden: false,
    hoursOverridden: false,
  };
  return { lineItems: [line], totalAmount: total, billableMinutes: Math.round(worked) };
}

export async function saveHourlyJobCharge(tenantId: number, jobId: number, asOf: Date) {
  const charge = await hourlyChargeForJob(tenantId, jobId, asOf);
  if (!charge) return null;
  await db.update(jobsTable).set({
    lineItems: charge.lineItems,
    totalAmount: charge.totalAmount,
    billableMinutes: charge.billableMinutes,
  }).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  return charge;
}
