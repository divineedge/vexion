import AsyncStorage from '@react-native-async-storage/async-storage';

export type OutboxStatus = 'queued' | 'sending' | 'failed';
export type MessageContext =
  | { kind: 'general'; threadUserId: number }
  | { kind: 'audience'; audienceType: string; audienceId: number | null }
  | { kind: 'job'; jobId: number };
export type OutboxMessage = {
  clientMessageId: string;
  body: string;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt?: number;
  error?: string;
};

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function messageOutboxKey(tenantId: number, userId: number, context: MessageContext): string {
  const suffix = context.kind === 'job'
    ? `job_${context.jobId}`
    : context.kind === 'audience'
      ? `audience_${context.audienceType}_${context.audienceId ?? 'all'}`
      : `general_${context.threadUserId}`;
  return `staff_message_outbox_t${tenantId}_u${userId}_${suffix}`;
}

export function createClientMessageId(): string {
  const random = Math.random().toString(16).slice(2).padEnd(16, '0');
  return `${Date.now().toString(16)}-${random}-${Math.random().toString(16).slice(2).padEnd(8, '0')}`;
}

export async function loadOutbox(key: string, storage: OutboxStorage = AsyncStorage): Promise<OutboxMessage[]> {
  const raw = await storage.getItem(key);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(key: string, messages: OutboxMessage[], storage: OutboxStorage = AsyncStorage): Promise<void> {
  await storage.setItem(key, JSON.stringify(messages));
}

export async function enqueueOutbox(key: string, body: string, storage: OutboxStorage = AsyncStorage): Promise<OutboxMessage> {
  const messages = await loadOutbox(key, storage);
  const item: OutboxMessage = {
    clientMessageId: createClientMessageId(),
    body,
    createdAt: new Date().toISOString(),
    status: 'queued',
    attempts: 0,
  };
  await saveOutbox(key, [...messages, item], storage);
  return item;
}

export async function retryOutbox(key: string, clientMessageId: string, storage: OutboxStorage = AsyncStorage): Promise<OutboxMessage[]> {
  const messages = (await loadOutbox(key, storage)).map(item => item.clientMessageId === clientMessageId
    ? { ...item, status: 'queued' as const, nextAttemptAt: undefined, error: undefined }
    : item);
  await saveOutbox(key, messages, storage);
  return messages;
}

/** Flushes in creation order. Stops after a failure to preserve strict ordering. */
export async function flushOutbox(
  key: string,
  send: (item: OutboxMessage) => Promise<void>,
  storage: OutboxStorage = AsyncStorage,
  now = Date.now(),
): Promise<OutboxMessage[]> {
  let messages = await loadOutbox(key, storage);
  for (const current of [...messages]) {
    if (current.nextAttemptAt && current.nextAttemptAt > now) break;
    messages = messages.map(item => item.clientMessageId === current.clientMessageId ? { ...item, status: 'sending' } : item);
    await saveOutbox(key, messages, storage);
    try {
      await send(current);
      messages = messages.filter(item => item.clientMessageId !== current.clientMessageId);
      await saveOutbox(key, messages, storage);
    } catch (error) {
      const attempts = current.attempts + 1;
      const delay = Math.min(60_000, 2_000 * (2 ** Math.min(attempts - 1, 5)));
      messages = messages.map(item => item.clientMessageId === current.clientMessageId ? {
        ...item,
        status: 'failed',
        attempts,
        nextAttemptAt: now + delay,
        error: error instanceof Error ? error.message : 'Send failed',
      } : item);
      await saveOutbox(key, messages, storage);
      break;
    }
  }
  return messages;
}

export function mergeMessagesByClientId<T extends { clientMessageId?: string | null; createdAt: string }>(
  server: readonly T[],
  outbox: readonly OutboxMessage[],
): Array<T | OutboxMessage> {
  const serverIds = new Set(server.map(item => item.clientMessageId).filter(Boolean));
  return [...server, ...outbox.filter(item => !serverIds.has(item.clientMessageId))];
}