export interface CustomerContact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  physicalAddress: string | null;
  physicalCity: string | null;
  physicalState: string | null;
  physicalZip: string | null;
  archivedAt: Date | string | null;
}

export interface ExistingCustomerSummary {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  archived: boolean;
}

export function formatPostalAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = (parts.address ?? "").trim();
  const cityLine = [parts.city, parts.state].map((value) => (value ?? "").trim()).filter(Boolean).join(", ");
  const zip = (parts.zip ?? "").trim();
  const locality = [cityLine, zip].filter(Boolean).join(" ");
  const formatted = [street, locality].filter(Boolean).join(", ");
  return formatted || null;
}

export function existingCustomerSummary(customer: CustomerContact): ExistingCustomerSummary {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: formatPostalAddress({
      address: customer.physicalAddress,
      city: customer.physicalCity,
      state: customer.physicalState,
      zip: customer.physicalZip,
    }),
    archived: customer.archivedAt != null,
  };
}

export function duplicateCustomerConflict(customer: CustomerContact) {
  const existingCustomer = existingCustomerSummary(customer);
  return {
    error: "Duplicate customer detected",
    existingCustomerId: existingCustomer.id,
    archived: existingCustomer.archived,
    existingCustomer,
  };
}

/** A separate record is created only when the client explicitly opts in. */
export function explicitDuplicateOverride(body: { allowPossibleDuplicate?: unknown; forceCreate?: unknown }): boolean {
  return body.allowPossibleDuplicate === true || body.forceCreate === true;
}
