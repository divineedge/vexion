/**
 * Manual hooks for endpoints not covered by Orval codegen.
 * Follow the same pattern as generated hooks — use customFetch so base URL
 * and auth headers are applied consistently.
 */
import { useMutation, useQuery, type UseMutationOptions, type UseMutationResult, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { customFetch, type ErrorType, type BodyType } from "./custom-fetch";
import type { MeasurementZone, Quote, QuoteWithProperty, PropertyMeasurementUpdate, GeocodeResult } from "./generated/api.schemas";

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

// ---------------------------------------------------------------------------
// Property measurements
// ---------------------------------------------------------------------------

export interface MeasurementUpdateBody {
  measurementPolygons?: import("./generated/api.schemas").MeasurementZone[];
  serviceableAreaSqft?: number;
}

export const updatePropertyMeasurements = async (
  id: number,
  data: MeasurementUpdateBody,
  options?: RequestInit,
): Promise<import("./generated/api.schemas").Property> => {
  return customFetch<import("./generated/api.schemas").Property>(`/api/properties/${id}/measurements`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

export const useUpdatePropertyMeasurements = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    import("./generated/api.schemas").Property,
    TError,
    { id: number; data: MeasurementUpdateBody },
    TContext
  >;
}): UseMutationResult<
  import("./generated/api.schemas").Property,
  TError,
  { id: number; data: MeasurementUpdateBody },
  TContext
> => {
  const mutationKey = ["updatePropertyMeasurements"];
  const { mutation: mutationOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey } };

  return useMutation({
    mutationFn: ({ id, data }) => updatePropertyMeasurements(id, data),
    ...mutationOptions,
  });
};

// ---------------------------------------------------------------------------
// Property geocode
// ---------------------------------------------------------------------------

export const geocodeProperty = async (
  id: number,
  options?: RequestInit,
): Promise<GeocodeResult> => {
  return customFetch<GeocodeResult>(`/api/properties/${id}/geocode`, options);
};

// ---------------------------------------------------------------------------
// Property quotes
// ---------------------------------------------------------------------------

export interface CreateQuoteBody {
  serviceId?: number;
  serviceName: string;
  selectedZoneLabels?: string[];
  totalAreaSqft?: number | null;
  calculatedPrice?: number;
  priceType?: "flat" | "per_sqft";
}

export const createPropertyQuote = async (
  propertyId: number,
  data: CreateQuoteBody,
  options?: RequestInit,
): Promise<Quote> => {
  return customFetch<Quote>(`/api/properties/${propertyId}/quotes`, {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const useCreatePropertyQuote = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Quote,
    TError,
    { propertyId: number; data: CreateQuoteBody },
    TContext
  >;
}): UseMutationResult<
  Quote,
  TError,
  { propertyId: number; data: CreateQuoteBody },
  TContext
> => {
  const mutationKey = ["createPropertyQuote"];
  const { mutation: mutationOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey } };

  return useMutation({
    mutationFn: ({ propertyId, data }) => createPropertyQuote(propertyId, data),
    ...mutationOptions,
  });
};

export const listPropertyQuotes = async (
  propertyId: number,
  options?: RequestInit,
): Promise<Quote[]> => {
  return customFetch<Quote[]>(`/api/properties/${propertyId}/quotes`, options);
};

export const getListPropertyQuotesQueryKey = (propertyId: number) =>
  ["listPropertyQuotes", propertyId] as const;

export const useListPropertyQuotes = <
  TError = ErrorType<unknown>,
>(
  propertyId: number,
  options?: { query?: UseQueryOptions<Quote[], TError> },
): UseQueryResult<Quote[], TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery({
    queryKey: queryOptions?.queryKey ?? getListPropertyQuotesQueryKey(propertyId),
    queryFn: () => listPropertyQuotes(propertyId),
    enabled: !!propertyId,
    ...queryOptions,
  });
};
