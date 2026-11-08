export const IMPORT_PROGRESS_BATCH_SIZE = 25;

export interface ImportProgressCounts {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  duplicateCount?: number;
}

export interface ImportProgressSnapshot extends ImportProgressCounts {
  processed: number;
  percent: number;
}

export function importProgressSnapshot(counts: ImportProgressCounts): ImportProgressSnapshot {
  const duplicateCount = counts.duplicateCount ?? 0;
  const processed = counts.created + counts.updated + counts.skipped + counts.failed + duplicateCount;
  const percent = counts.total <= 0 ? 100 : Math.min(100, Math.round((processed / counts.total) * 100));
  return {
    total: counts.total,
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
    failed: counts.failed,
    duplicateCount,
    processed,
    percent,
  };
}

/** Report after each batch, and again when the final row finishes. */
export function shouldReportImportProgress(processed: number, total: number): boolean {
  if (processed <= 0) return false;
  return processed === total || processed % IMPORT_PROGRESS_BATCH_SIZE === 0;
}
