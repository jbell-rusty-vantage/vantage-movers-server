import { createHash } from "node:crypto";
import type { SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import { addDays } from "../engine/calendar";
import { OutreachError } from "../errors";
import { newYorkBusinessDay } from "../reads/businessDay";
import { evaluateDeskEligibility } from "../subjects/eligibility";
import { deskLeadKey, type DeskLeadFacts, type DeskLeadRef } from "../subjects/leadFacts";
import { resolveDeskPolicy } from "../subjects/policyMapping";
import { isReliableReceived, receivedFactsOf } from "../subjects/subjectBuilder";

/** Version of the selection/classification algorithm recorded in every manifest. */
export const ENROLLMENT_ALGORITHM_VERSION = "sod-enrollment-v1" as const;
/** Largest selection one run may freeze (a 90-day backfill is a few thousand Leads). */
export const ENROLLMENT_MAX_SELECTION = 20_000;

/**
 * Where an existing Lead stands for enrollment (FAST-TRACK "Backfill scope", MANUAL-START step 2):
 * - `in_scope`: eligible (P05h) New/Quoted by accepted priority or New by intake default (P05e), with a
 *   reliable received time, and inside the backfill scope (or explicitly selected);
 * - `older`: the same, but outside the backfill scope ("Not enrolled — older", one-click Enroll);
 * - `already_enrolled`, `closed`, `excluded` (duplicate / unmatched Booking anchor);
 * - `review`: missing/unreliable received time, ambiguous identity, unsupported or unmapped priority,
 *   Priority needs review — never a guessed enrollment;
 * - `not_new_or_quoted`: accepted Priority 3 (No routine cadence).
 */
export type EnrollmentPartition = "in_scope" | "older" | "already_enrolled" | "closed" | "excluded" | "review" | "not_new_or_quoted";
export const ENROLLMENT_PARTITIONS: readonly EnrollmentPartition[] = ["in_scope", "older", "already_enrolled", "closed", "excluded", "review", "not_new_or_quoted"];

export type BackfillScope = Readonly<{ mode: "backfill_scope"; today: string; cutoff_date: string; lookback_days: number; include_upcoming_moves: boolean }>;
export type EnrollmentScope = BackfillScope | Readonly<{ mode: "selected"; today: string }>;

export type CandidateClassification = Readonly<{
  lead: DeskLeadRef;
  partition: EnrollmentPartition;
  reason: string;
  workflow: SalesOutreachWorkflow | null;
  priority_raw: string | null;
  received_date: string | null;
  move_date: string | null;
  job_no: string | null;
  name: string | null;
}>;

/**
 * The FAST-01 backfill scope from the persisted configuration: received in the last
 * `backfill_lookback_days` New York dates (received date on or after today − lookback), or a move
 * date today or later when `backfill_include_upcoming_moves`. Not installed → fail closed.
 */
export function backfillScopeOf(transition: SalesOutreachConfigurationValue["transition"], asOf: Date): BackfillScope {
  const lookback = transition.backfill_lookback_days;
  const upcoming = transition.backfill_include_upcoming_moves;
  if (lookback === null || upcoming === null)
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [
      ...(lookback === null ? [{ path: "transition.backfill_lookback_days", code: "not_installed" }] : []),
      ...(upcoming === null ? [{ path: "transition.backfill_include_upcoming_moves", code: "not_installed" }] : []),
    ]);
  const today = newYorkBusinessDay(asOf);
  return { mode: "backfill_scope", today, cutoff_date: addDays(today, -lookback), lookback_days: lookback, include_upcoming_moves: upcoming };
}

export function classifyEnrollmentCandidate(
  facts: DeskLeadFacts,
  input: Readonly<{
    as_of: Date;
    cadence: Pick<SalesOutreachConfigurationValue["cadence"], "priority_map" | "intake_default_rule">;
    scope: EnrollmentScope;
    enrolled: boolean;
    ambiguous_identity: boolean;
  }>,
): CandidateClassification {
  const received = receivedFactsOf(facts, input.as_of);
  const decision = resolveDeskPolicy(facts, input.cadence);
  const base = {
    lead: facts.ref,
    received_date: received.received_date,
    move_date: facts.move_date,
    job_no: facts.job_no,
    name: facts.name,
    priority_raw: facts.granot_priority,
    workflow: decision.kind === "accepted" || decision.kind === "intake_default" ? decision.workflow : null,
  };
  const as = (partition: EnrollmentPartition, reason: string): CandidateClassification => ({ ...base, partition, reason });
  if (input.enrolled) return as("already_enrolled", "subject_exists");
  const eligibility = evaluateDeskEligibility({ kind: "lead", facts });
  if (eligibility.outcome === "closed") return as("closed", eligibility.reason);
  if (eligibility.outcome === "excluded") return as("excluded", eligibility.reason);
  if (eligibility.outcome === "review") return as("review", eligibility.reason);
  if (decision.kind === "unavailable") throw new OutreachError("CONFIGURATION_UNAVAILABLE", decision.missing.map((path) => ({ path, code: "not_installed" })));
  if (decision.kind === "accepted" && decision.workflow === "closed") return as("closed", decision.closure_reason ?? "closed_priority");
  if (received.received_quality === "missing") return as("review", "received_time_missing");
  if (!isReliableReceived(received)) return as("review", "received_time_unreliable");
  if (input.ambiguous_identity) return as("review", "ambiguous_identity");
  if (decision.kind === "review") return as("review", decision.reason);
  if (decision.kind === "accepted" && decision.workflow === "none") return as("review", "unmapped_priority");
  if (decision.kind === "accepted" && decision.workflow === "discretion") return as("not_new_or_quoted", "priority_discretion");
  if (input.scope.mode === "selected") return as("in_scope", "selected");
  if (received.received_date! >= input.scope.cutoff_date) return as("in_scope", "received_window");
  if (input.scope.include_upcoming_moves && facts.move_date && facts.move_date >= input.scope.today) return as("in_scope", "upcoming_move");
  return as("older", "outside_backfill_scope");
}

/** Lead refs in canonical order (model, then id). */
export function canonicalLeadRefs(refs: readonly DeskLeadRef[]): DeskLeadRef[] {
  const unique = new Map(refs.map((ref) => [deskLeadKey(ref), { model: ref.model, id: ref.id.toLowerCase() }]));
  return [...unique.values()].sort((a, b) => deskLeadKey(a).localeCompare(deskLeadKey(b)));
}

/**
 * The immutable manifest identity (MANUAL-START "immutable manifest hash", P10b "selected-ID scope
 * frozen"): kind, cohort, configuration version, algorithm version and the exact selected Lead ids.
 */
export function enrollmentManifestHash(input: Readonly<{ kind: string; cohort_id: string; configuration_version: string; lead_refs: readonly DeskLeadRef[] }>): string {
  const body = JSON.stringify({
    algorithm_version: ENROLLMENT_ALGORITHM_VERSION,
    kind: input.kind,
    cohort_id: input.cohort_id,
    configuration_version: input.configuration_version,
    lead_refs: canonicalLeadRefs(input.lead_refs).map(deskLeadKey),
  });
  return createHash("sha256").update(body).digest("hex");
}
