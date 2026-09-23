import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { LanguageModel } from "ai" with { "resolution-mode": "import" };
import { withTransaction } from "../../../db";
import { CSI_BACKFILL_JOB_PRIORITY, CSI_EXTRACTION_MODELS } from "../../../config/domain/salesIntelligence";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../../../models/SalesIntelligenceAiReservation";
import { isObjectIdString, toObjectId } from "../../../utils/objectId";
import { CsiError } from "../auth";
import type { StepPricing } from "../analysis/structuredGeneration";
import {
  assessmentStepContract, MOVE_ASSESSMENT_PROMPT, sourceManifestEntrySchema, type SourceManifestEntry,
} from "./contract";
import { assembleAssessmentContext, type AssessmentContext, type AssessmentSkip } from "./context";
import { mongoAssessmentReader, selectConversationSources, type AssessmentReader } from "./sources";
import {
  nominateMoveAssessmentNow, publishAssessmentProjection, runMoveAssessmentJob,
  type MoveAssessmentDeps, type MoveAssessmentOutcome,
} from "./runtime";
import { DEFAULT_ASSESSMENT_NOMINAL_CENTS } from "./generate";

/**
 * Assessment-only backfill (MA-01 §9, specification §9). The only model operation is the
 * Move assessment step, run in-process through `runMoveAssessmentJob` with the operator's
 * injected personal gateway key. Everything else here is deterministic: a read-only
 * inventory, a frozen and resumable manifest, persistent caps, reservation accounting and
 * zero-call promotion of accepted shadow artifacts. Manifests hold identifiers and
 * operational counts only, never customer narrative or key values.
 */
export const BACKFILL_MANIFEST_VERSION = "csi-move-assessment-backfill-v1";
export const BACKFILL_CREDENTIAL = "PERSONAL_AI_GATEWAY_API_KEY" as const;
export const CANARY_SIZE = 5;
/** Inventory estimate assumptions (stated in the report). */
export const BYTES_PER_TOKEN = 4;
export const ASSUMED_OUTPUT_TOKENS = 2_500;
export const REPAIR_MARGIN = 1.5;
export const P95_MIN_SAMPLES = 5;
/** A retry backoff longer than this leaves the row for `--resume` instead of sleeping. */
export const MAX_RETRY_WAIT_MS = 120_000;

export const SUMMARY_KINDS = ["structured", "legacy", "conversation_summary"] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];
const SUMMARY_KIND_BY_SOURCE: Partial<Record<SourceManifestEntry["kind"], SummaryKind>> = {
  summary_artifact: "structured", legacy_run: "legacy", conversation_summary: "conversation_summary",
};
export const summaryKindOf = (kind: SourceManifestEntry["kind"]) => SUMMARY_KIND_BY_SOURCE[kind] ?? null;

// ── Manifest (strict) ───────────────────────────────────────────────────────
const id = z.string().regex(/^[a-f\d]{24}$/i);
const cents = z.number().int().min(0);
export const ROW_STATUSES = ["planned", "running", "completed", "published", "skipped", "stale_input", "paused", "failed", "deferred"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];
export const BACKFILL_MODES = ["shadow", "apply", "promote"] as const;
export type BackfillMode = (typeof BACKFILL_MODES)[number];
export const COHORTS = ["summary", "lead_only"] as const;
export type Cohort = (typeof COHORTS)[number];

export const backfillRowSchema = z.object({
  subject_key: z.string().min(1),
  outreach_record_id: id,
  lead_model: z.enum(["FormLead", "CallLead"]).nullable(),
  summary_kinds: z.array(z.enum(SUMMARY_KINDS)),
  stratum: z.string().min(1),
  canary: z.boolean(),
  selected_sources: z.array(sourceManifestEntrySchema),
  fingerprint: z.string().min(1),
  estimated_input_bytes: cents,
  estimated_cents: cents,
  status: z.enum(ROW_STATUSES),
  reason: z.string().optional(),
  /** Shadow artifact generated for this row (awaiting promotion). */
  shadow_artifact_id: id.optional(),
  /** Non-shadow artifact whose projection this row published (apply or promotion). */
  artifact_id: id.optional(),
  jobs: z.object({ shadow: id.optional(), apply: id.optional() }).strict(),
  admitted: z.boolean(),
  attempts: cents,
  provider_calls: cents,
  /** Cents charged against `max_total_cents` for this row (monotonic). */
  cents_reserved: cents,
  /** Current in-flight hold; zero when no attempt is running. */
  hold_cents: cents,
  cents_actual: cents,
  usage_complete: z.boolean(),
  input_tokens: cents,
  output_tokens: cents,
  /** Reservation ids already charged, so a resume never charges one twice. */
  reservations: z.array(z.string()),
  last_error: z.string().optional(),
  updated_at: z.string().datetime(),
}).strict();
export type BackfillRow = z.infer<typeof backfillRowSchema>;

export const backfillCapsSchema = z.object({
  max_subjects: z.number().int().min(1),
  max_total_cents: cents,
  max_attempts_per_subject: z.number().int().min(1).max(10),
  concurrency: z.number().int().min(1).max(4),
}).strict();
export type BackfillCaps = z.infer<typeof backfillCapsSchema>;

export const COUNTER_KEYS = ["subjects_admitted", "attempts_total", "provider_calls", "cents_reserved", "cents_actual", "cents_incomplete",
  "incomplete_attempts", "retries", "promoted", "input_tokens", "output_tokens"] as const;
export type BackfillCounters = Record<(typeof COUNTER_KEYS)[number], number>;
const countersSchema = z.object(Object.fromEntries(COUNTER_KEYS.map(key => [key, cents])) as Record<(typeof COUNTER_KEYS)[number], typeof cents>).strict();

const contractSchema = z.object({ prompt_version: z.string(), prompt_digest: z.string(), schema_digest: z.string(),
  rubric_version: z.string(), schema_version: z.string() }).strict();

export const backfillManifestSchema = z.object({
  version: z.literal(BACKFILL_MANIFEST_VERSION),
  manifest_id: z.string().regex(/^mabf-[a-z0-9-]+$/),
  cohort: z.enum(COHORTS),
  cutoff: z.string().datetime(),
  dataset: z.object({ deployment: z.string(), database: z.string() }).strict(),
  contract: contractSchema,
  model: z.enum(CSI_EXTRACTION_MODELS),
  credential: z.literal(BACKFILL_CREDENTIAL),
  caps: backfillCapsSchema,
  cap_changes: z.array(z.object({ at: z.string().datetime(), field: z.enum(["max_total_cents", "max_attempts_per_subject", "concurrency"]),
    from: cents, to: cents }).strict()),
  /** Mode history: every run appends one entry. */
  runs: z.array(z.object({ mode: z.enum(BACKFILL_MODES), started_at: z.string().datetime(), finished_at: z.string().datetime().nullable(),
    halted: z.string().nullable() }).strict()),
  selection: z.object({ rule: z.string(), candidates: cents, selected: cents, canary: z.array(z.string()),
    deferred: z.array(z.object({ subject_key: z.string(), stratum: z.string() }).strict()), subject_filter: z.array(z.string()).nullable() }).strict(),
  estimate: z.object({ basis: z.enum(["trailing_p95", "list_pricing", "default_nominal"]), assumption: z.string(),
    hold_floor_cents: cents }).strict(),
  counters: countersSchema,
  halt: z.object({ reason: z.string(), at: z.string().datetime() }).strict().nullable(),
  rows: z.array(backfillRowSchema),
}).strict();
export type BackfillManifest = z.infer<typeof backfillManifestSchema>;

export function zeroCounters(): BackfillCounters {
  return Object.fromEntries(COUNTER_KEYS.map(key => [key, 0])) as BackfillCounters;
}

/** Counters never decrease, whatever happens between two checkpoints (resume, retry, changed inputs). */
export function assertCountersMonotonic(before: BackfillCounters, after: BackfillCounters) {
  for (const key of COUNTER_KEYS) if (after[key] < before[key]) throw new CsiError("REVISION_CONFLICT", [{ path: `counters.${key}`, code: "counter_decreased" }]);
}

// ── Candidates, cohort selection ───────────────────────────────────────────
export type BackfillCandidate = {
  subject_key: string; outreach_record_id: string; lead_model: "FormLead" | "CallLead" | null; cohort: Cohort;
  summary_kinds: SummaryKind[]; selected_sources: SourceManifestEntry[]; fingerprint: string;
  estimated_input_bytes: number; estimated_cents: number;
};

/** Stratum = Lead model × preferred summary kind (structured > legacy > conversation summary), or `lead_only`. */
export function stratumOf(candidate: Pick<BackfillCandidate, "lead_model" | "summary_kinds">) {
  const kind = SUMMARY_KINDS.find(k => candidate.summary_kinds.includes(k)) ?? "lead_only";
  return `${candidate.lead_model ?? "no_lead"}:${kind}`;
}
export const COHORT_SELECTION_RULE = "sort by subject_key; group by lead_model x preferred summary kind; round-robin across strata in stratum-name order; first max_subjects selected; first 5 of that order are the shadow canary; the rest are deferred";

/**
 * Deterministic: the same candidates and caps always give the same selection, canary and
 * deferred list, independent of input order.
 */
export function selectCohort(candidates: readonly BackfillCandidate[], caps: Pick<BackfillCaps, "max_subjects">) {
  const sorted = [...new Map(candidates.map(c => [c.subject_key, c])).values()].sort((a, b) => a.subject_key.localeCompare(b.subject_key));
  const strata = new Map<string, BackfillCandidate[]>();
  for (const candidate of sorted) {
    const key = stratumOf(candidate);
    strata.set(key, [...(strata.get(key) ?? []), candidate]);
  }
  const groups = [...strata.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows);
  const ordered: BackfillCandidate[] = [];
  for (let index = 0; ordered.length < sorted.length; index++) for (const group of groups) if (group[index]) ordered.push(group[index]);
  const selected = ordered.slice(0, caps.max_subjects);
  return {
    ordered, selected,
    canary: selected.slice(0, CANARY_SIZE).map(c => c.subject_key),
    deferred: ordered.slice(caps.max_subjects).map(c => ({ subject_key: c.subject_key, stratum: stratumOf(c) })),
  };
}

export function createManifest(input: {
  manifest_id: string; cohort: Cohort; cutoff: Date; dataset: { deployment: string; database: string }; model: string;
  caps: BackfillCaps; candidates: readonly BackfillCandidate[]; subject_filter: string[] | null;
  estimate: BackfillManifest["estimate"]; now?: Date;
}): BackfillManifest {
  const now = (input.now ?? new Date()).toISOString();
  const cohort = input.candidates.filter(c => c.cohort === input.cohort);
  const selection = selectCohort(cohort, input.caps);
  const canary = new Set(selection.canary);
  return backfillManifestSchema.parse({
    version: BACKFILL_MANIFEST_VERSION, manifest_id: input.manifest_id, cohort: input.cohort, cutoff: input.cutoff.toISOString(),
    dataset: input.dataset, contract: assessmentStepContract(), model: input.model, credential: BACKFILL_CREDENTIAL,
    caps: input.caps, cap_changes: [], runs: [],
    selection: { rule: COHORT_SELECTION_RULE, candidates: cohort.length, selected: selection.selected.length, canary: selection.canary,
      deferred: selection.deferred, subject_filter: input.subject_filter },
    estimate: input.estimate, counters: zeroCounters(), halt: null,
    rows: selection.selected.map(c => ({
      subject_key: c.subject_key, outreach_record_id: c.outreach_record_id, lead_model: c.lead_model, summary_kinds: c.summary_kinds,
      stratum: stratumOf(c), canary: canary.has(c.subject_key), selected_sources: c.selected_sources, fingerprint: c.fingerprint,
      estimated_input_bytes: c.estimated_input_bytes, estimated_cents: c.estimated_cents, status: "planned", jobs: {},
      admitted: false, attempts: 0, provider_calls: 0, cents_reserved: 0, hold_cents: 0, cents_actual: 0, usage_complete: true,
      input_tokens: 0, output_tokens: 0, reservations: [], updated_at: now,
    })),
  });
}

/**
 * Resume with explicit caps. `max_subjects` is frozen with the cohort (expansion is a new
 * bounded run); the monetary, attempt and concurrency caps may change explicitly and every
 * change is recorded. Counters are never touched.
 */
export function applyCapChanges(manifest: BackfillManifest, caps: BackfillCaps, now = new Date()) {
  if (caps.max_subjects !== manifest.caps.max_subjects) throw new CsiError("INVALID_INPUT", [{ path: "caps.max_subjects", code: "frozen_with_cohort" }]);
  for (const field of ["max_total_cents", "max_attempts_per_subject", "concurrency"] as const) {
    if (caps[field] === manifest.caps[field]) continue;
    manifest.cap_changes.push({ at: now.toISOString(), field, from: manifest.caps[field], to: caps[field] });
    manifest.caps[field] = caps[field];
  }
  return manifest;
}

// ── Admission, reservation, reconciliation ─────────────────────────────────
export type AdmissionRefusal = "max_subjects" | "max_total_cents" | "max_attempts_per_subject";
export const inFlightCents = (manifest: BackfillManifest) => manifest.rows.reduce((sum, row) => sum + row.hold_cents, 0);

/** Pure gate. The committed total includes every concurrent in-flight hold. */
export function admit(manifest: BackfillManifest, row: BackfillRow, estimate: number): { ok: true } | { ok: false; reason: AdmissionRefusal } {
  if (row.attempts >= manifest.caps.max_attempts_per_subject) return { ok: false, reason: "max_attempts_per_subject" };
  if (!row.admitted && manifest.counters.subjects_admitted >= manifest.caps.max_subjects) return { ok: false, reason: "max_subjects" };
  if (manifest.counters.cents_reserved + inFlightCents(manifest) + estimate > manifest.caps.max_total_cents) return { ok: false, reason: "max_total_cents" };
  return { ok: true };
}

/** Synchronous with `admit` (no await between them), so concurrent workers cannot both pass the gate. */
export function reserveAttempt(manifest: BackfillManifest, row: BackfillRow, estimate: number, now = new Date()) {
  const gate = admit(manifest, row, estimate);
  if (!gate.ok) return gate;
  if (!row.admitted) { row.admitted = true; manifest.counters.subjects_admitted++; }
  if (row.attempts > 0) manifest.counters.retries++;
  row.attempts++; manifest.counters.attempts_total++;
  row.hold_cents = estimate; row.status = "running"; row.updated_at = now.toISOString();
  delete row.reason; delete row.last_error;
  return gate;
}

export type ReservationSummary = {
  reservation_id: string; step: string; status: "reserved" | "reconciled" | "released"; usage_complete: boolean;
  actual_cents: number | null; observed_cents: number; input_tokens: number; output_tokens: number;
};

/**
 * Converts the attempt's hold into charges. A complete reconciled reservation charges its
 * actual cents; an incomplete or still-open one stays reserved at max(observed, hold).
 * Returns false when a reservation was not made with the personal credential.
 */
export function reconcileAttempt(manifest: BackfillManifest, row: BackfillRow, reservations: readonly ReservationSummary[], now = new Date()) {
  let credentialOk = true;
  for (const reservation of reservations) {
    if (row.reservations.includes(reservation.reservation_id)) continue;
    if (!reservation.step.includes(`:${BACKFILL_CREDENTIAL}:`)) credentialOk = false;
    const settled = reservation.status !== "reserved";
    const complete = settled && reservation.usage_complete;
    const actual = Math.max(0, Math.ceil(reservation.actual_cents ?? reservation.observed_cents ?? 0));
    const charge = complete ? actual : Math.max(actual, row.hold_cents);
    manifest.counters.cents_reserved += charge; row.cents_reserved += charge;
    manifest.counters.cents_actual += actual; row.cents_actual += actual;
    manifest.counters.input_tokens += reservation.input_tokens; row.input_tokens += reservation.input_tokens;
    manifest.counters.output_tokens += reservation.output_tokens; row.output_tokens += reservation.output_tokens;
    if (!complete) { manifest.counters.cents_incomplete += charge; manifest.counters.incomplete_attempts++; row.usage_complete = false; }
    row.reservations.push(reservation.reservation_id);
  }
  row.hold_cents = 0; row.updated_at = now.toISOString();
  return credentialOk;
}

/** Row status for a runtime outcome (or a completed job's stored result). */
export function rowUpdateFor(mode: "shadow" | "apply", outcome: { status: string; reason?: string; artifact_id?: string }): Pick<BackfillRow, "status"> & { reason?: string } {
  const reason = outcome.reason ?? outcome.status;
  switch (outcome.status) {
    case "shadow_completed": return { status: "completed" };
    case "reused": return mode === "shadow" ? { status: "completed", reason: "reused" }
      : /(published|current)$/.test(reason) ? { status: "published", reason: "reused" } : /stale_input$/.test(reason) ? { status: "stale_input", reason: "input_changed" }
        : { status: "skipped", reason };
    case "completed": return mode === "shadow" ? { status: "completed" }
      : reason === "published" || reason === "current" ? { status: "published" } : { status: "skipped", reason };
    case "stale_input": return { status: "stale_input", reason: "input_changed" };
    case "skipped": return { status: "skipped", reason };
    case "paused": return { status: "paused", reason };
    default: return { status: "failed", reason };
  }
}

/** A completed job's stored `{ reason, artifact_id }` → the outcome the runtime returned. */
export function outcomeFromJobResult(mode: "shadow" | "apply", result: unknown): MoveAssessmentOutcome {
  const value = (result && typeof result === "object" ? result : {}) as { reason?: string; artifact_id?: string };
  const reason = value.reason ?? "completed", artifact = value.artifact_id ? { artifact_id: value.artifact_id } : {};
  if (["not_applicable", "ambiguous_subject", "excluded", "skipped_no_summary", "evidence_limit_reached", "purged"].includes(reason)) return { status: "skipped", reason, ...artifact };
  if (reason.startsWith("reused")) return { status: "reused", reason, ...artifact };
  if (mode === "shadow") return { status: "shadow_completed", ...artifact };
  if (reason === "stale_input") return { status: "stale_input", reason, ...artifact };
  return { status: "completed", reason, ...artifact };
}

// ── Promotion ───────────────────────────────────────────────────────────────
type ContractDigests = z.infer<typeof contractSchema>;
export type PromotionArtifact = {
  status: string; shadow: boolean; input_fingerprint: string; purged_at?: Date | null;
  prompt_digest: string; schema_digest: string; schema_version: string; rubric_version: string;
};
const sameContract = (a: ContractDigests, b: Pick<ContractDigests, "prompt_digest" | "schema_digest" | "schema_version" | "rubric_version">) =>
  a.prompt_digest === b.prompt_digest && a.schema_digest === b.schema_digest && a.schema_version === b.schema_version && a.rubric_version === b.rubric_version;

/** Pure: publish an accepted shadow artifact only when contract digests and the current fingerprint still match. */
export function promotionDecision(input: {
  manifest_contract: ContractDigests; current_contract: ContractDigests; artifact: PromotionArtifact | null;
  row_fingerprint: string; fresh: { fingerprint: string } | { skip: string };
}): { action: "promote" } | { action: "stale_input" | "skip"; reason: string } {
  const { artifact, fresh } = input;
  if (!artifact || !artifact.shadow) return { action: "skip", reason: "shadow_artifact_missing" };
  if (artifact.purged_at || artifact.status === "purged") return { action: "skip", reason: "purged" };
  if (!["ready", "insufficient_evidence"].includes(artifact.status)) return { action: "skip", reason: `artifact_${artifact.status}` };
  if (!sameContract(input.manifest_contract, input.current_contract) || !sameContract(input.current_contract, artifact)) return { action: "stale_input", reason: "contract_changed" };
  if ("skip" in fresh) return { action: "skip", reason: fresh.skip };
  if (fresh.fingerprint !== input.row_fingerprint || fresh.fingerprint !== artifact.input_fingerprint) return { action: "stale_input", reason: "input_changed" };
  return { action: "promote" };
}

class PromotionAbort extends Error { constructor(readonly decision: string) { super(decision); } }

/**
 * Zero model calls. Copies the accepted shadow body into the non-shadow artifact of the same
 * key (reads never show shadow rows) and publishes it through the runtime's fenced
 * `publishAssessmentProjection`, all in one transaction: anything but a publication rolls
 * the copy back.
 */
export async function promoteShadowArtifact(shadowArtifactId: string, now = new Date()): Promise<{ decision: string; artifact_id: string | null }> {
  const Artifacts = getMoveAssessmentArtifactModel();
  try {
    return await withTransaction(async session => {
      const shadow = await Artifacts.findById(shadowArtifactId).session(session).lean();
      if (!shadow?.shadow) throw new PromotionAbort("shadow_artifact_missing");
      const key = { deployment: shadow.deployment, database: shadow.database, subject_key: shadow.subject_key,
        input_fingerprint: shadow.input_fingerprint, schema_version: shadow.schema_version, shadow: false };
      type Publishable = Parameters<typeof publishAssessmentProjection>[0];
      let target = await Artifacts.findOne(key).session(session).lean() as Publishable | null;
      if (target && !["ready", "insufficient_evidence"].includes(target.status)) throw new PromotionAbort(`existing_${target.status}`);
      if (!target) {
        const usage = shadow.usage ? { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_input_tokens: null, actual_cents: 0,
          usage_complete: true, attempts: 0, credential: shadow.usage.credential ?? null } : null;
        const [created] = await Artifacts.create([{ ...key, outreach_record_id: shadow.outreach_record_id, contact_number_id: shadow.contact_number_id,
          lead_ref: shadow.lead_ref ?? null, rubric_version: shadow.rubric_version, prompt_version: shadow.prompt_version,
          prompt_digest: shadow.prompt_digest, schema_digest: shadow.schema_digest, model_version: shadow.model_version,
          input_mode: shadow.input_mode, source_manifest: shadow.source_manifest, context_as_of: shadow.context_as_of,
          latest_conversation_at: shadow.latest_conversation_at, status: shadow.status, scores: shadow.scores, views: shadow.views,
          inventory: shadow.inventory, conflicts: shadow.conflicts, engagement: shadow.engagement ?? null, coverage: shadow.coverage, model_output: shadow.model_output,
          usage, generated_at: shadow.generated_at, job_id: null, lease_epoch: 0, promoted_from: shadow._id }], { session });
        target = created.toObject() as unknown as Publishable;
      }
      const decision = await publishAssessmentProjection(target, { outreach_record_id: String(shadow.outreach_record_id) }, session, now);
      if (decision !== "published" && decision !== "current") throw new PromotionAbort(decision);
      return { decision, artifact_id: String(target._id) };
    });
  } catch (error) {
    if (error instanceof PromotionAbort) return { decision: error.decision, artifact_id: null };
    throw error;
  }
}

// ── Inventory (read-only) ───────────────────────────────────────────────────
export type Estimate = { basis: BackfillManifest["estimate"]["basis"]; p95_cents: number | null; samples: number };

/** Trailing-30-day p95 of complete reconciled assessment reservations for this model. Read-only. */
export async function trailingAssessmentP95(modelId: string, now = new Date()): Promise<{ p95_cents: number | null; samples: number }> {
  const rows = await getSalesIntelligenceAiReservationModel().find({ stage: "analysis", step: { $regex: "^assessment:" }, model_version: modelId,
    status: "reconciled", usage_complete: true, reconciled_at: { $gte: new Date(now.getTime() - 30 * 86400_000) } })
    .select("actual_cents").sort({ actual_cents: 1 }).lean();
  if (!rows.length) return { p95_cents: null, samples: 0 };
  return { p95_cents: Math.max(1, rows[Math.ceil(rows.length * 0.95) - 1].actual_cents ?? 0), samples: rows.length };
}

export const ESTIMATE_ASSUMPTION = `input tokens ~= (prompt_payload bytes + system prompt bytes) / ${BYTES_PER_TOKEN}; output tokens assumed ${ASSUMED_OUTPUT_TOKENS}; x${REPAIR_MARGIN} repair margin; list pricing from SALES_INTELLIGENCE_ANALYSIS_*_CENTS_PER_MILLION; trailing p95 used instead when it has >= ${P95_MIN_SAMPLES} samples`;
const SYSTEM_PROMPT_BYTES = Buffer.byteLength(MOVE_ASSESSMENT_PROMPT, "utf8");

/** Pure per-attempt estimate (whole cents, at least 1). */
export function estimateAttemptCents(input: { input_bytes: number; pricing: StepPricing | null; p95_cents: number | null; samples: number }) {
  if (input.p95_cents !== null && input.samples >= P95_MIN_SAMPLES) return { cents: Math.max(1, Math.ceil(input.p95_cents)), basis: "trailing_p95" as const };
  if (!input.pricing) return { cents: DEFAULT_ASSESSMENT_NOMINAL_CENTS, basis: "default_nominal" as const };
  const inputTokens = Math.ceil((input.input_bytes + SYSTEM_PROMPT_BYTES) / BYTES_PER_TOKEN);
  const raw = (inputTokens * input.pricing.input_cents_per_million + ASSUMED_OUTPUT_TOKENS * input.pricing.output_cents_per_million) / 1_000_000;
  return { cents: Math.max(1, Math.ceil(raw * REPAIR_MARGIN)), basis: "list_pricing" as const };
}
export const estimatedInputTokens = (bytes: number) => Math.ceil((bytes + SYSTEM_PROMPT_BYTES) / BYTES_PER_TOKEN);

export type InventoryReport = {
  cutoff: string; scanned: number;
  outcomes: Record<string, number>;
  summary_kinds: Record<SummaryKind, number>;
  strata: Record<string, number>;
  missing_original_evidence: { form_leads: number; missing: number; by_label: Record<string, number> };
  ambiguous_identities: number;
  sources: { conversations: number; retained: number; purged: number; excluded: number; missing: number };
  findings_selected: number;
  estimate: { basis: Estimate["basis"]; p95_cents: number | null; samples: number; assumption: string;
    summary: { subjects: number; input_bytes: number; input_tokens: number; cents: number };
    lead_only: { subjects: number; input_bytes: number; input_tokens: number; cents: number } };
  candidates: BackfillCandidate[];
};

/** Per-subject memoized reader so the context and the source census share one read set. */
function memoReader(base: AssessmentReader): AssessmentReader {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) => (...args: A): Promise<R> => {
    const key = `${name}:${JSON.stringify(args)}`;
    // Mongoose queries are thenables that execute once per await: settle each into one real promise.
    if (!cache.has(key)) cache.set(key, Promise.resolve(fn(...args)));
    return cache.get(key) as Promise<R>;
  };
  return {
    conversations: memo("conversations", base.conversations), summaryArtifacts: memo("summaryArtifacts", base.summaryArtifacts),
    legacyRuns: memo("legacyRuns", base.legacyRuns), findings: memo("findings", base.findings), instructions: memo("instructions", base.instructions),
    record: memo("record", base.record), number: memo("number", base.number), attachments: memo("attachments", base.attachments), lead: memo("lead", base.lead),
  };
}

/**
 * Read-only scan of open Outreach subjects (not closed) created at or before the cutoff.
 * Eligibility, sources and fingerprints come from `assembleAssessmentContext` itself, so
 * the inventory and the paid run cannot disagree about what a subject would send.
 */
export async function inventoryCandidates(options: {
  cutoff: Date; model: string; pricing: StepPricing | null; limit?: number; subject_keys?: readonly string[] | null;
  reader?: () => AssessmentReader; now?: Date;
}): Promise<InventoryReport> {
  const now = options.now ?? new Date();
  const trailing = await trailingAssessmentP95(options.model, now);
  const outcomes: Record<string, number> = {};
  const bump = (bag: Record<string, number>, key: string, by = 1) => { bag[key] = (bag[key] ?? 0) + by; };
  const report: InventoryReport = {
    cutoff: options.cutoff.toISOString(), scanned: 0, outcomes,
    summary_kinds: { structured: 0, legacy: 0, conversation_summary: 0 }, strata: {},
    missing_original_evidence: { form_leads: 0, missing: 0, by_label: {} }, ambiguous_identities: 0,
    sources: { conversations: 0, retained: 0, purged: 0, excluded: 0, missing: 0 }, findings_selected: 0,
    estimate: { basis: "list_pricing", p95_cents: trailing.p95_cents, samples: trailing.samples, assumption: ESTIMATE_ASSUMPTION,
      summary: { subjects: 0, input_bytes: 0, input_tokens: 0, cents: 0 }, lead_only: { subjects: 0, input_bytes: 0, input_tokens: 0, cents: 0 } },
    candidates: [],
  };
  const filter: Record<string, unknown> = { state: { $ne: "closed" }, createdAt: { $lte: options.cutoff } };
  const wanted = options.subject_keys?.length ? new Set(options.subject_keys) : null;
  const cursor = getOutreachRecordModel().find(filter).select("_id subject").sort({ _id: 1 }).lean().cursor();
  for await (const record of cursor) {
    if (options.limit && report.scanned >= options.limit) break;
    const subject = record.subject as { kind: string; model?: string; id?: unknown; contact_number_id?: unknown };
    const key = subject.kind === "lead" ? `lead:${subject.model}:${subject.id}` : `number:${subject.contact_number_id}`;
    if (wanted && !wanted.has(key)) continue;
    report.scanned++;
    const reader = memoReader(options.reader?.() ?? mongoAssessmentReader());
    let context: AssessmentContext | AssessmentSkip;
    try {
      context = await assembleAssessmentContext({ outreach_record_id: String(record._id), allow_lead_only: true, now: options.cutoff }, undefined, reader);
    } catch (error) {
      bump(outcomes, `error_${error instanceof CsiError ? error.code : "unknown"}`);
      continue;
    }
    if ("skip" in context) {
      bump(outcomes, context.skip);
      if (context.skip === "ambiguous_subject") report.ambiguous_identities++;
      continue;
    }
    // Source census for this Number (memoized reads; never writes, never fetches transcripts).
    if (context.contact_number_id) {
      const census = await selectConversationSources(context.contact_number_id, { reader });
      report.sources.conversations += census.conversations.length + census.skipped.length;
      report.sources.retained += census.conversations.length;
      for (const skipped of census.skipped) {
        if (skipped.reason === "content_purged") report.sources.purged++;
        else if (skipped.reason === "analysis_excluded") report.sources.excluded++;
        else report.sources.missing++;
      }
    }
    report.findings_selected += context.coverage.findings_selected;
    const summary_kinds = SUMMARY_KINDS.filter(kind => context.source_manifest.some(entry => summaryKindOf(entry.kind) === kind));
    for (const kind of summary_kinds) report.summary_kinds[kind] += context.source_manifest.filter(entry => summaryKindOf(entry.kind) === kind).length;
    if (context.lead_ref?.model === "FormLead") {
      report.missing_original_evidence.form_leads++;
      const label = context.views?.original_ingestion?.label ?? "absent";
      if (label !== "original_form_submission") { report.missing_original_evidence.missing++; bump(report.missing_original_evidence.by_label, label); }
    }
    const bytes = Buffer.byteLength(JSON.stringify(context.prompt_payload), "utf8");
    const estimate = estimateAttemptCents({ input_bytes: bytes, pricing: options.pricing, ...trailing });
    report.estimate.basis = estimate.basis;
    const cohort: Cohort = context.input_mode === "lead_only" ? "lead_only" : "summary";
    bump(outcomes, cohort === "summary" ? "eligible_summary" : "eligible_lead_only");
    const candidate: BackfillCandidate = { subject_key: context.subject_key, outreach_record_id: context.outreach_record_id,
      lead_model: context.lead_ref?.model ?? null, cohort, summary_kinds, selected_sources: context.source_manifest,
      fingerprint: context.fingerprint, estimated_input_bytes: bytes, estimated_cents: estimate.cents };
    bump(report.strata, `${cohort}:${stratumOf(candidate)}`);
    const line = report.estimate[cohort];
    line.subjects++; line.input_bytes += bytes; line.input_tokens += estimatedInputTokens(bytes); line.cents += estimate.cents;
    report.candidates.push(candidate);
  }
  return report;
}

/** The inventory without per-subject rows: counts only (for evidence files and stdout). */
export function inventorySummary(report: InventoryReport) {
  const { candidates, ...rest } = report;
  return { ...rest, candidates: candidates.length };
}

// ── Checkpointed manifest store ─────────────────────────────────────────────
export type ManifestStore = { manifest: BackfillManifest; checkpoint(): Promise<void> };
export function manifestStore(manifest: BackfillManifest, persist: (manifest: BackfillManifest) => Promise<void>): ManifestStore {
  let saved = { ...manifest.counters }, pending = Promise.resolve();
  return {
    manifest,
    checkpoint() {
      assertCountersMonotonic(saved, manifest.counters);
      const snapshot = backfillManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));
      saved = { ...snapshot.counters };
      pending = pending.then(() => persist(snapshot));
      return pending;
    },
  };
}

// ── Runner ──────────────────────────────────────────────────────────────────
export type BackfillRunOptions = {
  mode: "shadow" | "apply";
  /** Personal gateway key value; never stored or printed. */
  gateway_key: string;
  model_id: string;
  pricing?: StepPricing;
  /** Test seam: a mocked model; production builds the gateway model from `gateway_key`. */
  model?: LanguageModel;
  /** Per-attempt hold floor in cents (the frozen per-subject estimate is used when larger). */
  hold_cents?: number;
  /** Wait until a retrying job is due; false leaves the row for `--resume`. */
  waitForRetry?: (jobId: string, dueAt: Date) => Promise<boolean>;
  ledger?: MoveAssessmentDeps["ledger"];
  now?: () => Date;
};

const errorCode = (error: unknown) => error instanceof CsiError ? error.code : error instanceof Error ? error.name : "unknown_error";

async function defaultWaitForRetry(_jobId: string, dueAt: Date) {
  const wait = dueAt.getTime() - Date.now();
  if (wait > MAX_RETRY_WAIT_MS) return false;
  if (wait > 0) await sleep(wait + 250);
  return true;
}

async function reservationsForJob(jobId: string): Promise<ReservationSummary[]> {
  const rows = await getSalesIntelligenceAiReservationModel().find({ job_id: toObjectId(jobId), step: { $regex: "^assessment:" } })
    .select("reservation_id step status usage_complete actual_cents observed_cents input_tokens output_tokens").sort({ reserved_at: 1, _id: 1 }).lean();
  return rows.map(row => ({ reservation_id: row.reservation_id, step: row.step, status: row.status as ReservationSummary["status"],
    usage_complete: row.usage_complete !== false, actual_cents: row.actual_cents ?? null, observed_cents: row.observed_cents ?? 0,
    input_tokens: row.input_tokens ?? 0, output_tokens: row.output_tokens ?? 0 }));
}

/** Re-checks eligibility and the frozen fingerprint before any charge. */
async function freshContext(manifest: BackfillManifest, row: BackfillRow) {
  return assembleAssessmentContext({ outreach_record_id: row.outreach_record_id, allow_lead_only: manifest.cohort === "lead_only" });
}

function setRow(row: BackfillRow, update: Partial<BackfillRow>, now: Date) {
  if ("status" in update && !("reason" in update)) delete row.reason;
  Object.assign(row, update);
  if ("reason" in update && update.reason === undefined) delete row.reason;
  row.updated_at = now.toISOString();
}

/**
 * Promotes accepted shadow artifacts of `completed` rows. Zero model calls: nothing here
 * reaches `runMoveAssessmentJob` or a provider.
 */
export async function promoteRows(store: ManifestStore, now: () => Date = () => new Date()) {
  const { manifest } = store;
  const current = assessmentStepContract();
  const Artifacts = getMoveAssessmentArtifactModel();
  for (const row of manifest.rows) {
    if (row.status !== "completed" || !row.shadow_artifact_id) continue;
    const artifact = await Artifacts.findById(row.shadow_artifact_id).select("status shadow input_fingerprint purged_at prompt_digest schema_digest schema_version rubric_version").lean();
    const fresh = await freshContext(manifest, row).catch(error => ({ skip: errorCode(error) }));
    const decision = promotionDecision({ manifest_contract: manifest.contract, current_contract: current, row_fingerprint: row.fingerprint,
      artifact: artifact ? { ...artifact, shadow: Boolean(artifact.shadow) } : null, fresh: "skip" in fresh ? { skip: fresh.skip } : { fingerprint: fresh.fingerprint } });
    if (decision.action !== "promote") {
      setRow(row, { status: decision.action === "stale_input" ? "stale_input" : "skipped", reason: decision.reason }, now());
    } else {
      const published = await promoteShadowArtifact(row.shadow_artifact_id, now());
      if (published.artifact_id) {
        setRow(row, { status: "published", reason: "promoted", artifact_id: published.artifact_id }, now());
        manifest.counters.promoted++;
      } else setRow(row, { status: published.decision === "stale_input" ? "stale_input" : "skipped", reason: published.decision }, now());
    }
    await store.checkpoint();
  }
}

/**
 * Shadow: the canary rows only. Apply: every selected row; accepted shadow rows are promoted
 * first (zero calls), stale rows are re-frozen and generated again against the same caps.
 * Stops admitting after a failure, a pause or a cap; in-flight attempts finish.
 */
export async function runBackfill(store: ManifestStore, options: BackfillRunOptions) {
  const { manifest } = store;
  const clock = options.now ?? (() => new Date());
  if (!options.gateway_key.trim() && !options.model) throw new CsiError("FEATURE_DISABLED");
  if (options.model_id !== manifest.model) throw new CsiError("INVALID_INPUT", [{ path: "model", code: "differs_from_manifest" }]);
  const mode = options.mode;
  manifest.halt = null;
  manifest.runs.push({ mode, started_at: clock().toISOString(), finished_at: null, halted: null });
  let stopAdmitting: string | null = null;
  const stop = (reason: string) => { stopAdmitting ??= reason; };

  // Crash recovery: a row left `running` is charged conservatively from its reservations first.
  for (const row of manifest.rows) {
    if (row.status !== "running") continue;
    const reservations = (await Promise.all(Object.values(row.jobs).filter((v): v is string => Boolean(v)).map(reservationsForJob))).flat();
    if (!reconcileAttempt(manifest, row, reservations, clock())) stop("credential_violation");
    setRow(row, { status: "failed", reason: "interrupted" }, clock());
  }
  if (mode === "apply") {
    await promoteRows(store, clock);
    for (const row of manifest.rows) {
      if (row.status !== "stale_input") continue;
      const fresh = await freshContext(manifest, row).catch(() => null);
      if (!fresh || "skip" in fresh) continue;
      setRow(row, { status: "planned", reason: "refrozen", fingerprint: fresh.fingerprint, selected_sources: fresh.source_manifest,
        estimated_input_bytes: Buffer.byteLength(JSON.stringify(fresh.prompt_payload), "utf8") }, clock());
    }
  }
  await store.checkpoint();

  const runnable = new Set<RowStatus>(["planned", "failed", "paused"]);
  const queue = manifest.rows.filter(row => (mode === "apply" || row.canary) && runnable.has(row.status));
  const Jobs = getSalesIntelligenceJobModel();

  const processRow = async (row: BackfillRow) => {
    for (;;) {
      const now = clock();
      // Existing job: take its durable state before any admission.
      let jobId = row.jobs[mode];
      if (jobId) {
        const job = await Jobs.findById(jobId).select("status reason result next_attempt_at leased_until").lean();
        if (job?.status === "completed") {
          const outcome = outcomeFromJobResult(mode, job.result);
          setRow(row, { ...rowUpdateFor(mode, outcome), ...artifactFields(mode, outcome) }, now);
          return store.checkpoint();
        }
        if (job?.status === "paused") {
          setRow(row, { status: "paused", reason: `job_paused:${job.reason ?? "unknown"}` }, now);
          stop(`paused:${job.reason ?? "unknown"}`);
          return store.checkpoint();
        }
        if (job?.status === "dead_letter") {
          setRow(row, { status: "failed", reason: "job_dead_letter" }, now);
          stop("failure");
          return store.checkpoint();
        }
        if (job?.status === "leased" && job.leased_until && job.leased_until > now) {
          setRow(row, { status: "failed", reason: "peer_leased" }, now);
          stop("failure");
          return store.checkpoint();
        }
        if (job && job.next_attempt_at > now && !(await (options.waitForRetry ?? defaultWaitForRetry)(jobId, job.next_attempt_at))) {
          setRow(row, { status: "failed", reason: "retry_backoff" }, now);
          return store.checkpoint();
        }
      }

      // Pre-check: skip known-ineligible or changed work before any charge.
      const fresh = await freshContext(manifest, row).catch(error => ({ skip: errorCode(error) }) as { skip: string });
      if ("skip" in fresh) { setRow(row, { status: "skipped", reason: fresh.skip }, clock()); return store.checkpoint(); }
      if (fresh.fingerprint !== row.fingerprint) { setRow(row, { status: "stale_input", reason: "input_changed" }, clock()); return store.checkpoint(); }

      if (!row.admitted && stopAdmitting) return;
      const estimate = Math.max(row.estimated_cents, options.hold_cents ?? 0, 1);
      const gate = reserveAttempt(manifest, row, estimate, clock());
      if (!gate.ok) {
        if (gate.reason === "max_attempts_per_subject") setRow(row, { status: "failed", reason: "max_attempts_per_subject" }, clock());
        else stop(gate.reason);
        return store.checkpoint();
      }
      await store.checkpoint();

      let outcome: MoveAssessmentOutcome, lastError: string | undefined;
      try {
        if (!jobId) {
          const nominated = await nominateMoveAssessmentNow({ outreach_record_id: row.outreach_record_id,
            trigger: `backfill:${manifest.manifest_id}:${mode}`, priority: CSI_BACKFILL_JOB_PRIORITY, force: true });
          if (!nominated) {
            row.hold_cents = 0;
            setRow(row, { status: "skipped", reason: "not_applicable" }, clock());
            return store.checkpoint();
          }
          jobId = nominated; row.jobs[mode] = nominated;
          await store.checkpoint();
        }
        outcome = await runMoveAssessmentJob(jobId, {
          gateway_key: options.gateway_key, credential: BACKFILL_CREDENTIAL, model: options.model, model_id: options.model_id,
          pricing: options.pricing, shadow: mode === "shadow", allow_lead_only: manifest.cohort === "lead_only", force: true,
          ledger: options.ledger, onError: error => { lastError = errorCode(error); },
          onProviderCall: () => { row.provider_calls++; manifest.counters.provider_calls++; },
        });
      } catch (error) {
        outcome = { status: "retry", reason: "runner_error" }; lastError = errorCode(error);
      }
      const credentialOk = reconcileAttempt(manifest, row, jobId ? await reservationsForJob(jobId) : [], clock());
      setRow(row, { ...rowUpdateFor(mode, outcome), ...artifactFields(mode, outcome), ...(lastError ? { last_error: lastError } : {}) }, clock());
      if (!credentialOk) { stop("credential_violation"); setRow(row, { status: "failed", reason: "credential_violation" }, clock()); }
      await store.checkpoint();
      if (row.status === "paused") { stop(`paused:${row.reason ?? "unknown"}`); return; }
      if (row.status !== "failed" || !credentialOk) return;
      stop("failure");
      if (outcome.status === "not_claimable" || outcome.status === "lease_lost" || outcome.status === "disabled") return;
      if (row.attempts >= manifest.caps.max_attempts_per_subject) { setRow(row, { reason: `${row.reason ?? "failed"}:max_attempts_per_subject` }, clock()); return store.checkpoint(); }
    }
  };

  let next = 0;
  await Promise.all(Array.from({ length: manifest.caps.concurrency }, async () => {
    while (next < queue.length) {
      const row = queue[next++];
      if (!row.admitted && stopAdmitting) continue;
      await processRow(row);
    }
  }));
  const run = manifest.runs.at(-1)!;
  run.finished_at = clock().toISOString();
  run.halted = stopAdmitting;
  manifest.halt = stopAdmitting ? { reason: stopAdmitting, at: clock().toISOString() } : null;
  await store.checkpoint();
  return manifest;
}

function artifactFields(mode: "shadow" | "apply", outcome: { artifact_id?: string }): Partial<BackfillRow> {
  if (!outcome.artifact_id || !isObjectIdString(outcome.artifact_id)) return {};
  return mode === "shadow" ? { shadow_artifact_id: outcome.artifact_id } : { artifact_id: outcome.artifact_id };
}

// ── Report ──────────────────────────────────────────────────────────────────
type ReportArtifact = { _id: unknown; shadow?: boolean | null; status: string; input_mode?: string | null; scores?: unknown; inventory?: unknown; conflicts?: unknown;
  engagement?: unknown; engagement_effects?: unknown };
type DimensionLike = { level?: string; score?: number | null; confidence?: string };

/** Counts only: outcomes, coverage, distributions, usage and the reimbursement lines. No narrative. */
export function backfillReport(manifest: BackfillManifest, artifacts: readonly ReportArtifact[]) {
  const count = (values: Array<string | null | undefined>) => values.reduce<Record<string, number>>((bag, value) => {
    const key = value ?? "null"; bag[key] = (bag[key] ?? 0) + 1; return bag;
  }, {});
  const scores = artifacts.map(a => (a.scores ?? {}) as { move_likelihood?: DimensionLike; transaction_intent?: DimensionLike });
  const dimension = (key: "move_likelihood" | "transaction_intent") => ({
    score: count(scores.map(s => s[key]?.score === undefined || s[key]?.score === null ? "unknown" : String(s[key]!.score))),
    confidence: count(scores.map(s => s[key]?.confidence)),
  });
  const c = manifest.counters;
  const reimbursement = [
    `manifest: ${manifest.manifest_id} (cohort ${manifest.cohort})`,
    `model: ${manifest.model}`,
    `contract: ${manifest.contract.prompt_version} / ${manifest.contract.schema_version} / ${manifest.contract.rubric_version}`,
    `attempts: ${c.attempts_total} dispatches, ${c.provider_calls} provider calls`,
    `tokens: ${c.input_tokens} input, ${c.output_tokens} output`,
    `incomplete usage: ${c.incomplete_attempts} attempts, ${c.cents_incomplete} cents held`,
    `retries: ${c.retries}`,
    `actual cost: ${c.cents_actual} cents (charged against cap: ${c.cents_reserved} cents of ${manifest.caps.max_total_cents})`,
    `credential: ${manifest.credential}`,
    "charged to the operator's personal gateway key; the owner reimburses",
  ];
  return {
    manifest_id: manifest.manifest_id, cohort: manifest.cohort, model: manifest.model, caps: manifest.caps, halt: manifest.halt,
    outcomes: count(manifest.rows.map(r => r.status)),
    reasons: count(manifest.rows.filter(r => r.reason).map(r => `${r.status}:${r.reason}`)),
    summary_coverage: count(manifest.rows.map(r => r.summary_kinds.join("+") || "lead_only")),
    strata: count(manifest.rows.map(r => r.stratum)),
    scores: { move_likelihood: dimension("move_likelihood"), transaction_intent: dimension("transaction_intent") },
    artifact_status: count(artifacts.map(a => `${a.shadow ? "shadow" : "live"}:${a.status}`)),
    input_modes: count(artifacts.map(a => a.input_mode)),
    inventory_coverage: count(artifacts.map(a => (a.inventory as { coverage?: string } | null)?.coverage)),
    source_coverage: count(artifacts.map(a => (a.inventory as { source_coverage?: string } | null)?.source_coverage)),
    conflicts: artifacts.reduce((sum, a) => sum + (Array.isArray(a.conflicts) ? a.conflicts.length : 0), 0),
    engagement: engagementReport(artifacts),
    counters: c,
    deferred: manifest.selection.deferred.length,
    reimbursement,
  };
}

/** Work-state distribution and the deterministic effects the publication applied (counts only). */
export function engagementReport(artifacts: readonly ReportArtifact[]) {
  const bag: Record<string, number> = {};
  const bump = (key: string, by = 1) => { bag[key] = (bag[key] ?? 0) + by; };
  let promised = 0, steps = 0, created = 0, worked = 0, applied = 0;
  const skipped: Record<string, number> = {};
  for (const a of artifacts) {
    const e = (a.engagement ?? null) as { work_status?: string; promised_callbacks?: unknown[]; next_steps?: unknown[] } | null;
    if (e) { bump(e.work_status ?? "null"); promised += e.promised_callbacks?.length ?? 0; steps += e.next_steps?.length ?? 0; }
    const fx = (a.engagement_effects ?? null) as { applied?: boolean; mark_worked?: boolean; followup_ids?: unknown[]; skipped?: Array<{ reason?: string }> } | null;
    if (!fx) continue;
    if (fx.applied) applied++;
    if (fx.mark_worked) worked++;
    created += fx.followup_ids?.length ?? 0;
    for (const item of fx.skipped ?? []) skipped[item.reason ?? "unknown"] = (skipped[item.reason ?? "unknown"] ?? 0) + 1;
  }
  return { work_status: bag, promised_callbacks: promised, next_steps: steps, effects: { artifacts_applied: applied, followups_created: created, marked_worked: worked, skipped } };
}

export async function loadReportArtifacts(manifest: BackfillManifest) {
  const ids = [...new Set(manifest.rows.flatMap(r => [r.shadow_artifact_id, r.artifact_id]).filter((v): v is string => Boolean(v)))];
  if (!ids.length) return [];
  return getMoveAssessmentArtifactModel().find({ _id: { $in: ids.map(toObjectId) } })
    .select("shadow status input_mode scores inventory conflicts engagement engagement_effects").lean() as Promise<ReportArtifact[]>;
}
