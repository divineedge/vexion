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

// ---------------------------------------------------------------------------
// Bulk data import / export
// ---------------------------------------------------------------------------

export type ImportExportEntity =
  | "customers"
  | "properties"
  | "jobs"
  | "estimates"
  | "invoices"
  | "equipment"
  | "inventory";

export interface ImportFieldMeta {
  key: string;
  header: string;
  required?: boolean;
  hint?: string;
}

export interface ImportPreviewResult {
  headers: string[];
  fields: ImportFieldMeta[];
  suggestedMapping: Record<string, string | null>;
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export interface ImportRowError {
  row: number;
  errors: string[];
}

export interface ImportCommitResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
}

/**
 * Triggers a browser download of an entity export. Query params should
 * mirror the filters already applied to that entity's list view.
 */
export const exportEntity = async (
  entity: ImportExportEntity,
  format: "csv" | "xlsx",
  query: Record<string, string | undefined> = {},
): Promise<void> => {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") params.set(key, value);
  }
  const blob = await customFetch<Blob>(`/api/${entity}/export?${params.toString()}`, {
    method: "GET",
    responseType: "blob",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entity}-export.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const previewEntityImport = async (
  entity: ImportExportEntity,
  file: File,
): Promise<ImportPreviewResult> => {
  const form = new FormData();
  form.append("file", file);
  return customFetch<ImportPreviewResult>(`/api/${entity}/import/preview`, {
    method: "POST",
    body: form,
  });
};

export const commitEntityImport = async (
  entity: ImportExportEntity,
  file: File,
  mapping: Record<string, string | null>,
): Promise<ImportCommitResult> => {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  return customFetch<ImportCommitResult>(`/api/${entity}/import/commit`, {
    method: "POST",
    body: form,
  });
};

export const usePreviewEntityImport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof previewEntityImport>>,
    TError,
    { entity: ImportExportEntity; file: File },
    TContext
  >;
}): UseMutationResult<
  Awaited<ReturnType<typeof previewEntityImport>>,
  TError,
  { entity: ImportExportEntity; file: File },
  TContext
> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: ({ entity, file }) => previewEntityImport(entity, file),
    ...mutationOptions,
  });
};

export const useCommitEntityImport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof commitEntityImport>>,
    TError,
    { entity: ImportExportEntity; file: File; mapping: Record<string, string | null> },
    TContext
  >;
}): UseMutationResult<
  Awaited<ReturnType<typeof commitEntityImport>>,
  TError,
  { entity: ImportExportEntity; file: File; mapping: Record<string, string | null> },
  TContext
> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: ({ entity, file, mapping }) => commitEntityImport(entity, file, mapping),
    ...mutationOptions,
  });
};
