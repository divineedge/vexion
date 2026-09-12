import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  VoipInputError,
  getRingCentralValidationToken,
  normalizeVoipEvent,
  verifyQuoWebhook,
} from "./externalVoipAdapters";

describe("Quo webhook adapter", () => {
  const quoCall = {
    id: "EV-call-1",
    type: "call.completed",
    createdAt: "2026-04-13T12:00:55.000Z",
    data: {
      resource: {
        id: "AC-call-1",
        direction: "incoming",
        status: "answered",
        createdAt: "2026-04-13T11:59:55.000Z",
        answeredAt: "2026-04-13T12:00:00.000Z",
        completedAt: "2026-04-13T12:00:55.000Z",
        duration: 55,
        hasVoicemail: false,
      },
      context: {
        orgId: "OR123",
        phoneNumberId: "PN123",
        conversationId: "CN123",
        phoneNumberType: "shared",
        userId: "US123",
        contacts: { ids: [], lookupStatus: "none" },
        participants: {
          workspace: ["+15550000001"],
          external: ["+15550000002"],
          resolution: "available",
        },
      },
      links: { quo: null },
    },
  };

  it("normalizes current call.completed and keeps duration in seconds", () => {
    const [event] = normalizeVoipEvent("quo", quoCall);
    assert.deepEqual(event, {
      eventId: "quo:call.completed:EV-call-1",
      type: "call",
      direction: "inbound",
      from: "+15550000002",
      to: "+15550000001",
      occurredAt: "2026-04-13T12:00:55.000Z",
      status: "answered",
      durationSeconds: 55,
    });
  });

  it("normalizes current message.received without using media URLs", () => {
    const payload = {
      id: "EV-message-1",
      type: "message.received",
      data: {
        resource: {
          id: "AC-message-1",
          direction: "incoming",
          text: "hello",
          media: [{ type: "image/jpeg", url: "https://provider.example/should-not-fetch" }],
          status: "received",
          createdAt: "2026-04-13T12:00:00.000Z",
        },
        context: {
          orgId: "OR123",
          senderIdentifier: "+15550001111",
          recipientIdentifiers: ["+15550002222"],
        },
      },
    };
    assert.deepEqual(normalizeVoipEvent("quo", payload), [{
      eventId: "quo:message.received:EV-message-1",
      type: "sms",
      direction: "inbound",
      from: "+15550001111",
      to: "+15550002222",
      occurredAt: "2026-04-13T12:00:00.000Z",
      status: "received",
      body: "hello",
    }]);
  });

  it("accepts the documented legacy Quo/OpenPhone sent-message envelope", () => {
    const payload = {
      id: "EV-message-sent-1",
      type: "message.sent",
      data: {
        object: {
          id: "AC-message-sent-1",
          from: "+15550002222",
          to: "+15550001111",
          direction: "outgoing",
          body: "reply",
          status: "sent",
          createdAt: "2026-04-13T12:01:00.000Z",
        },
      },
    };
    const [event] = normalizeVoipEvent("quo", payload);
    assert.equal(event.type, "sms");
    assert.equal(event.direction, "outbound");
    assert.equal(event.body, "reply");
    assert.equal(event.eventId, "quo:message.sent:EV-message-sent-1");
  });

  it("returns [] for unsupported Quo event types and throws for malformed supported events", () => {
    assert.deepEqual(normalizeVoipEvent("quo", { type: "call.recording.completed" }), []);
    assert.deepEqual(normalizeVoipEvent("quo", null), []);
    assert.throws(
      () => normalizeVoipEvent("quo", { type: "call.completed", data: {} }),
      VoipInputError,
    );
    assert.throws(
      () => normalizeVoipEvent("quo", {
        ...quoCall,
        data: {
          ...quoCall.data,
          resource: { ...quoCall.data.resource, duration: "55" },
        },
      }),
      VoipInputError,
    );
  });

  it("uses stable event IDs across duplicate deliveries", () => {
    const first = normalizeVoipEvent("quo", quoCall);
    const retry = normalizeVoipEvent("quo", structuredClone(quoCall));
    assert.equal(first[0]?.eventId, retry[0]?.eventId);
  });
});

describe("RingCentral webhook adapter", () => {
  const ringCentralTelephony = {
    uuid: "notification-1",
    event: "/restapi/v1.0/account/1/extension/2/telephony/sessions",
    timestamp: "2026-04-13T12:00:00.000Z",
    body: {
      sequence: 3,
      sessionId: "legacy-session-1",
      telephonySessionId: "s-session-1",
      eventTime: "2026-04-13T12:00:00.000Z",
      parties: [
        {
          id: "party-inbound",
          direction: "Inbound",
          from: { phoneNumber: "+15550001111" },
          to: { phoneNumber: "+15550002222" },
          status: { code: "Answered", reason: "Pickup" },
        },
        {
          id: "party-outbound",
          direction: "Outbound",
          from: { phoneNumber: "+15550003333" },
          to: { phoneNumber: "+15550004444" },
          status: { code: "Disconnected", reason: "Timeout" },
        },
      ],
    },
  };

  it("maps every documented session party and gives each one a unique stable ID", () => {
    const events = normalizeVoipEvent("ringcentral", ringCentralTelephony);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => ({
      type: event.type,
      direction: event.direction,
      from: event.from,
      to: event.to,
      status: event.status,
      occurredAt: event.occurredAt,
    })), [
      {
        type: "call",
        direction: "inbound",
        from: "+15550001111",
        to: "+15550002222",
        status: "Answered",
        occurredAt: "2026-04-13T12:00:00.000Z",
      },
      {
        type: "call",
        direction: "outbound",
        from: "+15550003333",
        to: "+15550004444",
        status: "Disconnected",
        occurredAt: "2026-04-13T12:00:00.000Z",
      },
    ]);
    assert.notEqual(events[0]?.eventId, events[1]?.eventId);
    assert.match(events[0]?.eventId ?? "", /^ringcentral:call:notification-1:party:/u);
  });

  it("returns [] for SMS message-store changes because they require an API read", () => {
    assert.deepEqual(normalizeVoipEvent("ringcentral", {
      uuid: "message-notification-1",
      event: "/restapi/v1.0/account/1/extension/2/message-store",
      body: {
        accountId: "1",
        extensionId: "2",
        lastUpdated: "2026-04-13T12:00:00.000Z",
        changes: [{ type: "SMS", newCount: 1, updatedCount: 0 }],
      },
    }), []);
  });

  it("normalizes the documented inbound message-store/instant SMS event", () => {
    const [event] = normalizeVoipEvent("ringcentral", {
      uuid: "instant-sms-1",
      event: "/restapi/v1.0/account/1/extension/2/message-store/instant?type=SMS",
      timestamp: "2026-04-13T12:00:00.000Z",
      body: {
        id: "message-1",
        to: [{ phoneNumber: "+15550002222", target: true }],
        from: { phoneNumber: "+15550001111" },
        type: "SMS",
        creationTime: "2026-04-13T11:59:59.000Z",
        direction: "Inbound",
        subject: "Hello from RingCentral",
        messageStatus: "Received",
      },
    });
    assert.deepEqual(event, {
      eventId: "ringcentral:sms:instant-sms-1",
      type: "sms",
      direction: "inbound",
      from: "+15550001111",
      to: "+15550002222",
      occurredAt: "2026-04-13T11:59:59.000Z",
      status: "Received",
      body: "Hello from RingCentral",
    });
  });

  it("throws for malformed supported RingCentral payloads but ignores unknown events", () => {
    assert.deepEqual(normalizeVoipEvent("ringcentral", {
      event: "/restapi/v1.0/account/1/extension/2/presence",
      body: {},
    }), []);
    assert.throws(
      () => normalizeVoipEvent("ringcentral", {
        event: "/restapi/v1.0/account/1/extension/2/telephony/sessions",
        body: { telephonySessionId: "s-1", parties: [] },
      }),
      VoipInputError,
    );
    assert.throws(
      () => normalizeVoipEvent("ringcentral", {
        event: "/restapi/v1.0/account/1/extension/2/message-store",
        body: { changes: [{ type: "SMS", newCount: -1 }] },
      }),
      VoipInputError,
    );
  });
});

describe("webhook verification helpers", () => {
  it("verifies Quo signatures and rejects invalid or stale deliveries", () => {
    const rawBody = Buffer.from('{"type":"message.received"}');
    const secret = `whsec_${Buffer.from("test-signing-key").toString("base64")}`;
    const webhookId = "delivery-1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedContent = `${webhookId}.${timestamp}.${rawBody.toString("utf8")}`;
    const signature = createHmac("sha256", Buffer.from("test-signing-key"))
      .update(signedContent)
      .digest("base64");
    const headers = {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    };

    assert.equal(verifyQuoWebhook(rawBody, headers, secret), true);
    assert.equal(verifyQuoWebhook(Buffer.from("tampered"), headers, secret), false);
    assert.equal(verifyQuoWebhook(rawBody, {
      ...headers,
      "webhook-timestamp": String(Number(timestamp) - 301),
    }, secret), false);
  });

  it("extracts only a bounded RingCentral Validation-Token", () => {
    assert.equal(
      getRingCentralValidationToken({ "Validation-Token": "setup-token" }),
      "setup-token",
    );
    assert.equal(
      getRingCentralValidationToken({ "validation-token": "setup-token" }),
      "setup-token",
    );
    assert.equal(getRingCentralValidationToken({}), null);
    assert.equal(getRingCentralValidationToken({ "Validation-Token": "a".repeat(4097) }), null);
    assert.equal(getRingCentralValidationToken({ "Validation-Token": "bad\nvalue" }), null);
  });
});