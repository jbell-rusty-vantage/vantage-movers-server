import {
  getGranotLifecycleFlags,
  GRANOT_LIFECYCLE_FLAG_NAMES,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { RECEIPT_WORK_STATES } from "../../models/granotLifecycleSchemas";
import { applyDueGauges } from "./drainer";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type {
  EntityRef,
  ExecutionMode,
  GranotBookingAction,
  GranotObservationKind,
  NormalizationIssueCode,
  NormalizationResult,
  ReceiptWorkState,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export const JOB_PROJECTION_LIMIT = 100;

export type GranotJobRecordLinkProjection = {
  id: string;
  state: "active" | "superseded";
  disputed: boolean;
  source_scope?: { lead_source_company: string; source_granularity_id: string };
  established_by_decision_id: string;
  established_at: string;
  last_observation_id: string;
  last_observed_at: string;
  domain_revision: number;
};

export type GranotJobObservationProjection = {
  id: string;
  receipt_id: string;
  kind: GranotObservationKind;
  normalization_result: NormalizationResult;
  captured_at: string;
  priority: { canonical?: string; valid: boolean };
  booking_action?: GranotBookingAction;
  issue_codes: NormalizationIssueCode[];
};

export type GranotJobDecisionProjection = {
  id: string;
  observation_id: string;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: string;
  target?: EntityRef;
  source_scope?: object;
  candidates: Array<{ target: EntityRef; reason_codes: string[] }>;
  evaluated_gates: Array<{ gate: string; allowed: boolean }>;
  effects: Array<{ kind: string; ref?: EntityRef; changed_paths?: string[] }>;
  next_match_attempt_at?: string;
  decided_at: string;
};

export type GranotJobProjection = {
  normalized_job_no: string;
  record_link?: GranotJobRecordLinkProjection;
  observations: GranotJobObservationProjection[];
  decisions: GranotJobDecisionProjection[];
  capabilities: { complete_timeline: false; cases: false; official_facts: false };
};

export type GranotLifecycleHealthProjection = {
  flags: Record<(typeof GRANOT_LIFECYCLE_FLAG_NAMES)[number], boolean>;
  activation: {
    present: boolean;
    id?: string;
    activated_at?: string;
    processor_version?: string;
  };
  receipts: {
    by_work_state: Record<ReceiptWorkState, number>;
    due_count: number;
    oldest_due_at: string | null;
    oldest_due_age_ms: number | null;
    claimed_count: number;
    expired_claim_count: number;
    dead_letter_count: number;
  };
  decisions_last_24h: Array<{
    execution_mode: ExecutionMode;
    outcome: SynchronizationOutcome;
    reason_code: SynchronizationReasonCode;
    count: number;
  }>;
  record_links: { active: number; disputed: number };
  last_queue_run: GranotLifecycleLastRunProjection;
  last_cron_run: GranotLifecycleLastRunProjection;
};

export type GranotLifecycleLastRunProjection = {
  at: string;
  status: "completed" | "failed";
} | null;

export function normalizeJobProjectionPath(raw: string): string {
  const normalized = normalizeJobNo(raw);
  if (!normalized) {
    throw new GranotLifecycleError(
      "normalized_job_no is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      undefined,
      [{ path: "normalized_job_no", message: "path must normalize to a Job Number" }],
    );
  }
  return normalized;
}

export async function projectGranotJob(
  rawJobNo: string,
  now: Date = new Date(),
): Promise<GranotJobProjection> {
  void now;
  const normalized_job_no = normalizeJobProjectionPath(rawJobNo);
  const [link, observations] = await Promise.all([
    getGranotRecordLinkModel()
      .findOne({
        provider: "granot",
        normalized_job_no,
        state: "active",
      })
      .lean(),
    getGranotObservationModel()
      .find({ "identity.normalized_job_no": normalized_job_no })
      .sort({ captured_at: -1, _id: -1 })
      .limit(JOB_PROJECTION_LIMIT)
      .lean(),
  ]);

  const observationIds = observations.map((row) => row._id);
  const decisions = observationIds.length
    ? await getSynchronizationDecisionModel()
        .find({ observation_id: { $in: observationIds } })
        .sort({ decided_at: -1, _id: -1 })
        .limit(JOB_PROJECTION_LIMIT)
        .lean()
    : [];

  return {
    normalized_job_no,
    record_link: link
      ? {
          id: String(link._id),
          state: link.state,
          disputed: link.disputed,
          source_scope: link.source_scope
            ? {
                lead_source_company: String(link.source_scope.lead_source_company),
                source_granularity_id: String(link.source_scope.source_granularity_id),
              }
            : undefined,
          established_by_decision_id: String(link.established_by_decision_id),
          established_at: new Date(link.established_at).toISOString(),
          last_observation_id: String(link.last_observation_id),
          last_observed_at: new Date(link.last_observed_at).toISOString(),
          domain_revision: link.domain_revision,
        }
      : undefined,
    observations: observations.map((row) => ({
      id: String(row._id),
      receipt_id: String(row.receipt_id),
      kind: row.kind,
      normalization_result: row.normalization_result,
      captured_at: new Date(row.captured_at).toISOString(),
      priority: {
        canonical: row.priority?.canonical,
        valid: row.priority?.valid === true,
      },
      booking_action: row.booking_action?.normalized,
      issue_codes: (row.issues ?? []).map((issue) => issue.code),
    })),
    decisions: decisions.map((row) => ({
      id: String(row._id),
      observation_id: String(row.observation_id),
      attempt: row.attempt,
      execution_mode: row.execution_mode,
      outcome: row.outcome,
      reason_code: row.reason_code,
      match_method: row.match_method,
      target: row.target,
      source_scope: row.source_scope
        ? {
            granot_crm_source_id: String(row.source_scope.granot_crm_source_id),
            lead_source_company: String(row.source_scope.lead_source_company),
            source_granularity_id: String(row.source_scope.source_granularity_id),
            disposition: row.source_scope.disposition,
            policy_version: row.source_scope.policy_version,
          }
        : undefined,
      candidates: row.candidates ?? [],
      evaluated_gates: row.evaluated_gates ?? [],
      effects: row.effects ?? [],
      next_match_attempt_at: row.next_match_attempt_at
        ? new Date(row.next_match_attempt_at).toISOString()
        : undefined,
      decided_at: new Date(row.decided_at).toISOString(),
    })),
    capabilities: { complete_timeline: false, cases: false, official_facts: false },
  };
}

export function flagsToNamedBooleans(
  flags: GranotLifecycleFlags,
): Record<(typeof GRANOT_LIFECYCLE_FLAG_NAMES)[number], boolean> {
  return {
    GRANOT_LIFECYCLE_PROCESSING_ENABLED: flags.processing_enabled,
    GRANOT_LIFECYCLE_SHADOW_MODE: flags.shadow_mode,
    GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: flags.lead_writes_enabled,
    GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED: flags.lead_creation_enabled,
    GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED: flags.booking_cases_enabled,
    GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED: flags.booking_commands_enabled,
    GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED: flags.release_cases_enabled,
    GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED: flags.release_commands_enabled,
    GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED: flags.referral_booking_enabled,
    GRANOT_LIFECYCLE_EMAIL_ENABLED: flags.email_enabled,
  };
}

export async function projectGranotLifecycleHealth(
  now: Date = new Date(),
): Promise<GranotLifecycleHealthProjection> {
  const flags = getGranotLifecycleFlags();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [
    activation,
    receiptStates,
    due,
    expiredClaims,
    decisionCounts,
    activeLinks,
    disputedLinks,
    lastQueue,
    lastCron,
  ] = await Promise.all([
    getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" }).lean(),
    getGranotObservationReceiptModel()
      .aggregate<{ _id: ReceiptWorkState; count: number }>([
        { $group: { _id: "$processing.state", count: { $sum: 1 } } },
      ])
      .exec(),
    getGranotObservationReceiptModel()
      .aggregate<{
        due_count: number;
        oldest_due_at: Date | null;
      }>([
        {
          $match: {
            "processing.state": { $in: ["pending", "retry_scheduled", "claimed"] },
            "processing.next_attempt_at": { $lte: now },
          },
        },
        {
          $group: {
            _id: null,
            due_count: { $sum: 1 },
            oldest_due_at: { $min: "$processing.next_attempt_at" },
          },
        },
      ])
      .exec(),
    getGranotObservationReceiptModel().countDocuments({
      "processing.state": "claimed",
      "processing.leased_until": { $lte: now },
    }),
    getSynchronizationDecisionModel()
      .aggregate<{
        _id: {
          execution_mode: ExecutionMode;
          outcome: SynchronizationOutcome;
          reason_code: SynchronizationReasonCode;
        };
        count: number;
      }>([
        { $match: { decided_at: { $gte: since } } },
        {
          $group: {
            _id: {
              execution_mode: "$execution_mode",
              outcome: "$outcome",
              reason_code: "$reason_code",
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec(),
    getGranotRecordLinkModel().countDocuments({ state: "active" }),
    getGranotRecordLinkModel().countDocuments({ state: "active", disputed: true }),
    loadLastRun("queue"),
    loadLastRun("cron"),
  ]);

  const by_work_state = Object.fromEntries(
    RECEIPT_WORK_STATES.map((state) => [state, 0]),
  ) as Record<ReceiptWorkState, number>;
  for (const row of receiptStates) {
    if (row._id in by_work_state) {
      by_work_state[row._id] = row.count;
    }
  }

  const dueRow = due[0];
  const oldestDue = dueRow?.oldest_due_at ? new Date(dueRow.oldest_due_at) : null;
  const health: GranotLifecycleHealthProjection = {
    flags: flagsToNamedBooleans(flags),
    activation: activation
      ? {
          present: true,
          id: String(activation._id),
          activated_at: new Date(activation.activated_at).toISOString(),
          processor_version: activation.processor_version,
        }
      : { present: false },
    receipts: {
      by_work_state,
      due_count: dueRow?.due_count ?? 0,
      oldest_due_at: oldestDue ? oldestDue.toISOString() : null,
      oldest_due_age_ms: oldestDue ? Math.max(0, now.getTime() - oldestDue.getTime()) : null,
      claimed_count: by_work_state.claimed,
      expired_claim_count: expiredClaims,
      dead_letter_count: by_work_state.dead_letter,
    },
    decisions_last_24h: decisionCounts.map((row) => ({
      execution_mode: row._id.execution_mode,
      outcome: row._id.outcome,
      reason_code: row._id.reason_code,
      count: row.count,
    })),
    record_links: { active: activeLinks, disputed: disputedLinks },
    last_queue_run: lastQueue,
    last_cron_run: lastCron,
  };
  applyDueGauges({
    due_count: health.receipts.due_count,
    oldest_due_age_ms: health.receipts.oldest_due_age_ms,
  });
  return health;
}

async function loadLastRun(
  trigger: "queue" | "cron",
): Promise<GranotLifecycleLastRunProjection> {
  const row = await getOperationalEventModel()
    .findOne({
      event_key: {
        $in: [
          `granot_lifecycle.${trigger}.run.completed`,
          `granot_lifecycle.${trigger}.run.failed`,
        ],
      },
    })
    .sort({ occurred_at: -1, _id: -1 })
    .lean();
  if (!row) {
    return null;
  }
  return {
    at: new Date(row.occurred_at).toISOString(),
    status: row.event_key.endsWith(".failed") ? "failed" : "completed",
  };
}

export const JOB_PROJECTION_FORBIDDEN_KEYS = [
  "payload",
  "headers",
  "phone",
  "email",
  "address",
  "money",
  "source_label",
  "contact",
  "customer",
  "authorization",
  "cookie",
  "x-api-secret",
  "reason",
  "actor_label",
  "activated_by",
] as const;

export function collectForbiddenProjectionKeys(
  value: unknown,
  found: Set<string> = new Set(),
): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectForbiddenProjectionKeys(entry, found);
    }
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (
        JOB_PROJECTION_FORBIDDEN_KEYS.some(
          (forbidden) => normalized === forbidden.toLowerCase(),
        )
      ) {
        found.add(key);
      }
      collectForbiddenProjectionKeys(child, found);
    }
  }
  return [...found];
}

export function assertJobProjectionMasked(projection: GranotJobProjection): void {
  const forbidden = collectForbiddenProjectionKeys(projection);
  if (forbidden.length > 0) {
    throw new Error(`Job projection leaked forbidden keys: ${forbidden.join(",")}`);
  }
}
