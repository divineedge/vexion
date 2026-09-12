/**
 * Pure adapters for the webhook formats supported by the external-access
 * contract.  This file deliberately does not perform provider API requests:
 * RingCentral message-store change notifications, in particular, contain
 * counters rather than a message, so they cannot be imported without a
 * separate, authenticated message-store read.
 */

import { verifyQuoSignature } from "./quoClient";

export interface NormalizedVoipEvent {
  eventId: string;
  type: "call" | "sms";
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  occurredAt: string;
  status: string;
  durationSeconds?: number;
  body?: string;
}

export class VoipInputError extends Error {
  constructor(message: string) {
    super(`Invalid VoIP webhook payload: ${message}`);
    this.name = "VoipInputError";
  }
}

const MAX_ID_LENGTH = 256;
const MAX_ADDRESS_LENGTH = 256;
const MAX_STATUS_LENGTH = 64;
const MAX_DATE_LENGTH = 128;
const MAX_BODY_LENGTH = 1600;
const MAX_PARTIES = 64;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_HEADER_LENGTH = 4096;

const QUO_MESSAGE_STATUSES = new Set([
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "receiving",
  "received",
  "accepted",
  "scheduled",
  "read",
  "partially_delivered",
  "canceled",
]);

const QUO_CALL_STATUSES = new Set([
  "answered",
  "unanswered",
  "failed",
  "forwarded",
  "abandoned",
  "ai-handled",
  "unknown",
  // The legacy Quo/OpenPhone envelope used this status.
  "completed",
]);

const RINGCENTRAL_STATUS_CODES = new Set([
  "Setup",
  "Proceeding",
  "Answered",
  "Disconnected",
  "Gone",
  "Parked",
  "Hold",
  "VoiceMail",
  "FaxReceive",
  "VoiceMailScreening",
  "VMScreening",
]);

const RINGCENTRAL_MESSAGE_TYPES = new Set(["Voicemail", "SMS", "Fax", "Pager"]);

type UnknownRecord = Record<string, unknown>;
type NormalizedDirection = "inbound" | "outbound";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputError(message: string): never {
  throw new VoipInputError(message);
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowNewlines?: boolean } = {},
): string {
  if (typeof value !== "string") inputError(`${label} must be a string`);
  if (value.length === 0 || value.length > maxLength) {
    inputError(`${label} must contain 1-${maxLength} characters`);
  }
  if (!options.allowNewlines && /[\u0000-\u001f\u007f]/u.test(value)) {
    inputError(`${label} contains control characters`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowNewlines?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, label, maxLength, options);
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) inputError(`${label} must be an object`);
  return value;
}

function requiredDate(value: unknown, label: string): string {
  const raw = requiredString(value, label, MAX_DATE_LENGTH);
  // Provider documentation specifies ISO 8601 date-times. Requiring the
  // date-time marker avoids accepting locale-specific Date.parse values.
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(raw)) {
    inputError(`${label} must be an ISO 8601 date-time`);
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) inputError(`${label} is not a valid date-time`);
  return date.toISOString();
}

function optionalDate(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredDate(value, label);
}

function requiredAddress(value: unknown, label: string): string {
  const address = requiredString(value, label, MAX_ADDRESS_LENGTH);
  if (address.trim() !== address) inputError(`${label} must not have surrounding whitespace`);
  return address;
}

function requiredStatus(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
): string {
  const status = requiredString(value, label, MAX_STATUS_LENGTH);
  if (!allowed.has(status)) inputError(`${label} has an unsupported value`);
  return status;
}

function optionalDuration(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_DURATION_SECONDS
  ) {
    inputError(`${label} must be a bounded non-negative duration`);
  }
  return value;
}

function requiredDirection(value: unknown, label: string): NormalizedDirection {
  if (value === "incoming" || value === "Inbound" || value === "inbound") return "inbound";
  if (value === "outgoing" || value === "Outbound" || value === "outbound") return "outbound";
  inputError(`${label} must be inbound/incoming or outbound/outgoing`);
}

function eventIdPart(value: string): string {
  // IDs are opaque provider values, but an event ID must remain bounded and
  // safe to use in an idempotency key. Encode separators rather than
  // normalizing or hashing an opaque provider identifier.
  return encodeURIComponent(value).slice(0, MAX_ID_LENGTH);
}

function quoResource(data: UnknownRecord): UnknownRecord {
  if (data.resource !== undefined) return requiredRecord(data.resource, "Quo data.resource");
  if (data.object !== undefined) return requiredRecord(data.object, "Quo data.object");
  inputError("Quo data.resource is required");
}

function quoEventId(
  envelope: UnknownRecord,
  resource: UnknownRecord,
  type: string,
): string {
  const envelopeId = optionalBoundedString(envelope.id, "Quo id", MAX_ID_LENGTH);
  const resourceId = requiredString(resource.id, "Quo resource.id", MAX_ID_LENGTH);
  return `quo:${eventIdPart(type)}:${eventIdPart(envelopeId ?? resourceId)}`;
}

function quoMessageAddresses(
  resource: UnknownRecord,
  context: UnknownRecord | undefined,
  direction: NormalizedDirection,
): { from: string; to: string } {
  const explicitFrom = optionalBoundedString(resource.from, "Quo message.from", MAX_ADDRESS_LENGTH);
  const explicitTo = optionalBoundedString(resource.to, "Quo message.to", MAX_ADDRESS_LENGTH);
  if (explicitFrom !== undefined || explicitTo !== undefined) {
    if (explicitFrom === undefined || explicitTo === undefined) {
      inputError("Quo message.from and message.to must be supplied together");
    }
    return { from: requiredAddress(explicitFrom, "Quo message.from"), to: requiredAddress(explicitTo, "Quo message.to") };
  }

  const messageContext = requiredRecord(context, "Quo data.context");
  const sender = requiredAddress(
    messageContext.senderIdentifier,
    "Quo message context.senderIdentifier",
  );
  const recipients = messageContext.recipientIdentifiers;
  if (!Array.isArray(recipients) || recipients.length !== 1) {
    inputError("Quo message context.recipientIdentifiers must contain exactly one recipient");
  }
  const recipient = requiredAddress(recipients[0], "Quo message context.recipientIdentifiers[0]");
  return direction === "inbound"
    ? { from: sender, to: recipient }
    : { from: sender, to: recipient };
}

function quoCallAddresses(
  resource: UnknownRecord,
  context: UnknownRecord | undefined,
  direction: NormalizedDirection,
): { from: string; to: string } {
  const explicitFrom = optionalBoundedString(resource.from, "Quo call.from", MAX_ADDRESS_LENGTH);
  const explicitTo = optionalBoundedString(resource.to, "Quo call.to", MAX_ADDRESS_LENGTH);
  if (explicitFrom !== undefined || explicitTo !== undefined) {
    if (explicitFrom === undefined || explicitTo === undefined) {
      inputError("Quo call.from and Quo call.to must be supplied together");
    }
    return { from: requiredAddress(explicitFrom, "Quo call.from"), to: requiredAddress(explicitTo, "Quo call.to") };
  }

  const callContext = requiredRecord(context, "Quo data.context");
  const participants = requiredRecord(callContext.participants, "Quo call context.participants");
  const workspace = participants.workspace;
  const external = participants.external;
  if (
    !Array.isArray(workspace) ||
    !Array.isArray(external) ||
    workspace.length !== 1 ||
    external.length !== 1
  ) {
    inputError("Quo call participants must contain one workspace and one external address");
  }
  const workspaceAddress = requiredAddress(workspace[0], "Quo call participants.workspace[0]");
  const externalAddress = requiredAddress(external[0], "Quo call participants.external[0]");
  return direction === "inbound"
    ? { from: externalAddress, to: workspaceAddress }
    : { from: workspaceAddress, to: externalAddress };
}

function normalizeQuo(payload: unknown): NormalizedVoipEvent[] {
  if (!isRecord(payload) || typeof payload.type !== "string") return [];

  const type = payload.type;
  if (type !== "call.completed" && type !== "message.received" && type !== "message.sent") {
    return [];
  }

  const data = requiredRecord(payload.data, "Quo data");
  const resource = quoResource(data);
  const context = data.context === undefined ? undefined : requiredRecord(data.context, "Quo data.context");
  const eventId = quoEventId(payload, resource, type);

  if (type === "call.completed") {
    const direction = requiredDirection(resource.direction, "Quo call direction");
    const status = requiredStatus(resource.status, "Quo call status", QUO_CALL_STATUSES);
    const fromTo = quoCallAddresses(resource, context, direction);
    const occurredAt = requiredDate(
      resource.completedAt ?? resource.createdAt ?? payload.createdAt,
      "Quo call occurredAt",
    );
    const durationSeconds = optionalDuration(resource.duration, "Quo call duration");
    return [{
      eventId,
      type: "call",
      direction,
      from: fromTo.from,
      to: fromTo.to,
      occurredAt,
      status,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    }];
  }

  const direction = requiredDirection(resource.direction, "Quo message direction");
  const expectedDirection: NormalizedDirection = type === "message.received" ? "inbound" : "outbound";
  if (direction !== expectedDirection) {
    inputError(`${type} has an inconsistent message direction`);
  }
  const status = requiredStatus(resource.status, "Quo message status", QUO_MESSAGE_STATUSES);
  // The current Quo event API calls this field text. The legacy
  // OpenPhone/Quo envelope calls it body. Accept either documented shape,
  // never derive body from a URL, media item, or another field.
  const messageBody = resource.text !== undefined ? resource.text : resource.body;
  const body = requiredString(messageBody, "Quo message body", MAX_BODY_LENGTH, { allowNewlines: true });
  const fromTo = quoMessageAddresses(resource, context, direction);
  const occurredAt = requiredDate(resource.createdAt ?? payload.createdAt, "Quo message occurredAt");
  return [{
    eventId,
    type: "sms",
    direction,
    from: fromTo.from,
    to: fromTo.to,
    occurredAt,
    status,
    body,
  }];
}

function ringCentralAddress(value: unknown, label: string): string {
  const info = requiredRecord(value, label);
  // RingCentral documents phoneNumber for PSTN endpoints and extensionId for
  // internal endpoints. Instant-message recipients call the internal field
  // extensionNumber. Do not use names, URIs, or arbitrary provider URLs as
  // communication addresses.
  const phoneNumber = optionalBoundedString(info.phoneNumber, `${label}.phoneNumber`, MAX_ADDRESS_LENGTH);
  if (phoneNumber !== undefined) return requiredAddress(phoneNumber, `${label}.phoneNumber`);
  const extensionId = optionalBoundedString(info.extensionId, `${label}.extensionId`, MAX_ADDRESS_LENGTH);
  if (extensionId !== undefined) return requiredAddress(extensionId, `${label}.extensionId`);
  const extensionNumber = optionalBoundedString(
    info.extensionNumber,
    `${label}.extensionNumber`,
    MAX_ADDRESS_LENGTH,
  );
  if (extensionNumber !== undefined) return requiredAddress(extensionNumber, `${label}.extensionNumber`);
  inputError(`${label} must contain phoneNumber, extensionId, or extensionNumber`);
}

function ringCentralEventId(
  envelope: UnknownRecord,
  body: UnknownRecord,
  party: UnknownRecord,
  partyIndex: number,
  direction: NormalizedDirection,
  from: string,
  to: string,
  status: string,
): string {
  const uuid = optionalBoundedString(envelope.uuid, "RingCentral uuid", MAX_ID_LENGTH);
  const sessionId = requiredString(
    body.telephonySessionId,
    "RingCentral body.telephonySessionId",
    MAX_ID_LENGTH,
  );
  const sequence =
    body.sequence === undefined || body.sequence === null
      ? "no-sequence"
      : String(body.sequence);
  const partyId = optionalBoundedString(party.id, "RingCentral party.id", MAX_ID_LENGTH);
  const identity = partyId ?? `${direction}:${from}:${to}:${status}:${partyIndex}`;
  const base = uuid ?? `${sessionId}:${sequence}`;
  return [
    "ringcentral:call",
    eventIdPart(base),
    "party",
    eventIdPart(identity),
  ].join(":").slice(0, MAX_ID_LENGTH);
}

function normalizeRingCentralTelephony(
  payload: UnknownRecord,
  body: UnknownRecord,
): NormalizedVoipEvent[] {
  const sessionId = requiredString(
    body.telephonySessionId,
    "RingCentral body.telephonySessionId",
    MAX_ID_LENGTH,
  );
  const parties = body.parties;
  if (!Array.isArray(parties) || parties.length === 0 || parties.length > MAX_PARTIES) {
    inputError("RingCentral body.parties must be a non-empty bounded array");
  }

  const occurredAt = requiredDate(
    body.eventTime ?? payload.timestamp,
    "RingCentral telephony event time",
  );
  const sequence = body.sequence;
  if (
    sequence !== undefined &&
    sequence !== null &&
    (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0 || sequence > 1_000_000_000)
  ) {
    inputError("RingCentral body.sequence must be a bounded integer");
  }

  return parties.map((rawParty, partyIndex) => {
    const party = requiredRecord(rawParty, `RingCentral body.parties[${partyIndex}]`);
    const directionValue = party.direction;
    if (directionValue !== "Inbound" && directionValue !== "Outbound") {
      inputError(`RingCentral party ${partyIndex} has an unsupported direction`);
    }
    const direction: NormalizedDirection = directionValue === "Inbound" ? "inbound" : "outbound";
    const from = ringCentralAddress(party.from, `RingCentral party ${partyIndex}.from`);
    const to = ringCentralAddress(party.to, `RingCentral party ${partyIndex}.to`);
    const statusObject = requiredRecord(
      party.status,
      `RingCentral body.parties[${partyIndex}].status`,
    );
    const status = requiredStatus(
      statusObject.code,
      `RingCentral body.parties[${partyIndex}].status.code`,
      RINGCENTRAL_STATUS_CODES,
    );
    return {
      eventId: ringCentralEventId(
        payload,
        { ...body, telephonySessionId: sessionId },
        party,
        partyIndex,
        direction,
        from,
        to,
        status,
      ),
      type: "call" as const,
      direction,
      from,
      to,
      occurredAt,
      status,
    };
  });
}

function normalizeRingCentralMessageStore(payload: UnknownRecord): NormalizedVoipEvent[] {
  const body = requiredRecord(payload.body, "RingCentral message-store body");
  const changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_PARTIES) {
    inputError("RingCentral message-store body.changes must be a non-empty bounded array");
  }
  for (const [index, rawChange] of changes.entries()) {
    const change = requiredRecord(rawChange, `RingCentral message-store changes[${index}]`);
    const messageType = requiredString(
      change.type,
      `RingCentral message-store changes[${index}].type`,
      MAX_STATUS_LENGTH,
    );
    if (!RINGCENTRAL_MESSAGE_TYPES.has(messageType)) {
      inputError(`RingCentral message-store changes[${index}].type is unsupported`);
    }
    for (const countName of ["newCount", "updatedCount"] as const) {
      const count = change[countName];
      if (
        count !== undefined &&
        (typeof count !== "number" ||
          !Number.isInteger(count) ||
          count < 0 ||
          count > 1_000_000_000)
      ) {
        inputError(`RingCentral message-store ${countName} must be a bounded integer`);
      }
    }
  }
  // The documented message-store event is only a change notification. Its
  // body has no message ID, addresses, status, or text. Importing it would
  // require a provider API fetch, which this adapter intentionally never does.
  return [];
}

function ringCentralSmsEventId(
  payload: UnknownRecord,
  message: UnknownRecord,
): string {
  const uuid = optionalBoundedString(payload.uuid, "RingCentral uuid", MAX_ID_LENGTH);
  const messageId = requiredString(message.id, "RingCentral SMS id", MAX_ID_LENGTH);
  return `ringcentral:sms:${eventIdPart(uuid ?? messageId)}`.slice(0, MAX_ID_LENGTH);
}

function normalizeRingCentralInstantSms(payload: UnknownRecord): NormalizedVoipEvent[] {
  const message = requiredRecord(payload.body, "RingCentral instant SMS body");
  const messageType = requiredString(message.type, "RingCentral SMS type", MAX_STATUS_LENGTH);
  if (messageType !== "SMS") inputError("RingCentral instant message is not an SMS");

  const directionValue = message.direction;
  if (directionValue !== "Inbound" && directionValue !== "Outbound") {
    inputError("RingCentral SMS direction must be Inbound or Outbound");
  }
  const direction: NormalizedDirection = directionValue === "Inbound" ? "inbound" : "outbound";
  const from = ringCentralAddress(message.from, "RingCentral SMS from");
  const recipients = message.to;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > MAX_PARTIES) {
    inputError("RingCentral SMS to must be a bounded non-empty array");
  }
  const targetedRecipients = recipients.filter(recipient => {
    if (!isRecord(recipient)) inputError("RingCentral SMS recipient must be an object");
    if (recipient.target !== undefined && typeof recipient.target !== "boolean") {
      inputError("RingCentral SMS recipient.target must be boolean");
    }
    return recipient.target === true;
  });
  const recipient =
    targetedRecipients.length === 1
      ? targetedRecipients[0]
      : recipients.length === 1
        ? recipients[0]
        : undefined;
  if (recipient === undefined) {
    inputError("RingCentral SMS must identify exactly one recipient");
  }
  const to = ringCentralAddress(recipient, "RingCentral SMS to[0]");
  const body = requiredString(
    message.subject,
    "RingCentral SMS subject/body",
    MAX_BODY_LENGTH,
    { allowNewlines: true },
  );
  const status = requiredString(message.messageStatus, "RingCentral SMS messageStatus", MAX_STATUS_LENGTH);
  const occurredAt = requiredDate(
    message.creationTime ?? message.lastModifiedTime ?? payload.timestamp,
    "RingCentral SMS occurredAt",
  );
  return [{
    eventId: ringCentralSmsEventId(payload, message),
    type: "sms",
    direction,
    from,
    to,
    occurredAt,
    status,
    body,
  }];
}

function normalizeRingCentral(payload: unknown): NormalizedVoipEvent[] {
  if (!isRecord(payload)) return [];

  const event = typeof payload.event === "string" ? payload.event : "";
  if (/\/message-store\/instant(?:[/?]|$)/iu.test(event)) {
    return normalizeRingCentralInstantSms(payload);
  }
  if (/\/message-store(?:[/?]|$)/iu.test(event)) {
    return normalizeRingCentralMessageStore(payload);
  }

  const bodyValue = payload.body;
  const body = isRecord(bodyValue) ? bodyValue : undefined;
  const isTelephonyEvent =
    /\/telephony\/sessions(?:[/?]|$)/iu.test(event) ||
    (body !== undefined &&
      (body.telephonySessionId !== undefined || body.parties !== undefined));
  if (!isTelephonyEvent) return [];
  if (body === undefined) inputError("RingCentral telephony body is required");
  return normalizeRingCentralTelephony(payload, body);
}

/**
 * Normalize only the documented event families. Unknown event types return
 * [], while an event recognized as one of the supported families with an
 * invalid shape throws VoipInputError. No provider URL is fetched.
 *
 * Quo supports the current `data.resource` envelope and the documented
 * legacy `data.object` envelope. Current Quo documents `message.received`;
 * `message.sent` is retained for the legacy sent-message envelope used by
 * existing Quo/OpenPhone webhook installations.
 *
 * RingCentral telephony notifications yield one call event per party. A
 * RingCentral message-store change notifications are intentionally unsupported
 * for ingestion because they only contain SMS counters and require an API
 * fetch to obtain the actual message. The documented
 * `message-store/instant?type=SMS` notification is supported because it
 * includes the message's sender, recipient, text-bearing subject, and status.
 */
export function normalizeVoipEvent(
  provider: "quo" | "ringcentral",
  payload: unknown,
): NormalizedVoipEvent[] {
  return provider === "quo" ? normalizeQuo(payload) : normalizeRingCentral(payload);
}

function headerValue(
  headers: Record<string, string | undefined>,
  wantedName: string,
  maxLength: number,
): string | undefined {
  const wanted = wantedName.toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === wanted);
  if (key === undefined) return undefined;
  const value = headers[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  return value;
}

/**
 * Verify Quo's current Svix-compatible signature over the exact raw body.
 * Quo's actual headers are `webhook-id`, `webhook-timestamp`, and
 * `webhook-signature`; verifyQuoSignature also applies its five-minute replay
 * tolerance.
 */
export function verifyQuoWebhook(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  if (!Buffer.isBuffer(rawBody)) return false;
  const webhookId = headerValue(headers, "webhook-id", MAX_HEADER_LENGTH);
  const webhookTimestamp = headerValue(headers, "webhook-timestamp", MAX_HEADER_LENGTH);
  const webhookSignature = headerValue(headers, "webhook-signature", MAX_HEADER_LENGTH);
  if (webhookId === undefined || webhookTimestamp === undefined || webhookSignature === undefined) {
    return false;
  }
  try {
    return verifyQuoSignature(
      secret,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      rawBody.toString("utf8"),
    );
  } catch {
    return false;
  }
}

/**
 * Return the bounded RingCentral Validation-Token for the setup handshake.
 * Verification-Token authentication is intentionally owned by the backend
 * route; this helper only extracts the token to echo in the response.
 */
export function getRingCentralValidationToken(
  headers: Record<string, string | undefined>,
): string | null {
  return headerValue(headers, "Validation-Token", MAX_HEADER_LENGTH) ?? null;
}