export const MESSAGE_POLL_INTERVAL_MS = 45_000;

/** A single bounded polling policy shared by message surfaces. */
export function messagePollInterval(isFocused: boolean, isOffline: boolean): number | false {
  return isFocused && !isOffline ? MESSAGE_POLL_INTERVAL_MS : false;
}

export function aggregateUnread(general: number, jobCounts: readonly number[]): number {
  return Math.max(0, general) + jobCounts.reduce((total, count) => total + Math.max(0, count), 0);
}

export function mergeMessagePages<T extends { id: number; clientMessageId?: string | null }>(
  newest: readonly T[],
  olderPages: readonly (readonly T[])[],
): T[] {
  const byId = new Map<number, T>();
  for (const page of olderPages) for (const message of page) byId.set(message.id, message);
  for (const message of newest) byId.set(message.id, message);
  const byClientId = new Map<string, T>();
  for (const message of byId.values()) {
    if (message.clientMessageId) byClientId.set(message.clientMessageId, message);
  }
  return [...byId.values()]
    .filter(message => !message.clientMessageId || byClientId.get(message.clientMessageId)?.id === message.id)
    .sort((a, b) => a.id - b.id);
}

export function messageBeforeId(messages: readonly { id: number }[]): number | undefined {
  return messages.length ? Math.min(...messages.map(message => message.id)) : undefined;
}

export function hasEarlierMessagePage(
  newest: readonly unknown[],
  olderPages: readonly (readonly unknown[])[],
  pageSize = 100,
): boolean {
  const lastFetchedPage = olderPages.at(-1);
  return (lastFetchedPage ?? newest).length === pageSize;
}