import type { Types } from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { payloadHash } from "../transactions";
import { jsonValue } from "./store";

/**
 * LP-01 §3: pure Lead progress policy. No database, no clock of its own.
 *
 * Owner-confirmed Granot Priority meanings (§3.3): `0` fresh, `1` quoted,
 * `3` rep discretion, `7` CRM bad/unusable, `8` CRM dead opportunity. Every
 * other valid code is displayed raw with no invented meaning; a missing or
 * malformed value is Unknown. Canonical stored `quoted` is read as its own
 * evidence and is never recomputed from the code.
 *
 * S6-P5 (assignment addendum §2, E1), behind SALES_INTELLIGENCE_PRIORITY5_CLOSURE: `5` is
 * `crm_booked` ("Booked in Granot"), a CRM-disposition closure like `7`/`8`. With the flag off `5`
 * stays an unmapped code, exactly as before.
 */
export type Disposition = "fresh" | "quoted" | "rep_discretion" | "crm_bad_unusable" | "crm_dead" | "crm_booked" | "unmapped" | "unknown";
export type ProgressBasis = "quoted" | "priority_assigned" | "priority_changed" | "historical_snapshot";
export type Provenance = "accepted" | "uncertain" | "none";
export type SourceOrigin = "granot" | "vantage" | "ringcentral";
// `crm_booked` is only ever projected with PRIORITY5_CLOSURE on; a stored one stays terminal after a flag rollback.
export const TERMINAL_DISPOSITIONS: readonly Disposition[] = ["crm_bad_unusable", "crm_dead", "crm_booked"];
export const WORK_DISPOSITIONS: readonly Disposition[] = ["quoted", "rep_discretion"];
export const LEAD_PROGRESS_POLICY_VERSION = "lead-progress-v1";

const CONFIRMED: Record<string, { disposition: Disposition; label: string }> = {
  "0": { disposition: "fresh", label: "Fresh" },
  "1": { disposition: "quoted", label: "Quoted" },
  "3": { disposition: "rep_discretion", label: "Rep discretion" },
  "7": { disposition: "crm_bad_unusable", label: "CRM bad/unusable" },
  "8": { disposition: "crm_dead", label: "CRM dead opportunity" },
};
/** S6-P5 (E1): Priority 5, only with SALES_INTELLIGENCE_PRIORITY5_CLOSURE on. */
export const PRIORITY5_CODE = "5";
const PRIORITY5 = { disposition: "crm_booked" as Disposition, label: "Booked in Granot" };
export const priority5ClosureEnabled = () => csiFlag("PRIORITY5_CLOSURE");
const confirmed = (priority: string) => CONFIRMED[priority] ?? (priority === PRIORITY5_CODE && priority5ClosureEnabled() ? PRIORITY5 : undefined);
const DISPOSITION_LABELS: Record<Disposition, string> = {
  fresh: "Fresh", quoted: "Quoted", rep_discretion: "Rep discretion", crm_bad_unusable: "CRM bad/unusable",
  crm_dead: "CRM dead opportunity", crm_booked: "Booked in Granot", unmapped: "Unknown meaning", unknown: "Unknown",
};
const BASIS_LABELS: Record<ProgressBasis, string> = {
  quoted: "Lead quoted", priority_assigned: "Priority assigned in Granot", priority_changed: "Priority changed in Granot",
  historical_snapshot: "Lead quoted (time unknown)",
};

/** Raw code as stored, trimmed; anything that is not a short digit string is Unknown. */
export function normalizePriority(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}
export function dispositionFor(priority: string | null): Disposition {
  if (priority === null) return "unknown";
  const meaning = confirmed(priority);
  if (meaning) return meaning.disposition;
  return /^\d{1,3}$/.test(priority) ? "unmapped" : "unknown";
}
export function priorityLabel(priority: string | null): string {
  if (priority === null) return "Not set";
  return confirmed(priority)?.label ?? (dispositionFor(priority) === "unmapped" ? "Unknown meaning" : "Unknown");
}
export const dispositionLabel = (d: Disposition) => DISPOSITION_LABELS[d];
export const basisLabel = (b: ProgressBasis | null) => (b ? BASIS_LABELS[b] : null);
export const isTerminal = (d: Disposition) => TERMINAL_DISPOSITIONS.includes(d);
export const CRM_CLOSURE_REASONS = ["granot_bad_unusable", "granot_dead_opportunity", "granot_booked"] as const;
export type CrmClosureReason = (typeof CRM_CLOSURE_REASONS)[number];
export function closureBasisFor(d: Disposition): CrmClosureReason | null {
  return d === "crm_bad_unusable" ? "granot_bad_unusable" : d === "crm_dead" ? "granot_dead_opportunity" : d === "crm_booked" ? "granot_booked" : null;
}

/** The accepted change that supplied the current Priority/Quoted values, when one exists. */
export type ProgressEvidence = {
  change_id: Types.ObjectId;
  applied_at: Date;
  source_system: SourceOrigin;
  observation_id?: Types.ObjectId | null;
  decision_id?: Types.ObjectId | null;
  fields: ReadonlyArray<{ path: string; before?: unknown; after?: unknown }>;
};
export type LeadProgressRow = {
  granot_priority: string | null;
  quoted: boolean | null;
  disposition: Disposition;
  work_observed: boolean;
  basis: ProgressBasis | null;
  provenance: Provenance;
  source_change_id: Types.ObjectId | null;
  source_origin: SourceOrigin | null;
  source_observation_id: Types.ObjectId | null;
  source_decision_id: Types.ObjectId | null;
  source_applied_at: Date | null;
  first_work_observed_at: Date | null;
  last_progress_at: Date | null;
  projected_at: Date;
  fingerprint: string;
  disposition_revision: string;
  override: { reason: string; instruction_id: Types.ObjectId; disposition_revision: string; decided_at: Date; decided_by: string } | null;
  reopen_review_id: Types.ObjectId | null;
};
export type LeadProgressLead = { granot_priority?: unknown; quoted?: unknown };

export const progressFingerprint = (row: Pick<LeadProgressRow, "granot_priority" | "quoted" | "disposition" | "work_observed" | "provenance">) =>
  payloadHash(jsonValue({ granot_priority: row.granot_priority, quoted: row.quoted, disposition: row.disposition, work_observed: row.work_observed, provenance: row.provenance }));
export const dispositionRevision = (priority: string | null) => payloadHash(jsonValue({ granot_priority: priority }));

/** Per-field vouching: the change must carry the judged field and its `after` must equal the current value. */
export function vouchesForPriority(evidence: ProgressEvidence, lead: LeadProgressLead): boolean {
  const field = evidence.fields.find(f => f.path === "granot_priority");
  return Boolean(field) && normalizePriority(field!.after) === normalizePriority(lead.granot_priority);
}
export function vouchesForQuoted(evidence: ProgressEvidence, lead: LeadProgressLead): boolean {
  const field = evidence.fields.find(f => f.path === "quoted");
  const quoted = typeof lead.quoted === "boolean" ? lead.quoted : null;
  return Boolean(field) && (typeof field!.after === "boolean" ? field!.after : null) === quoted;
}
/** The accepted changes that vouch for the current Priority and the current Quoted flag, judged separately: a creation change carrying `quoted:false` never vouches for a change-less Priority. */
export type ProgressEvidenceSet = { priority: ProgressEvidence | null; quoted: ProgressEvidence | null };
export function selectProgressEvidence(changes: readonly ProgressEvidence[], lead: LeadProgressLead): ProgressEvidenceSet {
  return { priority: changes.find(change => vouchesForPriority(change, lead)) ?? null, quoted: changes.find(change => vouchesForQuoted(change, lead)) ?? null };
}
/** One change vouches when it carries at least one judged field and agrees with the current value of every field it carries. */
export function evidenceMatchesCurrent(evidence: ProgressEvidence, lead: LeadProgressLead): boolean {
  const carriesPriority = evidence.fields.some(f => f.path === "granot_priority"), carriesQuoted = evidence.fields.some(f => f.path === "quoted");
  if (!carriesPriority && !carriesQuoted) return false;
  return (!carriesPriority || vouchesForPriority(evidence, lead)) && (!carriesQuoted || vouchesForQuoted(evidence, lead));
}

/**
 * Project the current canonical Lead into `lead_progress` (§3.2).
 *
 * `evidence` holds the accepted changes that vouch for the current Priority
 * and Quoted values, judged per field (§6: a value with no vouching change is
 * displayed with uncertain provenance and neither establishes work nor cancels
 * actions). Work evidence is recorded whatever the record's state; the caller
 * gates the state transition on eligibility. Earlier legitimate work is
 * preserved: a routine Priority change never erases `first_work_observed_at`,
 * and only an explicit correction that removes the sole work evidence turns
 * `work_observed` back off.
 */
export function projectLeadProgress(input: { lead: LeadProgressLead; prior: LeadProgressRow | null; evidence: ProgressEvidenceSet | null; now: Date }): LeadProgressRow {
  const { lead, prior, now } = input;
  const granot_priority = normalizePriority(lead.granot_priority);
  const quoted = typeof lead.quoted === "boolean" ? lead.quoted : null;
  const disposition = dispositionFor(granot_priority);
  const priorityEvidence = input.evidence?.priority && vouchesForPriority(input.evidence.priority, lead) ? input.evidence.priority : null;
  const quotedEvidence = input.evidence?.quoted && vouchesForQuoted(input.evidence.quoted, lead) ? input.evidence.quoted : null;
  // Provenance follows the evidence that decides the current outcome: a terminal or work-establishing
  // Priority needs its own vouching change; accepted Quoted evidence vouches for work under any
  // nonterminal code, including a legacy `0`/`5` that never received a change of its own (F-13).
  const quotedVouched = quoted === true && quotedEvidence !== null && !isTerminal(disposition);
  const provenance: Provenance = priorityEvidence || quotedVouched ? "accepted" : granot_priority !== null || quoted === true ? "uncertain" : "none";
  const quotedField = quotedEvidence?.fields.find(f => f.path === "quoted");
  const quotedRetracted = Boolean(quotedField && quotedField.before === true && quoted !== true);
  let basis: ProgressBasis | null = null;
  if (quoted === true) basis = quotedEvidence ? "quoted" : "historical_snapshot";
  else if (WORK_DISPOSITIONS.includes(disposition) && priorityEvidence) {
    const before = normalizePriority(priorityEvidence.fields.find(f => f.path === "granot_priority")?.before);
    basis = before === null ? "priority_assigned" : "priority_changed";
  }
  const freshEvidence = basis !== null && !isTerminal(disposition);
  // Earlier work survives a routine change; an explicit correction that removes the only evidence does not.
  const retainedPrior = Boolean(prior?.work_observed) && !(quotedRetracted && prior?.basis !== null && ["quoted", "historical_snapshot"].includes(prior!.basis!) && !WORK_DISPOSITIONS.includes(disposition));
  const work_observed = freshEvidence || retainedPrior;
  const effectiveBasis = freshEvidence ? basis : work_observed ? prior?.basis ?? null : basis;
  const disposition_revision = dispositionRevision(granot_priority);
  const draft = { granot_priority, quoted, disposition, work_observed, provenance };
  const fingerprint = progressFingerprint(draft);
  const changed = prior?.fingerprint !== fingerprint;
  // The change that decides the current disposition supplies the source references and the known time.
  const source = granot_priority !== null ? priorityEvidence : quotedEvidence;
  const knownTime = source?.applied_at ?? null;
  const last_progress_at = changed ? (knownTime ?? (prior && prior.fingerprint ? prior.last_progress_at ?? null : null)) : prior?.last_progress_at ?? null;
  const workTime = basis === "quoted" ? quotedEvidence?.applied_at ?? null : basis === "historical_snapshot" ? null : priorityEvidence?.applied_at ?? null;
  const first_work_observed_at = prior?.first_work_observed_at ?? (work_observed ? workTime : null);
  return {
    ...draft, basis: effectiveBasis,
    source_change_id: source ? source.change_id : prior && !changed ? prior.source_change_id : null,
    source_origin: source ? source.source_system : prior && !changed ? prior.source_origin : null,
    source_observation_id: source ? source.observation_id ?? null : prior && !changed ? prior.source_observation_id : null,
    source_decision_id: source ? source.decision_id ?? null : prior && !changed ? prior.source_decision_id : null,
    source_applied_at: source ? source.applied_at : prior && !changed ? prior.source_applied_at : null,
    first_work_observed_at, last_progress_at, projected_at: now, fingerprint, disposition_revision,
    // A revision-scoped override survives identical redelivery and expires on a semantic disposition change.
    override: prior?.override && prior.override.disposition_revision === disposition_revision ? prior.override : null,
    reopen_review_id: prior?.reopen_review_id ?? null,
  };
}

/** Owner-facing one-liner for a record that is Open because of Lead progress. */
export function progressExplanation(row: Pick<LeadProgressRow, "work_observed" | "basis" | "source_origin">): string | null {
  if (!row.work_observed) return null;
  if (row.basis === "quoted" || row.basis === "historical_snapshot") return "Quoted · No next step set";
  return row.source_origin === "granot" ? "Lead updated in Granot · No next step set" : "Lead updated · No next step set";
}
