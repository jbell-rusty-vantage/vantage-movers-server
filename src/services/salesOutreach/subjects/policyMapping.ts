import { createHash } from "node:crypto";
import type { SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import { canonicalJson } from "../../durableWork/checksum";
import type { DeskLeadFacts } from "./leadFacts";

type Cadence = SalesOutreachConfigurationValue["cadence"];
type PriorityMap = NonNullable<Cadence["priority_map"]>;
type IntakeDefaults = NonNullable<Cadence["intake_default_rule"]>;

/** Version of the decision fingerprint's input shape (olr B2); a change re-decides every open subject once. */
export const DESK_DECISION_VERSION = "sod-decision-v1";

/**
 * olr B2: the fingerprint of the configuration that decides a subject's workflow — only
 * `cadence.priority_map` and `cadence.intake_default_rule` (`resolveDeskPolicy`). Controls, goals and
 * the other cadence values never re-decide a subject. Map codes are compared as a set (sorted by code),
 * so reordering the map is not a decision change. sha256 hex of the canonical JSON.
 */
export function deskDecisionFingerprint(cadence: Pick<Cadence, "priority_map" | "intake_default_rule">): string {
  const map = cadence.priority_map
    ? { ...cadence.priority_map, codes: [...cadence.priority_map.codes].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)) }
    : null;
  const input = { v: DESK_DECISION_VERSION, priority_map: map, intake_default_rule: cadence.intake_default_rule ?? null };
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** P05e intake sources, keyed like `cadence.intake_default_rule`. */
export type DeskIntakeSource = keyof IntakeDefaults;

/** P05c/P05d codes are Granot's canonical digits; anything else is not an accepted code. */
const ACCEPTED_PRIORITY = /^\d{1,3}$/;

/**
 * The Lead's intake source from its immutable `ingestion_origin` (P05e). Legacy imports and Leads
 * with no recorded origin have no approved intake default: they return null and go to review
 * (historical records are governed by P10 cutover, never treated as fresh intake).
 */
export function intakeSourceOf(facts: Pick<DeskLeadFacts, "ref" | "ingestion_origin">): DeskIntakeSource | null {
  switch (facts.ingestion_origin) {
    case "wordpress_form":
      return facts.ref.model === "FormLead" ? "website_form" : null;
    case "ringcentral":
      return facts.ref.model === "CallLead" ? "ringcentral_call" : null;
    case "best_relocation_sheet":
      return "best_relocation";
    case "vantage_admin":
      return "manual";
    case "granot_lead_created":
      return "granot_created";
    default:
      return null;
  }
}

/**
 * The policy the desk selects for a Lead from its current facts and the persisted configuration
 * (P05d priority map, P05e intake defaults). Pure; reads only `cadence.priority_map` and
 * `cadence.intake_default_rule` — never env, never a hard-coded map.
 *
 * - `accepted`: an accepted Granot priority mapped through the configured map; the same code means
 *   the same thing whatever source accepted it (webhook, extension, HTTP automation). An accepted code
 *   absent from the map is `none` ("No policy configured", Owner review, P05c). A mapped closure code
 *   (5/7/8) is `closed` without inferring an official Booking, duplicate flag or reason (P05d).
 * - `intake_default`: no accepted priority and the source's configured default is New (P05e). This
 *   selects outreach policy only; Granot Priority 0 is never written or fabricated.
 * - `review`: a Granot-created Lead without an accepted priority ("Priority needs review"), a source
 *   with no approved default, or a stored priority that is not a canonical code. No cadence is guessed;
 *   an existing subject keeps its last verified period (P05e retention, see `periodPlanner.ts`).
 * - `unavailable`: the map or the intake defaults are not installed — fail closed.
 */
export type DeskPolicyDecision =
  | Readonly<{
      kind: "accepted";
      workflow: SalesOutreachWorkflow;
      priority_raw: string;
      closure_reason: PriorityMap["codes"][number]["closure_reason"];
      observation_id: string | null;
      accepted_at: Date | null;
    }>
  | Readonly<{ kind: "intake_default"; workflow: "new"; source: DeskIntakeSource }>
  | Readonly<{ kind: "review"; reason: "priority_needs_review" | "unsupported_intake_source" | "malformed_priority" }>
  | Readonly<{ kind: "unavailable"; missing: ReadonlyArray<"cadence.priority_map" | "cadence.intake_default_rule"> }>;

export function resolveDeskPolicy(facts: DeskLeadFacts, cadence: Pick<Cadence, "priority_map" | "intake_default_rule">): DeskPolicyDecision {
  const missing: Array<"cadence.priority_map" | "cadence.intake_default_rule"> = [];
  if (!cadence.priority_map) missing.push("cadence.priority_map");
  if (!cadence.intake_default_rule) missing.push("cadence.intake_default_rule");
  if (missing.length) return { kind: "unavailable", missing };
  const map = cadence.priority_map!;
  const raw = facts.granot_priority;
  if (raw !== null) {
    if (!ACCEPTED_PRIORITY.test(raw)) return { kind: "review", reason: "malformed_priority" };
    const mapped = map.codes.find((entry) => entry.code === raw);
    return {
      kind: "accepted",
      workflow: mapped ? mapped.workflow : map.unmapped_workflow,
      priority_raw: raw,
      closure_reason: mapped ? mapped.closure_reason : null,
      observation_id: facts.accepted_observation?.observation_id ?? null,
      accepted_at: facts.accepted_observation?.captured_at ?? null,
    };
  }
  const source = intakeSourceOf(facts);
  if (!source) return { kind: "review", reason: "unsupported_intake_source" };
  if (cadence.intake_default_rule![source] === "new") return { kind: "intake_default", workflow: "new", source };
  return { kind: "review", reason: "priority_needs_review" };
}

