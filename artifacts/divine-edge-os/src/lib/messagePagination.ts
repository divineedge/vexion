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
  return (olderPages.at(-1) ?? newest).length === pageSize;
}