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

async function defaultAggregateOpenDay(
  input: AggregateOpenDayInput,
): Promise<DailyOperationsRebuildCounters> {
  const seed = buildDaySeed(input.day);
  const hourly = seedHourlyBuckets();
  const formLeads = await getFormLeadModel()
    .find({
      timestamp: {
        $gte: input.floridaTimestampRange.start,
        $lt: input.floridaTimestampRange.end,
      },
    })
    .select(
      "duplicate ingestion_origin source_company timestamp pickup_zip pickup_state destination_zip delivery_state",
    )
    .lean()
    .exec();
  const callLeads = await getCallLeadModel()
    .find({
      timestamp: {
        $gte: input.floridaTimestampRange.start,
        $lt: input.floridaTimestampRange.end,
      },
    })
    .select(
      "duplicate created_on_unmatched ingestion_origin source_company timestamp pickup_zip pickup_state delivery_zip delivery_state",
    )
    .lean()
    .exec();

  for (const lead of formLeads) {
    applyLeadCounters(seed, hourly, {
      kind: "form",
      duplicate: Boolean(lead.duplicate),
      unmatched: false,
      origin: lead.ingestion_origin,
      sourceCompany: lead.source_company,
      hour: floridaHour(lead.timestamp),
      zipMiss: zipMissSides({
        pickup_zip: lead.pickup_zip,
        pickup_state: lead.pickup_state,
        delivery_zip: lead.destination_zip,
        delivery_state: lead.delivery_state,
      }),
    });
  }
  for (const lead of callLeads) {
    applyLeadCounters(seed, hourly, {
      kind: "call",
      duplicate: Boolean(lead.duplicate),
      unmatched: Boolean(lead.created_on_unmatched),
      origin: lead.ingestion_origin,
      sourceCompany: lead.source_company,
      hour: floridaHour(lead.timestamp),
      zipMiss: zipMissSides({
        pickup_zip: lead.pickup_zip,
        pickup_state: lead.pickup_state,
        delivery_zip: lead.delivery_zip,
        delivery_state: lead.delivery_state,
      }),
    });
  }

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

  const messages = await getLeadMessageModel()
    .find({
      createdAt: {
        $gte: input.instantRange.start,
        $lt: input.instantRange.end,
      },
    })
    .select("status provider_status createdAt accepted_at sent_at delivered_at")
    .lean()
    .exec();
  for (const message of messages) {
    const hour = easternHour(message.accepted_at ?? message.createdAt);
    if (message.status === "skipped") {
      seed.messages.skipped += 1;
      continue;
    }
    if (
      message.status === "failed" ||
      message.status === "undelivered"
    ) {
      seed.messages.failed += 1;
      continue;
    }
    const held =
      message.status === "accepted" && message.provider_status === "scheduled";
    if (held) {
      seed.messages.deferred += 1;
      continue;
    }
    if (
      message.status === "accepted" ||
      message.status === "sent" ||
      message.status === "delivered"
    ) {
      seed.messages.successful += 1;
      hourly[hour]!.messages += 1;
    }
  }

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

function floridaHour(timestamp: Date | undefined): number {
  if (!timestamp) return 0;
  return timestamp.getUTCHours();
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
