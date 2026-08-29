import { describe, expect, it } from "vitest";
import {
  aggregateUnread,
  hasEarlierMessagePage,
  mergeMessagePages,
  messageBeforeId,
  MESSAGE_POLL_INTERVAL_MS,
  messagePollInterval,
} from "./messages";

describe("message state helpers", () => {
  it("aggregates general and per-job unread counts without negative values", () => {
    expect(aggregateUnread(2, [1, 4])).toBe(7);
    expect(aggregateUnread(-1, [3, -2])).toBe(3);
  });

  it("polls at a bounded interval only while focused and online", () => {
    expect(messagePollInterval(true, false)).toBe(MESSAGE_POLL_INTERVAL_MS);
    expect(MESSAGE_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(MESSAGE_POLL_INTERVAL_MS).toBeLessThanOrEqual(60_000);
    expect(messagePollInterval(false, false)).toBe(false);
    expect(messagePollInterval(true, true)).toBe(false);
  });

  it("merges newest polling data and older pages without gaps or duplicates", () => {
    const all = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, clientMessageId: `m-${index + 1}` }));
    const newest = all.slice(50);
    const older = all.slice(0, 50);
    const refreshedNewest = [...all.slice(51), { id: 151, clientMessageId: 'm-151' }];
    const merged = mergeMessagePages(refreshedNewest, [older, newest, newest.slice(0, 5), [{ id: 999, clientMessageId: 'm-151' }]]);
    expect(merged.map(message => message.id)).toEqual([...all.map(message => message.id), 151]);
    expect(new Set(merged.map(message => message.clientMessageId)).size).toBe(151);
    expect(messageBeforeId(merged)).toBe(1);
    expect(messageBeforeId(newest)).toBe(51);
  });

  it("tracks whether another bounded earlier page can exist", () => {
    expect(hasEarlierMessagePage(Array(100), [])).toBe(true);
    expect(hasEarlierMessagePage(Array(100), [Array(100)])).toBe(true);
    expect(hasEarlierMessagePage(Array(100), [Array(42)])).toBe(false);
  });
});