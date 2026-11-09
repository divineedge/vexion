export interface TransferJobInput {
  id: number;
  status: string;
  completedAt: Date | null;
  scheduledAt: Date;
  serviceId: number | null;
  serviceName: string | null;
  title: string;
}

export interface PropertyServiceLogDraft {
  sourceJobId: number;
  serviceId: number | null;
  serviceName: string;
  performedAt: Date;
}

/** Completed work stays as a land record. Open work is cancelled and every prior job leaves the property. */
export function propertyTransferPlan(jobs: TransferJobInput[]): {
  logs: PropertyServiceLogDraft[];
  cancelJobIds: number[];
  detachJobIds: number[];
} {
  const logs: PropertyServiceLogDraft[] = [];
  const cancelJobIds: number[] = [];
  const detachJobIds: number[] = [];
  for (const job of jobs) {
    const completed = job.status === "completed" || job.completedAt != null;
    if (completed) {
      const serviceName = (job.serviceName || job.title || "Service").trim() || "Service";
      logs.push({
        sourceJobId: job.id,
        serviceId: job.serviceId,
        serviceName,
        performedAt: job.completedAt ?? job.scheduledAt,
      });
    } else if (job.status !== "cancelled") {
      cancelJobIds.push(job.id);
    }
    detachJobIds.push(job.id);
  }
  return { logs, cancelJobIds, detachJobIds };
}
