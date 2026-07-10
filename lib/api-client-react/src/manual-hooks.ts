/**
 * Manual hooks for endpoints not covered by Orval codegen.
 * Follow the same pattern as generated hooks — use customFetch so base URL
 * and auth headers are applied consistently.
 */
import { useMutation, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { customFetch, type ErrorType, type BodyType } from "./custom-fetch";

// ---------------------------------------------------------------------------
// Property transfer
// ---------------------------------------------------------------------------

export interface PropertyTransferBody {
  newCustomerId: number;
  notes?: string;
}

export interface PropertyTransferResult {
  id: number;
  tenantId: number;
  customerId: number;
  customerName: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadius: number | null;
  type: string | null;
  notes: string | null;
  createdAt: string;
}

export const transferProperty = async (
  id: number,
  data: PropertyTransferBody,
  options?: RequestInit,
): Promise<PropertyTransferResult> => {
  return customFetch<PropertyTransferResult>(`/api/properties/${id}/transfer`, {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const useTransferProperty = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof transferProperty>>,
    TError,
    { id: number; data: BodyType<PropertyTransferBody> },
    TContext
  >;
}): UseMutationResult<
  Awaited<ReturnType<typeof transferProperty>>,
  TError,
  { id: number; data: BodyType<PropertyTransferBody> },
  TContext
> => {
  const mutationKey = ["transferProperty"];
  const { mutation: mutationOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey } };

  return useMutation({
    mutationFn: ({ id, data }) => transferProperty(id, data),
    ...mutationOptions,
  });
};

// ---------------------------------------------------------------------------
// Customer property-history (convenience query helper)
// ---------------------------------------------------------------------------

export interface CustomerPropertyHistoryItem {
  id: number;
  propertyId: number;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  newCustomerId: number | null;
  newCustomerName: string | null;
  notes: string | null;
  transferredAt: string;
}

export const getCustomerPropertyHistory = async (
  customerId: number,
  options?: RequestInit,
): Promise<CustomerPropertyHistoryItem[]> => {
  return customFetch<CustomerPropertyHistoryItem[]>(
    `/api/customers/${customerId}/property-history`,
    options,
  );
};
