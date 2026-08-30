export type NotificationRoute =
  | { pathname: '/(app)/messages'; params?: { jobId: string; title?: string } }
  | { pathname: '/(app)/job/[id]'; params: { id: string } }
  | { pathname: '/(app)/visit/[id]'; params: { id: string } }
  | { pathname: '/(app)/task/[id]'; params: { id: string } };

function validId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

/**
 * Converts only the documented notification payloads into in-app routes.
 * Unknown payloads are deliberately ignored rather than routed generically.
 */
export function notificationRoute(data: unknown): NotificationRoute | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;

  if (payload.type === 'staff_message') return { pathname: '/(app)/messages' };
  if (payload.type === 'job_message') {
    const jobId = validId(payload.jobId);
    if (!jobId) return null;
    const title = typeof payload.title === 'string' && payload.title.length <= 200
      ? payload.title
      : undefined;
    return { pathname: '/(app)/messages', params: { jobId, ...(title ? { title } : {}) } };
  }

  const routeByType = {
    job_assignment: '/(app)/job/[id]',
    visit_assignment: '/(app)/visit/[id]',
    task_assignment: '/(app)/task/[id]',
  } as const;
  const idKey = {
    job_assignment: 'jobId',
    visit_assignment: 'visitId',
    task_assignment: 'taskId',
  } as const;
  if (typeof payload.type === 'string' && payload.type in routeByType) {
    const type = payload.type as keyof typeof routeByType;
    const id = validId(payload[idKey[type]]);
    return id ? { pathname: routeByType[type], params: { id } } : null;
  }
  return null;
}