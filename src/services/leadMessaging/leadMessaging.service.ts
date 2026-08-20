import { createHash, randomUUID } from "node:crypto";
import { type ClientSession } from "mongoose";
import {
  LEAD_MESSAGING_DRAIN_LIMIT,
  LEAD_MESSAGING_LEASE_MS,
  LEAD_MESSAGING_MAX_MANUAL_RETRIES,
  LEAD_MESSAGING_MAX_ATTEMPTS,
  getLeadMessagingAllowedCountryPrefixes,
  getLeadMessagingDestinationCooldownMs,
  getLeadMessagingHourlyLimit,
  getLeadMessagingMode,
  isLeadMessagingQuietHoursEnabled,
  isTestMode,
  leadMessagingRetryDelayMs,
  shouldAllowLeadMessagingInTestMode,
  type LeadMessageStatus,
} from "../../config/domain";
import {
  createLeadMessage,
  getLeadMessageModel,
  type LeadMessageDocument,
} from "../../models/LeadMessage";
import { getLeadMessageRateLimitModel } from "../../models/LeadMessageRateLimit";
import type { CreateFormLeadInput } from "../../validation/v1.validation";
import { ConflictError, NotFoundError } from "../errors";
import { recordOperationalEvent } from "../observability";
import { toObjectId } from "../../utils/objectId";
import {
  LEAD_CONFIRMATION_MESSAGE_KEY,
  LEAD_CONFIRMATION_TEMPLATE_VERSION,
  buildLeadConfirmationMessage,
} from "./messageBuilder";
import { publishLeadMessagingWakeup } from "./leadMessagingQueue.service";
import { resolveLeadSmsQuietHoursDeferral } from "./quietHours";
import {
  createTwilioSender,
  type TwilioSendInput,
  type TwilioSender,
} from "./twilioAdapter";

export type PersistLeadMessageInput = {
  formLeadId: string;
  destinationPhone: string;
  formInput: CreateFormLeadInput;
  duplicate: boolean;
  testMode: boolean;
  session?: ClientSession;
};

export type LeadMessagingOutcome = {
  message_id: string | null;
  status: string;
};

export async function persistLeadMessageIntent(
  input: PersistLeadMessageInput,
  dependencies: {
    createMessage?: typeof createLeadMessage;
    mode?: ReturnType<typeof getLeadMessagingMode>;
    fromNumber?: string;
    evaluateGuard?: (
      destination: string,
      session?: ClientSession,
    ) => Promise<string | null>;
  } = {},
): Promise<LeadMessageDocument | null> {
  if (
    (input.testMode && !shouldAllowLeadMessagingInTestMode()) ||
    input.formInput.sms_consent !== true
  ) {
    return null;
  }

  const mode = dependencies.mode ?? getLeadMessagingMode();
  const destination = normalizeSmsDestination(input.destinationPhone);
  let skippedReason = input.duplicate
    ? "duplicate_lead"
    : mode === "disabled"
      ? "messaging_disabled"
      : null;
  if (!skippedReason) {
    skippedReason = await (
      dependencies.evaluateGuard ?? reserveLeadMessagingCapacity
    )(destination, input.session);
  }
  const status = skippedReason
    ? "skipped"
    : mode === "queued"
      ? "queued"
      : "pending";
  const configuredFrom =
    dependencies.fromNumber ??
    process.env.TWILIO_FROM_NUMBER?.trim() ??
    "not_configured";

  return (dependencies.createMessage ?? createLeadMessage)(
    {
      form_lead: toObjectId(input.formLeadId),
      provider: "twilio",
      channel: "sms",
      purpose: "quote_request_confirmation",
      message_key: LEAD_CONFIRMATION_MESSAGE_KEY,
      template_version: LEAD_CONFIRMATION_TEMPLATE_VERSION,
      to: destination,
      from: configuredFrom,
      body: buildLeadConfirmationMessage(input.formInput),
      dispatch_mode: mode,
      status,
      skip_reason: skippedReason,
    },
    input.session,
  );
}

export function buildLeadMessageTwilioSendInput(input: {
  to: string;
  from: string;
  body: string;
  statusCallback: string;
  now?: Date;
  messagingServiceSid?: string | null;
  quietHoursEnabled?: boolean;
}): TwilioSendInput {
  const quietHoursEnabled =
    input.quietHoursEnabled ?? isLeadMessagingQuietHoursEnabled();
  const sendAt = quietHoursEnabled
    ? resolveLeadSmsQuietHoursDeferral(input.now ?? new Date())
    : null;
  if (!sendAt) {
    return {
      to: input.to,
      from: input.from,
      body: input.body,
      statusCallback: input.statusCallback,
    };
  }
  const messagingServiceSid =
    input.messagingServiceSid === undefined
      ? process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null
      : input.messagingServiceSid;
  if (!messagingServiceSid) {
    throw new Error(
      "TWILIO_MESSAGING_SERVICE_SID is required to defer SMS during Eastern quiet hours",
    );
  }
  return {
    to: input.to,
    from: input.from,
    body: input.body,
    statusCallback: input.statusCallback,
    sendAt,
    messagingServiceSid,
  };
}

export async function dispatchPersistedLeadMessage(
  messageId: string,
  sender?: TwilioSender,
  dependencies: { now?: Date; messagingServiceSid?: string | null } = {},
): Promise<LeadMessagingOutcome> {
  if (
    getLeadMessagingMode() === "disabled" ||
    (isTestMode() && !shouldAllowLeadMessagingInTestMode())
  ) {
    return { message_id: messageId, status: "disabled" };
  }
  const LeadMessage = getLeadMessageModel();
  const startedAt = new Date();
  const message = await LeadMessage.findOneAndUpdate(
    {
      _id: messageId,
      status: { $in: ["pending", "queued", "retry_scheduled"] },
    },
    {
      $set: {
        status: "sending",
        leased_until: new Date(Date.now() + LEAD_MESSAGING_LEASE_MS),
        lease_owner: randomUUID(),
        last_error_code: null,
        last_error_message: null,
        last_error_more_info: null,
      },
      $inc: { attempt_count: 1 },
    },
    { returnDocument: "after" },
  );
  if (!message) {
    const existing = await LeadMessage.findById(messageId);
    return {
      message_id: existing?._id.toString() ?? null,
      status: existing?.status ?? "not_found",
    };
  }

  let result: Awaited<ReturnType<TwilioSender>>;
  try {
    const send = sender ?? createTwilioSender();
    const credentialsCallback = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
    if (!credentialsCallback) {
      throw new Error("TWILIO_STATUS_CALLBACK_URL is not set");
    }
    result = await send(
      buildLeadMessageTwilioSendInput({
        to: message.to,
        from: message.from,
        body: message.body,
        statusCallback: credentialsCallback,
        now: dependencies.now,
        messagingServiceSid: dependencies.messagingServiceSid,
      }),
    );
  } catch (error) {
    return handleDispatchFailure(message, startedAt, error);
  }

  const providerStatus = result.status || "accepted";
  const status = normalizeAcceptedStatus(providerStatus);
  const now = new Date();
  try {
    const persisted = await LeadMessage.updateOne(
      {
        _id: message._id,
        status: "sending",
        lease_owner: message.lease_owner,
      },
      {
        $set: {
          status,
          provider_status: providerStatus,
          twilio_message_sid: result.sid,
          accepted_at: now,
          ...(status === "sent" ? { sent_at: now } : {}),
          next_attempt_at: null,
          leased_until: null,
          lease_owner: null,
        },
        $push: {
          attempts: {
            $each: [{
              attempt_number: message.attempt_count,
              started_at: startedAt,
              finished_at: now,
              outcome: "accepted",
              twilio_message_sid: result.sid,
              http_status: 201,
              error_code: null,
              error_message: null,
              more_info: null,
            }],
            $slice: -20,
          },
          status_history: {
            $each: [{
              twilio_message_sid: result.sid,
              status: providerStatus,
              received_at: now,
              error_code: null,
              error_message: null,
            }],
            $slice: -50,
          },
        },
        $addToSet: { twilio_message_sids: result.sid },
      },
    );
    if (persisted.modifiedCount !== 1) {
      await recordMessagingEvent(
        message,
        "error",
        "lead_message.accepted_after_lease_expired",
        {
          twilio_message_sid: result.sid,
          provider_status: providerStatus,
        },
      );
      return { message_id: message._id.toString(), status: "uncertain" };
    }
  } catch (error) {
    await recordMessagingEvent(
      message,
      "error",
      "lead_message.accepted_persistence_failed",
      {
        twilio_message_sid: result.sid,
        provider_status: providerStatus,
        cause_message: error instanceof Error ? error.message : String(error),
      },
    );
    return { message_id: message._id.toString(), status: "uncertain" };
  }
  await recordMessagingEvent(message, "info", "lead_message.accepted", {
    twilio_message_sid: result.sid,
    provider_status: providerStatus,
  });
  return { message_id: message._id.toString(), status };
}

async function handleDispatchFailure(
  message: LeadMessageDocument,
  startedAt: Date,
  error: unknown,
): Promise<LeadMessagingOutcome> {
  const LeadMessage = getLeadMessageModel();
  const parsed = parseTwilioError(error);
  const classification = classifyLeadMessagingFailure(
    error,
    message.attempt_count,
  );
  const retryable = classification.retryable;
  const status = classification.status;
  const now = new Date();
  const nextAttemptAt = retryable
    ? new Date(Date.now() + leadMessagingRetryDelayMs(message.attempt_count))
    : null;
  const persisted = await LeadMessage.updateOne(
    {
      _id: message._id,
      status: "sending",
      lease_owner: message.lease_owner,
    },
    {
      $set: {
        status,
        next_attempt_at: nextAttemptAt,
        leased_until: null,
        lease_owner: null,
        last_error_code: parsed.code,
        last_error_message: parsed.message,
        last_error_more_info: parsed.moreInfo,
      },
      $push: {
        attempts: {
          $each: [{
            attempt_number: message.attempt_count,
            started_at: startedAt,
            finished_at: now,
            outcome: retryable
              ? "retry_scheduled"
              : status === "uncertain"
                ? "uncertain"
                : "failed",
            twilio_message_sid: null,
            http_status: parsed.status,
            error_code: parsed.code,
            error_message: parsed.message,
            more_info: parsed.moreInfo,
          }],
          $slice: -20,
        },
      },
    },
  );
  if (persisted.modifiedCount !== 1) {
    await recordMessagingEvent(
      message,
      "error",
      "lead_message.failure_after_lease_expired",
      {
        error_code: parsed.code,
        error_message: parsed.message,
      },
    );
    return { message_id: message._id.toString(), status: "uncertain" };
  }
  await recordMessagingEvent(message, "error", "lead_message.dispatch_failed", {
    status,
    http_status: parsed.status,
    error_code: parsed.code,
    error_message: parsed.message,
    retry_at: nextAttemptAt?.toISOString() ?? null,
  });
  if (retryable) {
    await publishLeadMessagingWakeup(
      "retry",
      `lead-message-retry-${message._id}-${message.attempt_count}`,
    );
  }
  return { message_id: message._id.toString(), status };
}

export async function queueInitialLeadMessage(
  messageId: string,
): Promise<LeadMessagingOutcome> {
  await publishLeadMessagingWakeup("initial", `lead-message-initial-${messageId}`);
  return { message_id: messageId, status: "queued" };
}

export async function runLeadMessagingDrain(
  source: "queue" | "cron" | "manual",
): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  if (
    getLeadMessagingMode() === "disabled" ||
    (isTestMode() && !shouldAllowLeadMessagingInTestMode())
  ) {
    return { claimed: 0, outcomes: { disabled: 1 } };
  }
  const LeadMessage = getLeadMessageModel();
  const outcomes: Record<string, number> = {};
  let claimed = 0;
  await LeadMessage.updateMany(
    {
      status: "sending",
      leased_until: { $lte: new Date() },
    },
    {
      $set: {
        status: "uncertain",
        leased_until: null,
        lease_owner: null,
        next_attempt_at: null,
        last_error_message:
          "Dispatch lease expired before the provider outcome was persisted.",
      },
    },
  );
  for (let index = 0; index < LEAD_MESSAGING_DRAIN_LIMIT; index += 1) {
    const now = new Date();
    const candidate = await LeadMessage.findOne({
      status: { $in: ["pending", "queued", "retry_scheduled"] },
      $and: [
        {
          $or: [
            { next_attempt_at: null },
            { next_attempt_at: { $lte: now } },
          ],
        },
        {
          $or: [{ leased_until: null }, { leased_until: { $lte: now } }],
        },
      ],
    })
      .sort({ next_attempt_at: 1, createdAt: 1 })
      .select("_id");
    if (!candidate) break;
    const result = await dispatchPersistedLeadMessage(candidate._id.toString());
    claimed += 1;
    outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
  }
  await recordOperationalEvent({
    level: "info",
    eventKey: "lead_messaging.drain.completed",
    category: "messaging",
    workflow: "lead_messaging_drain",
    summary: "Lead messaging drain completed.",
    details: { source, claimed, outcomes },
    notificationCandidate: false,
    reportable: false,
  });
  return { claimed, outcomes };
}

export async function applyTwilioStatusCallback(input: {
  messageSid: string;
  messageStatus: string;
  errorCode?: number | null;
  errorMessage?: string | null;
}): Promise<boolean> {
  const LeadMessage = getLeadMessageModel();
  const message = await LeadMessage.findOne({
    $or: [
      { twilio_message_sid: input.messageSid },
      { twilio_message_sids: input.messageSid },
    ],
  })
    .select("_id form_lead to from channel purpose twilio_message_sid")
    .lean();
  if (!message) return false;

  const incoming = input.messageStatus.toLowerCase();
  const now = new Date();
  const statusEvent = {
    twilio_message_sid: input.messageSid,
    status: incoming,
    received_at: now,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
  };
  if (message.twilio_message_sid !== input.messageSid) {
    await LeadMessage.updateOne(
      { _id: message._id },
      {
        $push: {
          status_history: { $each: [statusEvent], $slice: -50 },
        },
      },
    );
    await recordStatusCallbackEvent(message, input, incoming, false);
    return true;
  }

  const incomingRank = PROVIDER_STATUS_RANK[incoming];
  if (incomingRank === undefined) {
    await LeadMessage.updateOne(
      { _id: message._id, twilio_message_sid: input.messageSid },
      {
        $push: {
          status_history: { $each: [statusEvent], $slice: -50 },
        },
      },
    );
    await recordStatusCallbackEvent(message, input, incoming, false);
    return true;
  }
  const allowedCurrent = Object.entries(PROVIDER_STATUS_RANK)
    .filter(
      ([status, rank]) =>
        rank <= incomingRank &&
        !["delivered", "read", "failed", "undelivered", "canceled"].includes(
          status,
        ),
    )
    .map(([status]) => status);
  const updateResult = await LeadMessage.updateOne(
    {
      _id: message._id,
      twilio_message_sid: input.messageSid,
      $or: [
        { provider_status: null },
        { provider_status: { $exists: false } },
        { provider_status: { $in: allowedCurrent } },
      ],
    },
    {
      $set: {
        provider_status: incoming,
        status: normalizeCallbackStatus(incoming),
        last_error_code: input.errorCode ?? null,
        last_error_message: input.errorMessage ?? null,
        ...(incoming === "sent" ? { sent_at: now } : {}),
        ...(incoming === "delivered" ? { delivered_at: now } : {}),
      },
      $push: {
        status_history: { $each: [statusEvent], $slice: -50 },
      },
    },
  );
  await recordStatusCallbackEvent(
    message,
    input,
    incoming,
    updateResult.modifiedCount === 1,
  );
  return true;
}

export async function listLeadMessages(input: {
  page: number;
  limit: number;
  status?: string;
  formLeadId?: string;
  phone?: string;
}) {
  const LeadMessage = getLeadMessageModel();
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  if (input.formLeadId) filter.form_lead = input.formLeadId;
  if (input.phone) filter.to = input.phone;
  const [items, total] = await Promise.all([
    LeadMessage.find(filter)
      .select("-body -attempts -status_history -last_error_more_info")
      .sort({ createdAt: -1 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .lean(),
    LeadMessage.countDocuments(filter),
  ]);
  return { items, page: input.page, limit: input.limit, total };
}

export async function getLeadMessage(id: string) {
  const message = await getLeadMessageModel().findById(id).lean();
  if (!message) throw new NotFoundError("Lead message not found");
  return message;
}

export async function requestLeadMessageRetry(
  id: string,
  requestedBy: string,
): Promise<LeadMessagingOutcome> {
  const LeadMessage = getLeadMessageModel();
  const message = await LeadMessage.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ["failed", "undelivered"] },
      manual_retry_count: { $lt: LEAD_MESSAGING_MAX_MANUAL_RETRIES },
      twilio_message_sid: null,
      twilio_message_sids: { $size: 0 },
    },
    {
      $set: {
        status: "queued",
        next_attempt_at: new Date(),
        leased_until: null,
        lease_owner: null,
        manual_retry_requested_by: requestedBy,
      },
      $inc: { manual_retry_count: 1 },
    },
    { returnDocument: "after" },
  );
  if (!message) {
    const existing = await LeadMessage.findById(id)
      .select("status manual_retry_count twilio_message_sid twilio_message_sids")
      .lean();
    if (!existing) throw new NotFoundError("Lead message not found");
    if (
      existing.twilio_message_sid ||
      (existing.twilio_message_sids?.length ?? 0) > 0
    ) {
      throw new ConflictError(
        "Lead message has a provider SID and must be reconciled instead of retried",
      );
    }
    if (
      existing.manual_retry_count >= LEAD_MESSAGING_MAX_MANUAL_RETRIES
    ) {
      throw new ConflictError("Lead message manual retry limit reached");
    }
    throw new ConflictError(
      `Lead message cannot be retried from ${existing.status}`,
    );
  }
  await publishLeadMessagingWakeup(
    "manual_retry",
    `lead-message-manual-${message._id}-${message.manual_retry_count}`,
  );
  return { message_id: message._id.toString(), status: "queued" };
}

function normalizeAcceptedStatus(status: string): LeadMessageStatus {
  if (status === "sent") return "sent";
  return "accepted";
}

function normalizeCallbackStatus(status: string): LeadMessageStatus {
  if (status === "delivered" || status === "read") return "delivered";
  if (status === "undelivered") return "undelivered";
  if (status === "failed" || status === "canceled") return "failed";
  if (status === "sent") return "sent";
  return "accepted";
}

const PROVIDER_STATUS_RANK: Record<string, number> = {
  accepted: 1,
  scheduled: 1,
  queued: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  read: 6,
  undelivered: 5,
  failed: 5,
  canceled: 5,
};

export function shouldApplyTwilioStatus(
  current: string,
  incoming: string,
): boolean {
  if (!current) return true;
  if (current === incoming) return false;
  if (["delivered", "read", "failed", "undelivered", "canceled"].includes(current)) {
    return false;
  }
  return (PROVIDER_STATUS_RANK[incoming] ?? 0) >=
    (PROVIDER_STATUS_RANK[current] ?? 0);
}

type ParsedTwilioError = {
  message: string;
  code: number | null;
  status: number | null;
  moreInfo: string | null;
  systemCode: string | null;
};

function parseTwilioError(error: unknown): ParsedTwilioError {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    message: error instanceof Error ? error.message : String(error),
    code: numberOrNull(value.code),
    status: numberOrNull(value.status),
    moreInfo: typeof value.moreInfo === "string" ? value.moreInfo : null,
    systemCode:
      typeof value.code === "string"
        ? value.code
        : typeof value.errno === "string"
          ? value.errno
          : null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeSmsDestination(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

export async function reserveLeadMessagingCapacity(
  destination: string,
  session?: ClientSession,
): Promise<string | null> {
  if (!/^\+\d{8,15}$/.test(destination)) return "invalid_destination";
  const allowedPrefixes = getLeadMessagingAllowedCountryPrefixes();
  if (!allowedPrefixes.some((prefix) => destination.startsWith(prefix))) {
    return "country_not_allowed";
  }

  const RateLimit = getLeadMessageRateLimitModel();
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setUTCMinutes(0, 0, 0);
  const hourly = await RateLimit.findOneAndUpdate(
    { _id: `hourly:${hourStart.toISOString()}` },
    {
      $set: {
        kind: "hourly",
        expires_at: new Date(hourStart.getTime() + 2 * 60 * 60_000),
      },
      $inc: { count: 1 },
    },
    { upsert: true, returnDocument: "after", session },
  );
  if (hourly.count > getLeadMessagingHourlyLimit()) {
    return "hourly_capacity_reached";
  }

  const cooldownMs = getLeadMessagingDestinationCooldownMs();
  const destinationHash = createHash("sha256")
    .update(destination)
    .digest("hex");
  const decisionToken = randomUUID();
  const cutoff = new Date(now.getTime() - cooldownMs);
  const canReserve = {
    $or: [
      { $eq: [{ $ifNull: ["$last_reserved_at", null] }, null] },
      { $lte: ["$last_reserved_at", cutoff] },
    ],
  };
  const reservation = await RateLimit.findOneAndUpdate(
    { _id: `destination:${destinationHash}` },
    [
      {
        $set: {
          kind: "destination",
          count: { $add: [{ $ifNull: ["$count", 0] }, 1] },
          last_reserved_at: {
            $cond: [canReserve, now, "$last_reserved_at"],
          },
          last_decision_token: {
            $cond: [canReserve, decisionToken, "$last_decision_token"],
          },
          expires_at: new Date(now.getTime() + cooldownMs * 2),
        },
      },
    ],
    { upsert: true, returnDocument: "after", session, updatePipeline: true },
  );
  if (reservation.last_decision_token !== decisionToken) {
    return "destination_cooldown";
  }
  return null;
}

function isDefinitelyUnsentRetryable(error: ParsedTwilioError): boolean {
  return (
    error.status === 429 ||
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(error.systemCode ?? "")
  );
}

function isAmbiguousFailure(error: ParsedTwilioError): boolean {
  return (
    (error.status !== null && error.status >= 500) ||
    ["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(
      error.systemCode ?? "",
    )
  );
}

export function classifyLeadMessagingFailure(
  error: unknown,
  attemptCount: number,
): { status: "retry_scheduled" | "uncertain" | "failed"; retryable: boolean } {
  const parsed = parseTwilioError(error);
  const retryable =
    isDefinitelyUnsentRetryable(parsed) &&
    attemptCount < LEAD_MESSAGING_MAX_ATTEMPTS;
  if (retryable) return { status: "retry_scheduled", retryable: true };
  if (isAmbiguousFailure(parsed)) {
    return { status: "uncertain", retryable: false };
  }
  return { status: "failed", retryable: false };
}

async function recordMessagingEvent(
  message: LeadMessageDocument,
  level: "info" | "error",
  eventKey: string,
  details: Record<string, unknown>,
): Promise<void> {
  await recordOperationalEvent({
    level,
    eventKey,
    category: "messaging",
    workflow: "lead_message_dispatch",
    summary:
      level === "info"
        ? "Lead message accepted by provider."
        : "Lead message dispatch failed.",
    entity: { type: "form_lead", id: message.form_lead.toString() },
    leadIdentity: { phone: message.to },
    details: {
      lead_message_id: message._id.toString(),
      channel: message.channel,
      purpose: message.purpose,
      to: message.to,
      from: message.from,
      ...details,
    },
    notificationCandidate: false,
  });
}

async function recordStatusCallbackEvent(
  message: Pick<
    LeadMessageDocument,
    "_id" | "form_lead" | "to" | "from" | "channel" | "purpose"
  >,
  input: {
    messageSid: string;
    messageStatus: string;
    errorCode?: number | null;
    errorMessage?: string | null;
  },
  providerStatus: string,
  applied: boolean,
): Promise<void> {
  const failed = ["failed", "undelivered", "canceled"].includes(providerStatus);
  const deliveryFailed = failed && applied;
  await recordOperationalEvent({
    level: deliveryFailed ? "error" : "info",
    eventKey: deliveryFailed
      ? "lead_message.delivery_failed"
      : applied
        ? "lead_message.status_updated"
        : "lead_message.status_ignored",
    category: "messaging",
    workflow: "lead_message_delivery",
    summary: deliveryFailed
      ? `Lead message delivery changed to ${providerStatus}.`
      : applied
        ? `Lead message status changed to ${providerStatus}.`
        : `Lead message status ${providerStatus} was received but not applied.`,
    entity: { type: "form_lead", id: message.form_lead.toString() },
    leadIdentity: { phone: message.to },
    details: {
      lead_message_id: message._id.toString(),
      twilio_message_sid: input.messageSid,
      provider_status: providerStatus,
      status_applied: applied,
      channel: message.channel,
      purpose: message.purpose,
      to: message.to,
      from: message.from,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
    },
    errorMessage: deliveryFailed ? input.errorMessage ?? providerStatus : null,
    notificationCandidate: false,
    reportable: applied,
  });
}
