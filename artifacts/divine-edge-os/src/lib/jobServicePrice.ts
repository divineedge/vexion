import { propertyServiceMeasurements, servicePriceForProperty, type MeasuredProperty, type MeasuredService } from "./pricingMatrix";

export type InvoiceFrequency = "each_time" | "weekly" | "monthly";

export const INVOICE_FREQUENCY_LABELS: Record<InvoiceFrequency, string> = {
  each_time: "Each time",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function normalizeInvoiceFrequency(value: unknown): InvoiceFrequency {
  return value === "weekly" || value === "monthly" ? value : "each_time";
}

export function invoiceFrequencyLabel(value: unknown): string {
  return INVOICE_FREQUENCY_LABELS[normalizeInvoiceFrequency(value)];
}

export interface ServiceRateSource extends MeasuredService {
  weeklyRate?: number | null;
  monthlyRate?: number | null;
  hourlyRate?: number | null;
}

export function roundJobMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Each-time price from the service matrix, flat rate, or other measurement pricing. */
export function eachTimeServicePrice(service: ServiceRateSource, property?: MeasuredProperty | null): number {
  const mode = service.pricingMode ?? "flat";
  if (mode === "hourly") return 0;
  const measured = propertyServiceMeasurements(property, service);
  const needsMeasurement = mode === "matrix" || mode === "per_sqft" || mode === "per_linear_ft" || mode === "area_and_linear";
  if (needsMeasurement && measured.areaSqft <= 0 && measured.lengthFt <= 0) {
    return roundJobMoney(Number(service.basePrice ?? 0));
  }
  return roundJobMoney(servicePriceForProperty(service, property ?? null));
}

/** The catalog amount for the invoice frequency chosen on a job. */
export function serviceRateForFrequency(
  service: ServiceRateSource,
  frequency: InvoiceFrequency,
  property?: MeasuredProperty | null,
): number {
  if (frequency === "weekly") return roundJobMoney(Number(service.weeklyRate ?? 0));
  if (frequency === "monthly") return roundJobMoney(Number(service.monthlyRate ?? 0));
  return eachTimeServicePrice(service, property);
}

export interface JobPriceDraft {
  price: string;
  priceEdited: boolean;
}

/**
 * Fill a job price from the selected service. A price the office already typed
 * stays put when the invoice frequency changes. Choosing a different service
 * starts over from that service's rate.
 */
export function applyServiceToJobPrice(
  draft: JobPriceDraft,
  service: ServiceRateSource | null | undefined,
  frequency: InvoiceFrequency,
  property?: MeasuredProperty | null,
  options?: { serviceChanged?: boolean },
): JobPriceDraft {
  const edited = options?.serviceChanged ? false : draft.priceEdited;
  if (edited) return { price: draft.price, priceEdited: true };
  if (!service) return { price: draft.price, priceEdited: false };
  return {
    price: serviceRateForFrequency(service, frequency, property).toFixed(2),
    priceEdited: false,
  };
}

export function editJobPrice(value: string): JobPriceDraft {
  return { price: value, priceEdited: true };
}

export function jobPricePayload(price: string): { totalAmount: number } {
  const amount = Number(price);
  if (price.trim() === "" || !Number.isFinite(amount)) return { totalAmount: 0 };
  return { totalAmount: roundJobMoney(amount) };
}

export function jobCreatePricing(form: { price: string; invoiceFrequency: InvoiceFrequency }): { totalAmount?: number; invoiceFrequency: InvoiceFrequency } {
  return { invoiceFrequency: normalizeInvoiceFrequency(form.invoiceFrequency), ...jobPricePayload(form.price) };
}
