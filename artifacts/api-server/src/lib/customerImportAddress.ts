export interface ImportedAddressFields {
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  physicalAddress: string | null;
  physicalCity: string | null;
  physicalState: string | null;
  physicalZip: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function present(value: unknown): string | undefined {
  const trimmed = text(value);
  return trimmed ? trimmed : undefined;
}

/** Billing/mailing stays the mailing address. A blank service address defaults to that mailing address. */
export function importedCustomerAddresses(raw: Record<string, unknown>): ImportedAddressFields {
  const billingAddress = present(raw.billingAddress) ?? present(raw.mailingAddress) ?? null;
  const billingCity = present(raw.billingCity) ?? present(raw.mailingCity) ?? null;
  const billingState = present(raw.billingState) ?? present(raw.mailingState) ?? null;
  const billingZip = present(raw.billingZip) ?? present(raw.mailingZip) ?? null;
  const explicitService = present(raw.physicalAddress);
  return {
    billingAddress,
    billingCity,
    billingState,
    billingZip,
    physicalAddress: explicitService ?? billingAddress,
    physicalCity: present(raw.physicalCity) ?? (explicitService ? null : billingCity),
    physicalState: present(raw.physicalState) ?? (explicitService ? null : billingState),
    physicalZip: present(raw.physicalZip) ?? (explicitService ? null : billingZip),
  };
}

/** Property row created from an imported customer. Mailing is used unless a distinct service address was supplied. */
export function importedServiceProperty(values: Record<string, unknown>): { address: string; city: string | null; state: string | null; zip: string | null } | null {
  const billingAddress = present(values.billingAddress) ?? present(values.mailingAddress);
  if (!billingAddress) return null;
  const serviceAddress = present(values.physicalAddress);
  const useService = !!serviceAddress && serviceAddress !== billingAddress;
  return {
    address: useService ? serviceAddress : billingAddress,
    city: present(useService ? values.physicalCity : values.billingCity) ?? null,
    state: present(useService ? values.physicalState : values.billingState) ?? null,
    zip: present(useService ? values.physicalZip : values.billingZip) ?? null,
  };
}
