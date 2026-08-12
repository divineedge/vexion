/**
 * Manual hooks for endpoints not covered by Orval codegen.
 * Follow the same pattern as generated hooks — use customFetch so base URL
 * and auth headers are applied consistently.
 */
import { useMutation, useQuery, type UseMutationOptions, type UseMutationResult, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
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
  /** Id of the import batch tracking this commit — pass to rollbackImportBatch to undo it. */
  batchId: number;
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

// ---------------------------------------------------------------------------
// Import batch history / rollback ("undo an accidental bulk import")
// ---------------------------------------------------------------------------

export interface ImportBatchSummary {
  id: number;
  entityKey: ImportExportEntity;
  fileName: string | null;
  status: "committed" | "rolled_back" | "rollback_partial";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  createdByName: string | null;
  createdAt: string;
  rolledBackAt: string | null;
}

export interface RollbackBlockedRow {
  row: number;
  recordId: number;
  /** Human-readable explanation, e.g. "still has 2 jobs booked — delete those first, then undo this import again" */
  reason: string;
}

export interface ImportBatchRollbackResult {
  deletedCount: number;
  revertedCount: number;
  failedCount: number;
  errors: string[];
  /** Rows that could not be deleted because other records now depend on them. */
  blockedRows: RollbackBlockedRow[];
}

export const listImportBatches = async (
  entity?: ImportExportEntity,
  options?: RequestInit,
): Promise<ImportBatchSummary[]> => {
  const params = entity ? `?entity=${entity}` : "";
  return customFetch<ImportBatchSummary[]>(`/api/import-batches${params}`, options);
};

export const rollbackImportBatch = async (
  batchId: number,
  options?: RequestInit,
): Promise<ImportBatchRollbackResult> => {
  return customFetch<ImportBatchRollbackResult>(`/api/import-batches/${batchId}/rollback`, {
    ...options,
    method: "POST",
  });
};

export const useListImportBatches = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<Awaited<ReturnType<typeof listImportBatches>>, TError, ImportExportEntity | undefined, TContext>;
}): UseMutationResult<Awaited<ReturnType<typeof listImportBatches>>, TError, ImportExportEntity | undefined, TContext> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: (entity) => listImportBatches(entity),
    ...mutationOptions,
  });
};

export const useRollbackImportBatch = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<Awaited<ReturnType<typeof rollbackImportBatch>>, TError, number, TContext>;
}): UseMutationResult<Awaited<ReturnType<typeof rollbackImportBatch>>, TError, number, TContext> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: (batchId) => rollbackImportBatch(batchId),
    ...mutationOptions,
  });
};

// ---------------------------------------------------------------------------
// Portal Messages — Customer side
// ---------------------------------------------------------------------------

export interface PortalMessageItem {
  id: number;
  direction: "inbound" | "outbound";
  body: string;
  readAt: string | null;
  createdAt: string;
}

export const portalListMessages = async (options?: RequestInit): Promise<PortalMessageItem[]> => {
  return customFetch<PortalMessageItem[]>("/api/portal/messages", { ...options, method: "GET" });
};

export const getPortalListMessagesQueryKey = () => ["/api/portal/messages"] as const;

export const usePortalListMessages = <TData = PortalMessageItem[], TError = ErrorType<unknown>>(
  options?: { query?: UseQueryOptions<PortalMessageItem[], TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<PortalMessageItem[], TError, TData>({
    queryKey: getPortalListMessagesQueryKey(),
    queryFn: ({ signal }) => portalListMessages({ signal }),
    ...queryOptions,
  });
};

export const portalSendMessage = async (
  data: { body: string },
  options?: RequestInit,
): Promise<PortalMessageItem> => {
  return customFetch<PortalMessageItem>("/api/portal/messages", {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const usePortalSendMessage = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<PortalMessageItem, TError, { data: { body: string } }, TContext>;
}): UseMutationResult<PortalMessageItem, TError, { data: { body: string } }, TContext> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: ({ data }) => portalSendMessage(data),
    ...mutationOptions,
  });
};

// ---------------------------------------------------------------------------
// Portal Inbox — Staff side
// ---------------------------------------------------------------------------

export interface PortalInboxThread {
  customerId: number;
  customerName: string;
  customerEmail: string;
  latestBody: string;
  latestAt: string;
  latestDirection: "inbound" | "outbound";
  unreadCount: number;
}

export interface PortalInboxThreadDetail {
  customer: { id: number; name: string; email: string };
  messages: PortalMessageItem[];
}

export const listPortalInboxThreads = async (options?: RequestInit): Promise<PortalInboxThread[]> => {
  return customFetch<PortalInboxThread[]>("/api/portal-inbox", { ...options, method: "GET" });
};

export const getListPortalInboxThreadsQueryKey = () => ["/api/portal-inbox"] as const;

export const useListPortalInboxThreads = <TData = PortalInboxThread[], TError = ErrorType<unknown>>(
  options?: { query?: UseQueryOptions<PortalInboxThread[], TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<PortalInboxThread[], TError, TData>({
    queryKey: getListPortalInboxThreadsQueryKey(),
    queryFn: ({ signal }) => listPortalInboxThreads({ signal }),
    ...queryOptions,
  });
};

export const getPortalInboxThread = async (
  customerId: number,
  options?: RequestInit,
): Promise<PortalInboxThreadDetail> => {
  return customFetch<PortalInboxThreadDetail>(`/api/portal-inbox/${customerId}`, { ...options, method: "GET" });
};

export const getGetPortalInboxThreadQueryKey = (customerId: number) => ["/api/portal-inbox", customerId] as const;

export const useGetPortalInboxThread = <TData = PortalInboxThreadDetail, TError = ErrorType<unknown>>(
  customerId: number,
  options?: { query?: UseQueryOptions<PortalInboxThreadDetail, TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<PortalInboxThreadDetail, TError, TData>({
    queryKey: getGetPortalInboxThreadQueryKey(customerId),
    queryFn: ({ signal }) => getPortalInboxThread(customerId, { signal }),
    enabled: customerId != null,
    ...queryOptions,
  });
};

export const replyToPortalThread = async (
  customerId: number,
  data: { body: string },
  options?: RequestInit,
): Promise<PortalMessageItem> => {
  return customFetch<PortalMessageItem>(`/api/portal-inbox/${customerId}/reply`, {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const useReplyToPortalThread = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<PortalMessageItem, TError, { customerId: number; data: { body: string } }, TContext>;
}): UseMutationResult<PortalMessageItem, TError, { customerId: number; data: { body: string } }, TContext> => {
  const { mutation: mutationOptions } = options ?? {};
  return useMutation({
    mutationFn: ({ customerId, data }) => replyToPortalThread(customerId, data),
    ...mutationOptions,
  });
};

export const getPortalInboxUnreadCount = async (options?: RequestInit): Promise<{ count: number }> => {
  return customFetch<{ count: number }>("/api/portal-inbox/unread-count", { ...options, method: "GET" });
};

export const getPortalInboxUnreadCountQueryKey = () => ["/api/portal-inbox/unread-count"] as const;

export const useGetPortalInboxUnreadCount = <TData = { count: number }, TError = ErrorType<unknown>>(
  options?: { query?: UseQueryOptions<{ count: number }, TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<{ count: number }, TError, TData>({
    queryKey: getPortalInboxUnreadCountQueryKey(),
    queryFn: ({ signal }) => getPortalInboxUnreadCount({ signal }),
    ...queryOptions,
  });
};

// ---------------------------------------------------------------------------
// Portal active chemical timers — GET /portal/active-timers
// ---------------------------------------------------------------------------

export interface PortalActiveTimer {
  id: number;
  jobId: number | null;
  jobTitle: string | null;
  productName: string | null;
  mixtureName: string | null;
  appliedAt: string;
  rainfastUntil: string | null;
  reentryUntil: string | null;
  propertyAddress: string | null;
}

export const portalGetActiveTimers = async (
  options?: RequestInit,
): Promise<PortalActiveTimer[]> => {
  return customFetch<PortalActiveTimer[]>("/api/portal/active-timers", {
    ...options,
    method: "GET",
  });
};

export const getPortalActiveTimersQueryKey = () => ["/api/portal/active-timers"] as const;

export const usePortalGetActiveTimers = <TData = PortalActiveTimer[], TError = ErrorType<unknown>>(
  options?: { query?: UseQueryOptions<PortalActiveTimer[], TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<PortalActiveTimer[], TError, TData>({
    queryKey: getPortalActiveTimersQueryKey(),
    queryFn: ({ signal }) => portalGetActiveTimers({ signal }),
    ...queryOptions,
  });
};

// ---------------------------------------------------------------------------
// Portal job detail — GET /portal/jobs/:id
// ---------------------------------------------------------------------------

export interface PortalJobPart {
  name: string | null;
  quantity: number | null;
  unit: string | null;
}

export interface PortalChemicalApplication {
  id: number;
  productName: string | null;
  mixtureName: string | null;
  volumeApplied: number;
  volumeUnit: string;
  treatedArea: number | null;
  areaUnit: string | null;
  treatedZoneName: string | null;
  appliedAt: string;
  rainfastUntil: string | null;
  reentryUntil: string | null;
}

export interface PortalJobDetail {
  id: number;
  title: string;
  description: string | null;
  status: string;
  scheduledAt: string;
  completedAt: string | null;
  clockInAt: string | null;
  propertyAddress: string | null;
  totalAmount: number;
  assignedToName: string | null;
  cancellationRequestedAt: string | null;
  cancellationReason: string | null;
  parts: PortalJobPart[];
  chemicalApplications: PortalChemicalApplication[];
}

export const portalGetJobDetail = async (
  id: number,
  options?: RequestInit,
): Promise<PortalJobDetail> => {
  return customFetch<PortalJobDetail>(`/api/portal/jobs/${id}`, {
    ...options,
    method: "GET",
  });
};

export const getPortalJobDetailQueryKey = (id: number) => ["/api/portal/jobs", id] as const;

export const usePortalGetJobDetail = <TData = PortalJobDetail, TError = ErrorType<unknown>>(
  id: number,
  options?: { query?: UseQueryOptions<PortalJobDetail, TError, TData> },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions } = options ?? {};
  return useQuery<PortalJobDetail, TError, TData>({
    queryKey: getPortalJobDetailQueryKey(id),
    queryFn: ({ signal }) => portalGetJobDetail(id, { signal }),
    enabled: id > 0,
    ...queryOptions,
  });
};
