import { describe, expect, it } from 'vitest';
import {
  enqueueOutbox,
  flushOutbox,
  loadOutbox,
  mergeMessagesByClientId,
  messageOutboxKey,
  retryOutbox,
  type OutboxStorage,
} from './messageOutbox';

function memoryStorage(): OutboxStorage {
  const values = new Map<string, string>();
  return {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
}

describe('persistent message outbox', () => {
  it('hydrates only the authenticated scope and context', async () => {
    const storage = memoryStorage();
    const a = messageOutboxKey(1, 2, { kind: 'job', jobId: 3 });
    const b = messageOutboxKey(1, 4, { kind: 'job', jobId: 3 });
    await enqueueOutbox(a, 'scoped', storage);
    expect((await loadOutbox(a, storage))[0].body).toBe('scoped');
    expect(await loadOutbox(b, storage)).toEqual([]);
  });

  it('uses the stable id on sequential retry, removes successes, and retains failures', async () => {
    const storage = memoryStorage();
    const key = messageOutboxKey(1, 2, { kind: 'general', threadUserId: 2 });
    const first = await enqueueOutbox(key, 'one', storage);
    const second = await enqueueOutbox(key, 'two', storage);
    const calls: string[] = [];
    const failed = await flushOutbox(key, async item => {
      calls.push(item.clientMessageId);
      if (item.clientMessageId === second.clientMessageId) throw new Error('offline');
    }, storage, 100);
    expect(calls).toEqual([first.clientMessageId, second.clientMessageId]);
    expect(failed).toMatchObject([{ clientMessageId: second.clientMessageId, status: 'failed', attempts: 1 }]);
    await retryOutbox(key, second.clientMessageId, storage);
    const retried: string[] = [];
    expect(await flushOutbox(key, async item => { retried.push(item.clientMessageId); }, storage, 100)).toEqual([]);
    expect(retried).toEqual([second.clientMessageId]);
  });

  it('deduplicates an acknowledged optimistic message', () => {
    const optimistic = { clientMessageId: 'stable-id', body: 'hello', createdAt: '', status: 'queued' as const, attempts: 0 };
    expect(mergeMessagesByClientId([{ id: 1, clientMessageId: 'stable-id', createdAt: '' }], [optimistic])).toHaveLength(1);
  });
});