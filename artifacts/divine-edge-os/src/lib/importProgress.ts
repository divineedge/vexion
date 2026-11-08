import { getBaseUrl, getDefaultHeaders, type ImportCommitResult, type ImportExportEntity } from "@workspace/api-client-react";

export interface ImportProgressSnapshot {
  processed: number;
  total: number;
  percent: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export type ImportStreamEvent =
  | ({ type: "progress" } & ImportProgressSnapshot)
  | { type: "complete"; result: ImportCommitResult }
  | { type: "error"; error: string };

export function successfulImportRows(progress: Pick<ImportProgressSnapshot, "created" | "updated">): number {
  return progress.created + progress.updated;
}

/** Splits a streamed NDJSON body, keeping an incomplete trailing line for the next chunk. */
export function readImportProgressChunk(buffered: string, chunk: string): { events: ImportStreamEvent[]; rest: string } {
  const text = buffered + chunk;
  const lines = text.split("\n");
  const rest = lines.pop() ?? "";
  const events: ImportStreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed) as ImportStreamEvent);
  }
  return { events, rest };
}

export async function commitImportWithProgress(
  entity: ImportExportEntity,
  file: File,
  mapping: Record<string, string | null>,
  onProgress: (progress: ImportProgressSnapshot) => void,
  addressSource?: string,
): Promise<ImportCommitResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  form.append("stream", "1");
  if (addressSource) form.append("propertyAddressSource", addressSource);
  const base = getBaseUrl() ?? "";
  const response = await fetch(`${base}/api/${entity}/import/commit`, {
    method: "POST",
    body: form,
    headers: getDefaultHeaders(),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "Import failed");
    return data as ImportCommitResult;
  }
  if (!response.ok || !response.body) throw new Error("Import failed");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ImportCommitResult | null = null;
  const apply = (events: ImportStreamEvent[]) => {
    for (const event of events) {
      if (event.type === "progress") onProgress(event);
      else if (event.type === "error") throw new Error(event.error);
      else result = event.result;
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parsed = readImportProgressChunk("", buffer);
    buffer = parsed.rest;
    apply(parsed.events);
    if (done) break;
  }
  if (buffer.trim()) apply(readImportProgressChunk(buffer, "\n").events);
  if (!result) throw new Error("Import finished without a result");
  return result;
}
