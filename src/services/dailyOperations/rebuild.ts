import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import {
  getDailyOperationsDayModel,
  type DailyOperationsDayDocument,
} from "../../models/DailyOperationsDay";
import { getDailyOperationsEventModel } from "../../models/DailyOperationsEvent";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { normalizeSourceCompany } from "../../config/domain/sources";
import type { GranotRouteEventClass } from "../granotLifecycle/types";
import { classifyGranotBookingActionFromPayload } from "./recordGranotFacts";
import { leadDayOf, leadTimestampScanRange } from "./leadDay";
import { zipMissSides } from "./recordDomainFacts";
import {
  buildDaySeed,
  DAILY_OPERATIONS_ORIGIN_KEYS,
  easternDayKey,
  easternHour,
  easternInstantBounds,
  floridaTimestampBounds,
  seedHourlyBuckets,
  type DailyOperationsDaySeed,
  type InstantBounds,
} from "./dayDocument";

export class DailyOperationsRebuildError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(message: string, statusCode = 409, code = "DAY_CLOSED") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type DailyOperationsRebuildCounters = Pick<
  DailyOperationsDaySeed,
  | "leads"
  | "origins"
  | "companies"
  | "webhooks"
  | "decisions"
  | "messages"
  | "bookings"
  | "cancellations"
  | "intakes"
  | "exceptions"
  | "sheet_sync"
  | "hourly"
>;

export type DailyOperationsRebuildResult = {
  day: string;
  status: "open";
  rebuilt: true;
  events_deleted: false;
  revision: number;
};

export type AggregateOpenDayInput = {
  day: string;
  floridaTimestampRange: InstantBounds;
  instantRange: InstantBounds;
};

export type DailyOperationsRebuildDeps = {
  now?: () => Date;
  loadDay?: (day: string) => Promise<DailyOperationsDayDocument | null>;
  aggregateOpenDay?: (
    input: AggregateOpenDayInput,
  ) => Promise<DailyOperationsRebuildCounters>;
  replaceCounters?: (input: {
    day: string;
    counters: DailyOperationsRebuildCounters;
    previousRevision: number;
  }) => Promise<number>;
  deleteEvents?: (day: string) => Promise<number>;
};

export async function rebuildOpenDailyOperationsDay(
  deps: DailyOperationsRebuildDeps = {},
): Promise<DailyOperationsRebuildResult> {
  const now = deps.now?.() ?? new Date();
  const day = easternDayKey(now);
  const loadDay = deps.loadDay ?? defaultLoadDay;
  const existing = await loadDay(day);
  if (existing?.status === "closed") {
    throw new DailyOperationsRebuildError(
      "Closed days are not rebuilt",
      409,
      "DAY_CLOSED",
    );
  }

  const counters = await (deps.aggregateOpenDay ?? defaultAggregateOpenDay)({
    day,
    floridaTimestampRange: floridaTimestampBounds(day),
    instantRange: easternInstantBounds(day),
  });

  if (deps.deleteEvents) {
    throw new DailyOperationsRebuildError(
      "Rebuild must not delete Daily Operations Events",
      400,
      "EVENTS_APPEND_ONLY",
    );
  }

  const previousRevision = existing?.revision ?? 0;
  const replaceCounters = deps.replaceCounters ?? defaultReplaceCounters;
  const revision = await replaceCounters({
    day,
    counters,
    previousRevision,
  });

  return {
    day,
    status: "open",
    rebuilt: true,
    events_deleted: false,
    revision,
  };
}

async function defaultLoadDay(
  day: string,
): Promise<DailyOperationsDayDocument | null> {
  return getDailyOperationsDayModel().findOne({ day }).lean().exec();
}

async function defaultReplaceCounters(input: {
  day: string;
  counters: DailyOperationsRebuildCounters;
  previousRevision: number;
}): Promise<number> {
  const revision = input.previousRevision + 1;
  const seed = buildDaySeed(input.day);
  const Day = getDailyOperationsDayModel();
  const updated = await Day.updateOne(
    { day: input.day, status: "open" },
    { $set: { ...input.counters, revision } },
  );
  if (updated.matchedCount === 0) {
    await Day.updateOne(
      { day: input.day },
      {
        $setOnInsert: {
          ...seed,
          ...input.counters,
          revision,
        },
      },
      { upsert: true },
    );
  }
  return revision;
}

/** The Lead Message fields a rebuild reads. */
export type RebuildMessageRow = {
  status: string;
  provider_status?: string | null;
  createdAt: Date;
  accepted_at?: Date | null;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  status_history?: ReadonlyArray<{ status?: string | null; received_at?: Date | null }> | null;
};

export type MessageDayEvents = {
  skipped?: Date;
  failed?: Date;
  deferred?: Date;
  successful?: Date;
  /** A scheduled message that was sent, with no recorded send time: labelled on its accept day, never shifted. */
  unreconstructable?: Date;
};

/**
 * The instants of a Lead Message's Daily Operations events, matching live recording (SPECIFICATION §14):
 * - skipped / failed: as before (the creation day);
 * - accepted with a schedule (`status_history` "scheduled", or still `provider_status: scheduled`):
 *   `deferred` on the accept day, and — once sent — `successful` on the day of the first sent/delivered
 *   status (else `sent_at`/`delivered_at`); a sent scheduled message with none of those is
 *   `unreconstructable` (counted on its accept day as a label, not moved to a guessed day);
 * - accepted for immediate send: `successful` on the accept day (live records it on Twilio accept).
 */
export function messageDayEvents(message: RebuildMessageRow): MessageDayEvents {
  if (message.status === "skipped") return { skipped: message.createdAt };
  if (message.status === "failed" || message.status === "undelivered") return { failed: message.createdAt };
  const history = message.status_history ?? [];
  const acceptedAt = message.accepted_at ?? message.createdAt;
  const scheduled = history.some((h) => h.status === "scheduled") || (message.status === "accepted" && message.provider_status === "scheduled");
  const sentStatuses = new Set(["sent", "delivered"]);
  if (!scheduled) return sentStatuses.has(message.status) || message.status === "accepted" ? { successful: acceptedAt } : {};
  const events: MessageDayEvents = { deferred: acceptedAt };
  const sentEntry = history
    .filter((h) => sentStatuses.has(h.status ?? "") && h.received_at instanceof Date)
    .sort((a, b) => +a.received_at! - +b.received_at!)[0];
  const sentAt = sentEntry?.received_at ?? message.sent_at ?? message.delivered_at ?? null;
  if (sentAt) events.successful = sentAt;
  else if (sentStatuses.has(message.status)) events.unreconstructable = acceptedAt;
  return events;
}

/** Applies the selected Lead Message rows to `day` (pure; the agreement tests call it directly). */
export function applyMessageRows(
  day: string,
  seed: DailyOperationsDaySeed,
  hourly: ReturnType<typeof seedHourlyBuckets>,
  rows: readonly RebuildMessageRow[],
): void {
  const onDay = (at: Date | undefined): at is Date => at !== undefined && easternDayKey(at) === day;
  for (const message of rows) {
    const events = messageDayEvents(message);
    if (onDay(events.skipped)) seed.messages.skipped += 1;
    if (onDay(events.failed)) seed.messages.failed += 1;
    if (onDay(events.deferred)) seed.messages.deferred += 1;
    if (onDay(events.unreconstructable)) seed.messages.unreconstructable_sent_day = (seed.messages.unreconstructable_sent_day ?? 0) + 1;
    if (onDay(events.successful)) {
      seed.messages.successful += 1;
      hourly[easternHour(events.successful)]!.messages += 1;
    }
  }
}

/** The Lead fields a rebuild reads (FormLead uses `destination_zip`, CallLead `delivery_zip`). */
export type RebuildLeadRow = {
  duplicate?: boolean | null;
  created_on_unmatched?: boolean | null;
  ingestion_origin?: string | null;
  source_company?: string | null;
  timestamp?: Date | null;
  createdAt?: Date | null;
  pickup_zip?: string | null;
  pickup_state?: string | null;
  destination_zip?: string | null;
  delivery_zip?: string | null;
  delivery_state?: string | null;
};

/**
 * Applies the scanned Lead rows of `day` (pure; the live-vs-rebuild agreement tests call it directly).
 * Only rows whose arrival instant is on `day` count; the hour is that instant's New York hour.
 */
export function applyLeadRows(
  day: string,
  seed: DailyOperationsDaySeed,
  hourly: ReturnType<typeof seedHourlyBuckets>,
  rows: { form: readonly RebuildLeadRow[]; call: readonly RebuildLeadRow[] },
): void {
  for (const [kind, leads] of [["form", rows.form], ["call", rows.call]] as const) {
    for (const lead of leads) {
      const at = leadDayOf(lead);
      if (!at || at.day !== day) continue;
      applyLeadCounters(seed, hourly, {
        kind,
        duplicate: Boolean(lead.duplicate),
        unmatched: kind === "call" && Boolean(lead.created_on_unmatched),
        origin: lead.ingestion_origin ?? undefined,
        sourceCompany: lead.source_company ?? undefined,
        hour: at.hour,
        zipMiss: zipMissSides({
          pickup_zip: lead.pickup_zip,
          pickup_state: lead.pickup_state,
          delivery_zip: kind === "form" ? lead.destination_zip : lead.delivery_zip,
          delivery_state: lead.delivery_state,
        }),
      });
    }
  }
}

async function defaultAggregateOpenDay(
  input: AggregateOpenDayInput,
): Promise<DailyOperationsRebuildCounters> {
  const seed = buildDaySeed(input.day);
  const hourly = seedHourlyBuckets();
  // SRV-9: scan both timestamp conventions, then keep the Leads whose real arrival instant falls on the
  // day (`leadDay.ts`, the rule live recording uses), so Granot-created Leads land on the right day.
  const scan = leadTimestampScanRange(input.floridaTimestampRange);
  const formLeads = await getFormLeadModel()
    .find({ timestamp: { $gte: scan.start, $lt: scan.end } })
    .select(
      "duplicate ingestion_origin source_company timestamp createdAt pickup_zip pickup_state destination_zip delivery_state",
    )
    .lean()
    .exec();
  const callLeads = await getCallLeadModel()
    .find({ timestamp: { $gte: scan.start, $lt: scan.end } })
    .select(
      "duplicate created_on_unmatched ingestion_origin source_company timestamp createdAt pickup_zip pickup_state delivery_zip delivery_state",
    )
    .lean()
    .exec();
  applyLeadRows(input.day, seed, hourly, { form: formLeads as RebuildLeadRow[], call: callLeads as RebuildLeadRow[] });

  const receipts = await getGranotObservationReceiptModel()
    .find({
      observation_channel: "granot_webhook",
      captured_at: {
        $gte: input.instantRange.start,
        $lt: input.instantRange.end,
      },
    })
    .select("captured_at route_event_class payload")
    .lean()
    .exec();
  for (const receipt of receipts) {
    const routeClass = receipt.route_event_class as GranotRouteEventClass | undefined;
    if (!routeClass) continue;
    const hour = easternHour(receipt.captured_at);
    if (routeClass === "lead_created") seed.webhooks.lead_created += 1;
    else if (routeClass === "priority_updated") seed.webhooks.priority_updated += 1;
    else if (routeClass === "booking_status_changed") {
      seed.webhooks.booking_status_changed += 1;
      const action = classifyGranotBookingActionFromPayload(receipt.payload);
      if (action === "booked") seed.webhooks.booked += 1;
      if (action === "release") seed.webhooks.release += 1;
    } else {
      continue;
    }
    hourly[hour]!.webhooks += 1;
  }

  const decisions = await getSynchronizationDecisionModel()
    .find({
      decided_at: {
        $gte: input.instantRange.start,
        $lt: input.instantRange.end,
      },
    })
    .select("outcome")
    .lean()
    .exec();
  for (const decision of decisions) {
    if (decision.outcome === "created") seed.decisions.minted += 1;
    else if (decision.outcome === "linked" || decision.outcome === "applied") {
      seed.decisions.linked += 1;
    } else if (decision.outcome === "pending_match") {
      seed.decisions.pending_match += 1;
    } else if (decision.outcome === "unmatched") {
      seed.decisions.unmatched += 1;
    } else {
      seed.decisions.observed += 1;
    }
  }

  // SRV-9: a message counts on the day each of its events happened (the live rule), so select every
  // message with an event instant on the day, not only those created on it.
  const range = { $gte: input.instantRange.start, $lt: input.instantRange.end };
  const messages = await getLeadMessageModel()
    .find({ $or: [{ createdAt: range }, { accepted_at: range }, { sent_at: range }, { delivered_at: range }] })
    .select("status provider_status createdAt accepted_at sent_at delivered_at status_history.status status_history.received_at")
    .lean()
    .exec();
  applyMessageRows(input.day, seed, hourly, messages as RebuildMessageRow[]);

  const bookings = await BookedLead.find({
    createdAt: {
      $gte: input.instantRange.start,
      $lt: input.instantRange.end,
    },
  })
    .select(
      "createdAt is_referral_booking is_leadless_booking booking_origin lead_ref",
    )
    .lean()
    .exec();
  for (const booking of bookings) {
    seed.bookings.total += 1;
    const kind = inferBookingKind(booking);
    if (kind) {
      seed.bookings[kind] += 1;
    }
    hourly[easternHour(booking.createdAt)]!.bookings += 1;
  }

  const cancellations = await CancelledLead.find({
    createdAt: {
      $gte: input.instantRange.start,
      $lt: input.instantRange.end,
    },
  })
    .select("createdAt")
    .lean()
    .exec();
  for (const cancellation of cancellations) {
    seed.cancellations.total += 1;
    hourly[easternHour(cancellation.createdAt)]!.cancellations += 1;
  }

  seed.intakes.opened = await getGranotBookingReconciliationCaseModel().countDocuments({
    createdAt: {
      $gte: input.instantRange.start,
      $lt: input.instantRange.end,
    },
  });

  // Sheet Sync has no domain collection that records "job done today"; the
  // append-only, per-job-deduped Daily Operations Events are the record.
  const Event = getDailyOperationsEventModel();
  const [sheetSyncCompleted, sheetSyncFailed] = await Promise.all([
    Event.countDocuments({ day: input.day, kind: "sheet_sync.completed" }),
    Event.countDocuments({ day: input.day, kind: "sheet_sync.failed" }),
  ]);

  return {
    sheet_sync: { completed: sheetSyncCompleted, failed: sheetSyncFailed },
    leads: seed.leads,
    origins: seed.origins,
    companies: seed.companies,
    webhooks: seed.webhooks,
    decisions: seed.decisions,
    messages: seed.messages,
    bookings: seed.bookings,
    cancellations: seed.cancellations,
    intakes: seed.intakes,
    exceptions: seed.exceptions,
    hourly,
  };
}

function applyLeadCounters(
  seed: DailyOperationsDaySeed,
  hourly: ReturnType<typeof seedHourlyBuckets>,
  input: {
    kind: "form" | "call";
    duplicate: boolean;
    unmatched: boolean;
    origin?: string | null;
    sourceCompany?: string | null;
    hour: number;
    zipMiss: { pickup: boolean; delivery: boolean };
  },
): void {
  if (input.unmatched) {
    seed.leads.unmatched_call += 1;
    return;
  }
  if (input.duplicate) {
    if (input.kind === "form") seed.leads.duplicate_form += 1;
    else seed.leads.duplicate_call += 1;
    return;
  }
  seed.leads.total += 1;
  if (input.kind === "form") seed.leads.form += 1;
  else seed.leads.call += 1;
  hourly[Math.min(Math.max(input.hour, 0), 23)]!.leads += 1;
  if (
    input.origin &&
    (DAILY_OPERATIONS_ORIGIN_KEYS as readonly string[]).includes(input.origin)
  ) {
    const key = input.origin as (typeof DAILY_OPERATIONS_ORIGIN_KEYS)[number];
    seed.origins[key] += 1;
  }
  const company = normalizeSourceCompany(input.sourceCompany);
  seed.companies[company][input.kind] += 1;
  seed.companies[company].total += 1;
  if (input.zipMiss.pickup || input.zipMiss.delivery) {
    seed.exceptions.zip_missing += 1;
  }
}

function inferBookingKind(booking: {
  is_referral_booking?: boolean;
  is_leadless_booking?: boolean;
  booking_origin?: string | null;
  lead_ref?: unknown;
}): keyof DailyOperationsDaySeed["bookings"] | null {
  if (booking.is_referral_booking) return "referral";
  if (booking.is_leadless_booking) return "leadless";
  if (booking.booking_origin === "employee_booking") {
    return booking.lead_ref ? "employee_linked" : "employee_pending";
  }
  return "admin";
}
