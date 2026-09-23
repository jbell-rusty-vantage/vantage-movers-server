import { z } from "zod";
import { intelligenceEnvelopeSchema, intelligenceFindingSchema, type IntelligenceEnvelope, type IntelligenceEvidenceRef, type IntelligenceFinding } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { redactTranscript } from "../../conversations/redaction";
import { readContentSchema } from "../analysis/reads";
import { payloadHash } from "../transactions";
import { TERMINAL_DISPOSITIONS, type Disposition } from "../outreach/leadProgress";
import { LEVEL_SCORES, summaryMoveEvidenceSchema } from "./contract";
import {
  assessmentSectionSchema, assessmentVersionSchema, evidenceLocatorDtoSchema, evidenceRefDtoSchema, evidenceSectionSchema, fullOutputSchema,
  inventoryItemDtoSchema, moveViewDtoSchema, observationDtoSchema, outreachMoveAssessmentDtoSchema, runPresentationSchema, scoreDtoSchema,
  sourceManifestEntryDtoSchema, summaryFindingsSectionSchema, conflictDtoSchema, engagementDtoSchema, moveTableDtoSchema, STALE_REASONS, type EngagementDto,
  type FindingCategory, type MoveTableDto, type StaleReason, type WorkResult,
  ASSESSMENT_LEVEL_LABELS, type AssessmentLevel, type AssessmentApplicability, type AssessmentAvailability, type AssessmentSection, type AssessmentVersion, type EvidenceItemDto, type EvidenceRefDto,
  type EvidenceSection, type FullOutput, type FullOutputRef, type OutreachMoveAssessmentDto, type RunPresentation, type ScoreDto, type SummaryFindingsSection,
} from "./dto";

/**
 * MA-04 deterministic, version-specific read adapters (specification §8.3–8.4).
 *
 * Pure over already-loaded rows: no Mongo, no clock, no model. Stored JSON is
 * read leniently (unknown keys are dropped) and emitted through the strict
 * presentation DTOs; a stored shape this adapter does not understand makes
 * that one section `unsupported` instead of guessing. Nothing here invents a
 * score, a summary section, an inventory item or a citation.
 */
export const SUPPORTED_ASSESSMENT_SCHEMAS = ["move-assessment-v1"] as const;
export const STRUCTURED_ANALYSIS_PIPELINE = "csi-analysis-steps-v1";

type Json = z.infer<ReturnType<typeof z.json>>;
type Loose = Record<string, unknown>;
const rec = (value: unknown): Loose | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const iso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(+value) ? null : value.toISOString();
  if (typeof value === "string" && value) { const parsed = new Date(value); return Number.isNaN(+parsed) ? null : parsed.toISOString(); }
  return null;
};
const idOf = (value: unknown): string | null => (value == null ? null : String(value));
/** Keep only the keys a strict DTO object declares; missing keys stay missing so required fields still fail. */
function pick(schema: z.ZodObject, raw: unknown): unknown {
  const row = rec(raw);
  return row ? Object.fromEntries(Object.keys(schema.shape).filter(key => key in row).map(key => [key, row[key]])) : raw;
}
/** JSON-safe copy (Dates → ISO strings) of a stored Mixed value. */
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null)) as Json;
/** Every presented string that carries model or record text is redacted like the evidence catalog (`sources.ts`). */
const clean = (value: string | null | undefined): string | null => (typeof value === "string" && value.trim() ? redactTranscript(value.trim()).text : null);
const clip = (value: string, max = 300) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const joinPresent = (parts: ReadonlyArray<string | null | undefined>, separator: string): string | null => {
  const kept = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return kept.length ? kept.join(separator) : null;
};
const toDate = (value: unknown): Date | null => {
  const at = value instanceof Date ? value : typeof value === "string" && value ? new Date(value) : null;
  return at && !Number.isNaN(+at) ? at : null;
};

// ---------------------------------------------------------------- server time wording (America/New_York, `ET`)

const ET_ZONE = "America/New_York";
const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, weekday: "short", year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true });
const UTC_DAY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", year: "numeric", month: "short", day: "numeric" });
const UTC_MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long" });
const partsOf = (format: Intl.DateTimeFormat, at: Date) => Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]));
/** `Tue Sep 23, 10:00 AM ET` (or without the weekday). */
export function formatEtDateTime(value: unknown, options: { weekday?: boolean } = {}): string | null {
  const at = toDate(value);
  if (!at) return null;
  const p = partsOf(ET_PARTS, at);
  return `${options.weekday === false ? "" : `${p.weekday} `}${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} ET`;
}
/** `Oct 1` in America/New_York. */
export function formatEtDay(value: unknown): string | null {
  const at = toDate(value);
  if (!at) return null;
  const p = partsOf(ET_PARTS, at);
  return `${p.month} ${p.day}`;
}
/** YYYY-MM-DD of `at` in America/New_York: the calendar day flips at ET midnight, not UTC. */
export function easternDay(at: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Move-date rule (data spec §6.2): a YYYY-MM-DD calendar date strictly before today in America/New_York. */
export function moveDateHasPassed(moveDate: string | null | undefined, asOf: Date): boolean {
  return typeof moveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(moveDate) && moveDate < easternDay(asOf);
}
/** A calendar date (YYYY-MM-DD, no zone): `Oct 15, 2026`, `Fri Sep 11`, or `October 2026` for a month. */
export function calendarDay(day: string | null | undefined, options: { weekday?: boolean; month?: boolean } = {}): string | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(+at)) return null;
  if (options.month) return UTC_MONTH.format(at);
  const p = partsOf(UTC_DAY_PARTS, at);
  return options.weekday ? `${p.weekday} ${p.month} ${p.day}` : `${p.month} ${p.day}, ${p.year}`;
}
/** Whole-dollar amounts print without cents: `$4,200`, `$4,200.50`. */
export function formatCents(cents: number): string {
  const whole = Number.isInteger(cents / 100);
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
function formatAmount(value: number, currency: string | null): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return !currency || currency.toUpperCase() === "USD" || currency === "$" ? `$${text}` : `${text} ${currency}`;
}

// ---------------------------------------------------------------- applicability and the Outreach projection

export type ApplicabilityInput = {
  state: string;
  lead_progress?: { disposition?: string | null; provenance?: string | null; override?: unknown } | null;
};
/** Closed work (any origin) and an accepted, un-overridden terminal CRM disposition have no actionable sales score (§11). */
export function assessmentApplicability(record: ApplicabilityInput): AssessmentApplicability {
  if (record.state === "closed") return "closed";
  const progress = record.lead_progress;
  if (progress && TERMINAL_DISPOSITIONS.includes(progress.disposition as Disposition) && progress.provenance === "accepted" && !progress.override) return "not_applicable";
  return "active";
}

export type ProjectionRow = {
  artifact_id?: unknown; status: string; transaction_intent?: number | null; move_likelihood?: number | null;
  transaction_intent_confidence?: string | null; move_likelihood_confidence?: string | null;
  context_as_of?: Date | string | null; latest_conversation_at?: Date | string | null; stale?: boolean | null; stale_reason?: string | null;
  published_at?: Date | string | null;
};
const SCORED_STATUSES = new Set(["ready", "insufficient_evidence"]);
const confidenceOf = (value: unknown) => (value === "low" || value === "medium" || value === "high" ? value : null);

/**
 * Data spec §6.2 / RD2: staleness is derived on read, never written. `move_date_passed` (the Lead's move
 * date is before today in America/New_York at the read's `as_of`) wins; otherwise a stored `stale` flag is
 * kept but a stored reason outside the closed enum is ignored. Non-active work is never stale.
 */
export function derivedFreshness(applicability: AssessmentApplicability, projection: Pick<ProjectionRow, "stale" | "stale_reason"> | null | undefined,
  moveDatePassed = false): { stale: boolean; stale_reason: StaleReason | null } {
  if (applicability !== "active") return { stale: false, stale_reason: null };
  if (moveDatePassed) return { stale: true, stale_reason: "move_date_passed" };
  const stored = projection?.stale_reason;
  return { stale: Boolean(projection?.stale), stale_reason: projection?.stale && (STALE_REASONS as readonly string[]).includes(stored ?? "") ? stored as StaleReason : null };
}

/**
 * `outreach.move_assessment` for a record: applicability first, then the stored projection, then a
 * queued job (`pending`). Returns null for Not assessed so older rows and unassessed rows read alike.
 * `options.moveDatePassed` (S1 `facts.move_date_passed`) derives `stale_reason: "move_date_passed"`.
 */
const LEVEL_BY_SCORE = new Map(Object.entries(LEVEL_SCORES).flatMap(([level, value]) => value === null ? [] : [[value, level as AssessmentLevel] as const]));
/**
 * The contract level of a stored score. Only an actionable, scored status carries a level: a
 * scored status without a number is `unknown` (the model picked `unknown`); anything else is null.
 */
export function projectionLevel(score: number | null | undefined, actionable: boolean): AssessmentLevel | null {
  if (!actionable) return null;
  if (score == null) return "unknown";
  return LEVEL_BY_SCORE.get(score) ?? null;
}
export const levelLabel = (level: AssessmentLevel | null | undefined) => (level ? ASSESSMENT_LEVEL_LABELS[level] : null);

export function moveAssessmentProjectionDto(record: ApplicabilityInput & { move_assessment?: ProjectionRow | null }, pending = false,
  options: { moveDatePassed?: boolean } = {}): OutreachMoveAssessmentDto | null {
  const applicability = assessmentApplicability(record);
  const projection = record.move_assessment ?? null;
  if (!projection && applicability === "active" && !pending) return null;
  const actionable = applicability === "active" && Boolean(projection && SCORED_STATUSES.has(projection.status));
  const status: AssessmentAvailability = applicability !== "active" ? "not_applicable"
    : projection ? (projection.status as AssessmentAvailability) : "pending";
  // A pending-only row has no assessment to be stale.
  const freshness = projection ? derivedFreshness(applicability, projection, options.moveDatePassed) : { stale: false, stale_reason: null };
  const tiLevel = projectionLevel(projection?.transaction_intent, actionable), mlLevel = projectionLevel(projection?.move_likelihood, actionable);
  return outreachMoveAssessmentDtoSchema.parse({
    transaction_intent_level: tiLevel, move_likelihood_level: mlLevel,
    transaction_intent_level_label: levelLabel(tiLevel), move_likelihood_level_label: levelLabel(mlLevel),
    artifact_id: idOf(projection?.artifact_id), status, applicability,
    transaction_intent: actionable ? projection?.transaction_intent ?? null : null,
    move_likelihood: actionable ? projection?.move_likelihood ?? null : null,
    transaction_intent_confidence: actionable ? confidenceOf(projection?.transaction_intent_confidence) : null,
    move_likelihood_confidence: actionable ? confidenceOf(projection?.move_likelihood_confidence) : null,
    context_as_of: iso(projection?.context_as_of), latest_conversation_at: iso(projection?.latest_conversation_at),
    ...freshness, published_at: iso(projection?.published_at),
  });
}

/** Frozen score sort keys (§8): not actionable → null, stale rows keep their numbers. */
export function assessmentSortKeys(projection: OutreachMoveAssessmentDto | null | undefined) {
  return {
    transaction_intent: projection?.transaction_intent ?? null,
    move_likelihood: projection?.move_likelihood ?? null,
    assessment_status: projection?.status ?? null,
    assessment_stale: projection ? projection.stale : null,
  };
}

// ---------------------------------------------------------------- evidence refs

const locatorVariants = evidenceLocatorDtoSchema.options;
function toLocator(raw: unknown) {
  const source = str(rec(raw)?.source);
  const variant = locatorVariants.find(option => option.shape.source.value === source);
  if (!variant) throw new z.ZodError([{ code: "custom", path: ["locator", "source"], message: `unsupported evidence source ${source}`, input: source }]);
  return variant.parse(pick(variant, raw));
}
/** Stored `EvidenceRef` (catalog entry without text) → DTO. */
export function toEvidenceRef(raw: unknown): EvidenceRefDto {
  const row = rec(raw) ?? {};
  return evidenceRefDtoSchema.parse({ id: row.id, kind: row.kind, locator: toLocator(row.locator), speaker: row.speaker ?? null,
    call_at: iso(row.call_at), lineage: arr(row.lineage).map(String) });
}
const refs = (raw: unknown) => arr(raw).map(toEvidenceRef);

/** Envelope citation (legacy agent or structured expansion) → common reference shape. */
export function envelopeEvidenceRef(runId: string, ref: IntelligenceEvidenceRef): EvidenceRefDto {
  return ref.source === "transcript"
    ? { id: `transcript:${ref.snapshot_id}:${ref.segment_ids.join(".")}`, kind: "transcript_quote", speaker: null, call_at: null, lineage: [],
      locator: { source: "analysis_transcript", run_id: runId, snapshot_id: ref.snapshot_id, conversation_id: ref.conversation_id,
        transcript_version: ref.transcript_version, segment_ids: ref.segment_ids } }
    : { id: `record:${ref.snapshot_id}:${ref.record_type}:${ref.record_id}`, kind: "analysis_record", speaker: null, call_at: null, lineage: [],
      locator: { source: "analysis_record", run_id: runId, snapshot_id: ref.snapshot_id, record_type: ref.record_type, record_id: ref.record_id,
        field_paths: ref.field_paths } };
}

// ---------------------------------------------------------------- assessment section

export type ArtifactRow = {
  _id: unknown; status: string; shadow?: boolean | null; subject_key: string; outreach_record_id?: unknown; contact_number_id?: unknown;
  schema_version: string; rubric_version: string; prompt_version: string; prompt_digest: string; schema_digest: string; model_version: string;
  input_fingerprint: string; input_mode?: string | null; generated_at?: Date | null; context_as_of?: Date | null; latest_conversation_at?: Date | null;
  scores?: unknown; views?: unknown; inventory?: unknown; conflicts?: unknown; coverage?: unknown; model_output?: unknown; source_manifest?: unknown;
  engagement?: unknown; engagement_effects?: unknown; published_at?: Date | null;
  purged_at?: Date | null; purge_started_at?: Date | null; createdAt?: Date | null;
};
export type SectionContext = {
  applicability: AssessmentApplicability;
  /** The Outreach projection when it points at this artifact; carries freshness. */
  projection?: ProjectionRow | null;
  current: boolean;
  /** `ContactNumber.content_purge_pending` for the subject's Number. */
  retention_pending?: boolean;
  /** The Lead's move date is before today (America/New_York) at the read's `as_of` (data spec §6.2). Applies to the current version only. */
  move_date_passed?: boolean;
  /** `newer_calls_count` (data spec §6.2), measured by the read. Omitted when not measured. */
  newer_calls_count?: number | null;
};

/** Artifact lifecycle → presentation availability; retention and unsupported versions win. */
export function artifactAvailability(artifact: ArtifactRow, retentionPending = false): AssessmentAvailability {
  if (artifact.purged_at || artifact.purge_started_at || artifact.status === "purged") return "purged";
  if (retentionPending) return "unavailable";
  if (!(SUPPORTED_ASSESSMENT_SCHEMAS as readonly string[]).includes(artifact.schema_version)) return "unsupported";
  return artifact.status as AssessmentAvailability;
}
export function scoreLabel(score: number | null, availability: AssessmentAvailability, applicability: AssessmentApplicability) {
  if (applicability !== "active") return "Not applicable";
  if (availability === "pending") return "Pending";
  if (availability === "not_assessed") return "Not assessed";
  if (availability === "not_applicable") return "Not applicable";
  if (["purged", "failed", "unavailable", "unsupported"].includes(availability)) return "Unavailable";
  return score === null ? "Unknown" : `${score} / 100`;
}
function emptyScore(availability: AssessmentAvailability, context: Pick<SectionContext, "applicability"> & { stale?: boolean; stale_reason?: StaleReason | null }): ScoreDto {
  return { score: null, level: null, label: scoreLabel(null, availability, context.applicability), confidence: null, rationale: null, conditions: [], evidence: [],
    stale: context.stale ?? false, stale_reason: context.stale_reason ?? null, applicability: context.applicability, evidence_missing: false };
}
function dimension(raw: unknown, availability: AssessmentAvailability, context: SectionContext & { stale: boolean; stale_reason: StaleReason | null }): ScoreDto {
  const row = rec(raw);
  if (!row) return emptyScore(availability, context);
  const score = typeof row.score === "number" ? row.score : null;
  const evidence = refs(row.evidence);
  return scoreDtoSchema.parse({ score, level: row.level ?? null, level_label: levelLabel(row.level as AssessmentLevel | null | undefined), label: scoreLabel(score, availability, context.applicability),
    confidence: row.confidence ?? null, rationale: str(row.rationale), conditions: arr(row.conditions).map(String), evidence,
    stale: context.stale, stale_reason: context.stale_reason, applicability: context.applicability,
    // RD11: the contract allows zero citations at `unknown`; any higher level must cite.
    evidence_missing: row.level != null && row.level !== "unknown" && evidence.length === 0 });
}
function moveView(raw: unknown) {
  const row = rec(raw);
  if (!row) return null;
  const provenance = rec(row.provenance);
  return moveViewDtoSchema.parse({ ...(pick(moveViewDtoSchema, row) as Loose),
    pickup: pick(moveViewDtoSchema.shape.pickup, row.pickup), delivery: pick(moveViewDtoSchema.shape.delivery, row.delivery),
    provenance: provenance ? { source_system: str(provenance.source_system), changed_at: iso(provenance.changed_at), observation_id: idOf(provenance.observation_id) } : null,
    ...("captured_at" in row ? { captured_at: iso(row.captured_at) } : {}) });
}
const observationVariants = observationDtoSchema.options;
function observationDto(raw: unknown) {
  const row = rec(raw) ?? {};
  const variant = observationVariants.find(option => option.shape.field.value === row.field);
  if (!variant) throw new z.ZodError([{ code: "custom", path: ["field"], message: `unsupported observation ${String(row.field)}`, input: row.field }]);
  return observationDtoSchema.parse({ field: row.field, value: pick(variant.shape.value, row.value), status: row.status, evidence: refs(row.evidence) });
}

/** Final spec §11.3 column 3 words (data spec §6.11 D). */
export const WORK_STATUS_LABELS: Record<string, string> = {
  not_contacted: "No rep has spoken with the customer yet", worked_no_next_step: "Worked, no next step agreed",
  worked_with_next_step: "Worked, next step agreed", unknown: "Unclear from the calls",
};
const CALLBACK_STATUS_LABELS: Record<string, string> = { pending: "Pending", fulfilled: "Done", cancelled: "Cancelled", unknown: "Unclear" };
const NEXT_STEP_STATUS_LABELS: Record<string, string> = { planned: "Planned", conditional: "Conditional", done: "Done", unknown: "Unclear" };
export const PARTY_LABELS: Record<string, string> = { rep: "Rep", customer: "Customer", unknown: "Speaker unknown" };
const NEXT_STEP_ACTION_LABELS: Record<string, string> = { call: "Call", text_customer: "Text the customer", send_estimate: "Send estimate",
  check_availability: "Check availability", review: "Review", wait: "Wait for the customer", other: "Other" };
/** Why an engagement item did not become a follow-up (`engagement.ts` reasons); unknown reasons read as their words. */
export const ENGAGEMENT_SKIP_LABELS: Record<string, string> = {
  superseded_by_later_call: "A later call replaced it", already_created: "Already on the list", open_action_exists: "An open follow-up of this kind exists",
  fulfilled_by_later_attempt: "A later call attempt acted on it", party_unknown: "Unclear who made the promise", owner_unknown: "Unclear who owns the next step",
  status_fulfilled: "Already done on the call", status_done: "Already done on the call", status_cancelled: "Cancelled on the call",
  status_conditional: "Only conditional", status_unknown: "Status unclear", record_closed: "The work is closed",
  record_identity_review: "The work is waiting on an identity review", owner_instruction: "Your status or closure instruction takes precedence",
  engagement_unavailable: "The engagement block could not be read",
};
const words = (value: string) => { const text = value.replace(/_/g, " ").trim(); return text ? text[0]!.toUpperCase() + text.slice(1) : value; };
const labelOf = (labels: Record<string, string>, value: unknown) => { const key = String(value ?? ""); return labels[key] ?? words(key); };

function engagementDto(raw: unknown, effectsRaw: unknown): EngagementDto | undefined {
  const row = rec(raw);
  if (!row) return undefined;
  const fx = rec(effectsRaw);
  // `engagement_effects.followups[i]` (source, index) created `followup_ids[i]` (`applyAssessmentEngagement`).
  const followupIds = arr(fx?.followup_ids).map(String);
  const created = new Map(arr(fx?.followups).flatMap((item, i) => { const r = rec(item); return r && r.source != null && r.index != null ? [[`${String(r.source)}:${Number(r.index)}`, followupIds[i] ?? null] as const] : []; }));
  const createdFor = (source: string, index: number) => ({ followup_created: created.has(`${source}:${index}`), followup_id: created.get(`${source}:${index}`) ?? null });
  const callbacks = arr(row.promised_callbacks).map(item => rec(item) ?? {});
  const steps = arr(row.next_steps).map(item => rec(item) ?? {});
  const itemText = (source: string, index: number) => { const r = source === "promised_callback" ? callbacks[index] : source === "next_step" ? steps[index] : undefined;
    return r ? clean(str(r.raw_text) ?? str(r.description)) : null; };
  return engagementDtoSchema.parse({
    work_status: row.work_status, rationale: str(row.rationale) ?? "", evidence: refs(row.evidence), work_status_label: labelOf(WORK_STATUS_LABELS, row.work_status),
    promised_callbacks: callbacks.map((r, index) => ({ by: r.by, raw_text: r.raw_text, date: str(r.date), time_text: str(r.time_text), status: r.status, evidence: refs(r.evidence),
      by_label: labelOf(PARTY_LABELS, r.by), status_label: labelOf(CALLBACK_STATUS_LABELS, r.status),
      date_label: joinPresent([calendarDay(str(r.date), { weekday: true }), clean(str(r.time_text))], ", "), ...createdFor("promised_callback", index) })),
    next_steps: steps.map((r, index) => ({ action: r.action, owner: r.owner, description: r.description, date: str(r.date), date_text: str(r.date_text), status: r.status, evidence: refs(r.evidence),
      action_label: labelOf(NEXT_STEP_ACTION_LABELS, r.action), owner_label: labelOf(PARTY_LABELS, r.owner), status_label: labelOf(NEXT_STEP_STATUS_LABELS, r.status),
      date_label: calendarDay(str(r.date), { weekday: true }) ?? (str(r.date_text) ? `"${clean(str(r.date_text))}"` : null), ...createdFor("next_step", index) })),
    effects: fx ? { applied: Boolean(fx.applied), mark_worked: Boolean(fx.mark_worked), blocked: str(fx.blocked), followup_ids: followupIds,
      blocked_label: str(fx.blocked) ? labelOf(ENGAGEMENT_SKIP_LABELS, fx.blocked) : null,
      followups: arr(fx.followups).map(item => { const r = rec(item) ?? {}; return { kind: String(r.kind), origin: String(r.origin), description: String(r.description ?? ""), source: String(r.source) }; }),
      skipped: arr(fx.skipped).map(item => { const r = rec(item) ?? {}; const source = String(r.source), index = Number(r.index ?? 0);
        return { source, index, reason: String(r.reason), reason_label: labelOf(ENGAGEMENT_SKIP_LABELS, r.reason), text: itemText(source, index) }; }) } : null,
  });
}

// ---------------------------------------------------------------- move table (final spec §11.4, data spec §6.11 D)

type MoveTableRowKey = MoveTableDto["rows"][number]["key"];
type Marker = MoveTableDto["rows"][number]["customer"][number]["marker"];
const MOVE_TABLE_LABELS: Record<MoveTableRowKey, string> = { pickup: "Pickup", delivery: "Delivery", move_date: "Move date", size: "Size",
  services: "Services", access: "Access", money: "Money", inventory: "Inventory summary" };
const ROW_ORDER: MoveTableRowKey[] = ["pickup", "delivery", "move_date", "size", "services", "access", "money", "inventory"];
/** Observation field / conflict target → move-table row. Score targets are not rows. */
const ROW_OF: Record<string, MoveTableRowKey> = { pickup_location: "pickup", delivery_location: "delivery", move_date: "move_date", move_size: "size",
  service: "services", access: "access", money: "money", inventory: "inventory" };
const SCORE_TARGET_LABELS: Record<string, string> = { move_likelihood: "Move likelihood", transaction_intent: "Transaction intent" };
export const ORIGIN_LABELS: Record<string, string> = { original_form_submission: "Original form submission", granot_created: "Granot created",
  legacy_baseline: "Legacy baseline", unknown: "Unknown origin" };
const SERVICE_LABELS: Record<string, string> = { packing: "Packing", unpacking: "Unpacking", storage: "Storage", vehicle: "Vehicle transport",
  specialty: "Specialty items", disassembly: "Disassembly" };
const ACCESS_LABELS: Record<string, string> = { floor: "Floor", elevator: "Elevator", stairs: "Stairs", long_carry: "Long carry", parking: "Parking",
  shuttle: "Shuttle", access_window: "Access window" };
const MONEY_BASIS_LABELS: Record<string, string> = { budget: "budget", quote: "quote", estimate: "estimate", deposit: "deposit", final_price: "final price",
  competitor_quote: "competitor quote" };
const COVERAGE_LABELS: Record<string, string> = { none: "none", partial: "partial", customer_says_complete: "customer says complete" };

type Place = { line?: string | null; city: string | null; state: string | null; zip: string | null };
const placeText = (place: Place | null | undefined) => place
  ? joinPresent([clean(place.line ?? null), joinPresent([clean(place.city), joinPresent([clean(place.state), clean(place.zip)], " ")], ", ")], ", ") : null;
function rangeText(range: { min: number | null; max: number | null }, currency: string | null): string | null {
  const { min, max } = range;
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `${formatAmount(min, currency)}–${formatAmount(max, currency)}`;
  return formatAmount((min ?? max)!, currency);
}
/** One customer cell entry for a stated observation (`move_details[]`, or a summary `move_evidence` observation). */
export function observationText(observation: { field: string; value: unknown }): string {
  const value = rec(observation.value) ?? {};
  switch (observation.field) {
    case "pickup_location": case "delivery_location":
      return placeText(value as Place) ?? "Location not clear";
    case "move_date": {
      const day = str(value.date), end = str(value.end_date), raw = clean(str(value.raw_text));
      const date = value.precision === "month" ? calendarDay(day, { month: true })
        : day && end && end !== day ? `${calendarDay(day)} – ${calendarDay(end)}` : calendarDay(day);
      const text = date ?? (raw ? `"${raw}"` : "Date not clear");
      return value.applies_to === "delivery" ? `Delivery: ${text}` : text;
    }
    case "move_size":
      return clean(str(value.text)) ?? rangeText(rec(value.value) as { min: number | null; max: number | null } ?? { min: null, max: null }, null) ?? "Size not clear";
    case "service":
      return `${labelOf(SERVICE_LABELS, value.service)}${joinPresent([clean(str(value.detail)), clean(str(value.duration_text))], ", ") ? ` (${joinPresent([clean(str(value.detail)), clean(str(value.duration_text))], ", ")})` : ""}`;
    case "access":
      return `${value.end === "delivery" ? "Delivery" : "Pickup"} · ${labelOf(ACCESS_LABELS, value.constraint)}${clean(str(value.detail)) ? `: ${clean(str(value.detail))}` : ""}`;
    case "money": {
      const amount = rangeText(rec(value.amount) as { min: number | null; max: number | null } ?? { min: null, max: null }, str(value.currency));
      const basis = labelOf(MONEY_BASIS_LABELS, value.basis).toLowerCase();
      return amount ? `${amount} ${basis}` : `"${clean(str(value.text)) ?? ""}" (${basis})`;
    }
    default:
      return clean(JSON.stringify(observation.value)) ?? "";
  }
}
function observationMarker(observation: { field: string; value: unknown; status: string }): Marker {
  if (observation.status === "conditional" || observation.status === "changed" || observation.status === "retracted") return observation.status;
  const value = rec(observation.value) ?? {};
  if (observation.field === "service" && value.status === "declined") return "declined";
  if (observation.field === "move_date" && value.flexibility === "flexible") return "flexible";
  return null;
}
type ViewLike = AssessmentSection["views"]["canonical_current"];
function viewCell(view: ViewLike, key: MoveTableRowKey): string | null {
  if (!view) return null;
  if (key === "pickup") return placeText(view.pickup);
  if (key === "delivery") return placeText(view.delivery);
  if (key === "move_date") return calendarDay(view.move_date);
  if (key === "size") {
    const sizes = [...new Set([clean(view.move_size), clean(view.granot_move_size)].filter((v): v is string => Boolean(v)))];
    return joinPresent([...sizes, view.cubic_feet != null ? `${view.cubic_feet.toLocaleString("en-US")} cu ft` : null], " · ");
  }
  return null; // services, access, money and inventory exist only in the customer's words
}
const conflictCells = (evidence: readonly EvidenceRefDto[]) => {
  const cells = new Set<"customer" | "lead_on_file" | "original">();
  for (const ref of evidence) {
    if (ref.kind === "lead_current") cells.add("lead_on_file");
    else if (ref.kind === "lead_ingested") cells.add("original");
    else if (ref.kind !== "official_state" && ref.kind !== "owner_correction") cells.add("customer");
  }
  return cells.size ? [...cells] : ["customer" as const];
};
const dedupeRefs = (list: readonly EvidenceRefDto[]) => [...new Map(list.map(ref => [ref.id, ref])).values()];

/** Pure over an already-presented section: the admin places these strings and formats nothing about a move fact. */
export function moveTable(section: Pick<AssessmentSection, "views" | "inventory" | "conflicts" | "coverage">): MoveTableDto {
  const { views, inventory, conflicts, coverage } = section;
  const byRow = new Map<MoveTableRowKey, MoveTableDto["rows"][number]["customer"]>();
  for (const observation of views.customer_stated) {
    const key = ROW_OF[observation.field];
    if (!key) continue;
    byRow.set(key, [...(byRow.get(key) ?? []), { text: observationText(observation), marker: observationMarker(observation), evidence: observation.evidence }]);
  }
  if (inventory.items.length || inventory.coverage) byRow.set("inventory", [{ text: `${inventory.items.length} item${inventory.items.length === 1 ? "" : "s"}${
    inventory.coverage ? ` · coverage ${labelOf(COVERAGE_LABELS, inventory.coverage)}` : ""}`, marker: null, evidence: dedupeRefs(inventory.items.flatMap(item => item.evidence)) }]);
  const rows = ROW_ORDER.map(key => {
    const rowConflicts = conflicts.filter(conflict => ROW_OF[conflict.affects] === key);
    const evidence = dedupeRefs(rowConflicts.flatMap(conflict => conflict.evidence));
    return { key, label: MOVE_TABLE_LABELS[key], customer: byRow.get(key) ?? [], lead_on_file: viewCell(views.canonical_current, key),
      original: viewCell(views.original_ingestion, key),
      conflict: rowConflicts.length ? { explanation: rowConflicts.map(conflict => clean(conflict.explanation) ?? "").filter(Boolean).join("; "), evidence, cells: conflictCells(evidence) } : null };
  });
  const originLabel = views.original_ingestion?.label ?? (views.original_ingestion ? "unknown" : null);
  return moveTableDtoSchema.parse({ rows, original_origin_label: originLabel ? labelOf(ORIGIN_LABELS, originLabel) : null,
    score_conflicts: conflicts.filter(conflict => SCORE_TARGET_LABELS[conflict.affects]).map(conflict => ({ affects: conflict.affects,
      affects_label: SCORE_TARGET_LABELS[conflict.affects]!, explanation: clean(conflict.explanation) ?? "", evidence: conflict.evidence })),
    inventory_count: inventory.items.length,
    source_coverage_text: coverage ? `From ${coverage.conversations_selected} of ${coverage.conversations_available} conversation${coverage.conversations_available === 1 ? "" : "s"}` : null });
}

/** Final spec §11.9 "No assessment": the Lead columns still fill from the live Lead views; the customer column is empty. */
export function leadOnlyMoveTable(views: { original_ingestion: unknown; canonical_current: unknown } | null): MoveTableDto {
  return moveTable({ views: { original_ingestion: moveView(views?.original_ingestion), canonical_current: moveView(views?.canonical_current), customer_stated: [] },
    inventory: { items: [], coverage: null, limitations: [], source_coverage: null }, conflicts: [], coverage: null });
}

/** (1) Stored artifact → `AssessmentSection`. Content is only served for ready / insufficient-evidence artifacts. */
export function assessmentSection(artifact: ArtifactRow, context: SectionContext): AssessmentSection {
  const availability = artifactAvailability(artifact, context.retention_pending);
  const projection = context.current ? context.projection ?? null : null;
  // Freshness belongs to the current version only (the projection's artifact, or the Lead's passed move date on it).
  const freshness = context.current ? derivedFreshness(context.applicability, projection, context.move_date_passed) : { stale: false, stale_reason: null };
  const header = {
    artifact_id: String(artifact._id), schema_version: artifact.schema_version, rubric_version: artifact.rubric_version, model_version: artifact.model_version,
    generated_at: iso(artifact.generated_at), context_as_of: iso(artifact.context_as_of), latest_conversation_at: iso(artifact.latest_conversation_at),
    input_mode: artifact.input_mode ?? null, shadow: Boolean(artifact.shadow), current: context.current, ...freshness, published_at: iso(artifact.published_at),
    ...(context.newer_calls_count !== undefined ? { newer_calls_count: context.newer_calls_count } : {}),
  };
  const empty = (value: AssessmentAvailability): AssessmentSection => assessmentSectionSchema.parse({ ...header, availability: value,
    transaction_intent: emptyScore(value, { ...context, ...freshness }), move_likelihood: emptyScore(value, { ...context, ...freshness }),
    views: { original_ingestion: null, canonical_current: null, customer_stated: [] },
    inventory: { items: [], coverage: null, limitations: [], source_coverage: null }, conflicts: [], coverage: null, source_manifest: [] });
  if (!SCORED_STATUSES.has(availability)) return empty(availability);
  try {
    const scores = rec(artifact.scores) ?? {}, views = rec(artifact.views) ?? {}, inventory = rec(artifact.inventory) ?? {}, coverage = rec(artifact.coverage);
    const scoreContext = { ...context, ...freshness };
    const section = assessmentSectionSchema.parse({ ...header, availability,
      transaction_intent: dimension(scores.transaction_intent, availability, scoreContext), move_likelihood: dimension(scores.move_likelihood, availability, scoreContext),
      views: { original_ingestion: moveView(views.original_ingestion), canonical_current: moveView(views.canonical_current),
        customer_stated: arr(views.customer_stated).map(observationDto) },
      inventory: { items: arr(inventory.items).map(item => inventoryItemDtoSchema.parse({ ...(pick(inventoryItemDtoSchema, item) as Loose),
        quantity: pick(inventoryItemDtoSchema.shape.quantity, rec(item)?.quantity), evidence: refs(rec(item)?.evidence) })),
        coverage: inventory.coverage ?? null, limitations: arr(inventory.limitations).map(String), source_coverage: coverage?.source_coverage ?? null },
      conflicts: arr(artifact.conflicts).map(conflict => conflictDtoSchema.parse({ affects: rec(conflict)?.affects, explanation: rec(conflict)?.explanation,
        evidence: refs(rec(conflict)?.evidence) })),
      ...(artifact.engagement ? { engagement: engagementDto(artifact.engagement, artifact.engagement_effects) } : {}),
      coverage: coverage ? { conversations_available: coverage.conversations_available, conversations_selected: coverage.conversations_selected,
        findings_selected: coverage.findings_selected } : null,
      source_manifest: arr(artifact.source_manifest).map(entry => sourceManifestEntryDtoSchema.parse({ kind: rec(entry)?.kind, id: rec(entry)?.id,
        version: rec(entry)?.version, conversation_id: idOf(rec(entry)?.conversation_id), call_at: iso(rec(entry)?.call_at), lineage: arr(rec(entry)?.lineage).map(String) })),
    });
    return withMoveTable(section);
  } catch (error) {
    if (error instanceof z.ZodError) return empty("unsupported");
    throw error;
  }
}

/** The move table is optional: a construction error omits it instead of hiding a section that rendered before it existed. */
function withMoveTable(section: AssessmentSection): AssessmentSection {
  try {
    return assessmentSectionSchema.parse({ ...section, move_table: moveTable(section) });
  } catch (error) {
    if (error instanceof z.ZodError) return section;
    throw error;
  }
}

/** The section shown when no artifact exists: Not assessed / Pending / Not applicable. Never a fake artifact. */
export function noAssessmentAvailability(applicability: AssessmentApplicability, pending: boolean): AssessmentAvailability {
  return applicability !== "active" ? "not_applicable" : pending ? "pending" : "not_assessed";
}

const VERSION_LABELS: Record<string, string> = {
  pending: "Pending", ready: "Assessed", insufficient_evidence: "Insufficient evidence", ambiguous_subject: "Ambiguous subject",
  not_applicable: "Not applicable", failed: "Failed", purged: "Purged", unsupported: "Unsupported version", unavailable: "Unavailable",
};
export function assessmentVersion(artifact: ArtifactRow, current: boolean, retentionPending = false): AssessmentVersion {
  const status = artifactAvailability(artifact, retentionPending);
  const scores = SCORED_STATUSES.has(status) ? rec(artifact.scores) : null;
  const scoreOf = (key: string) => { const value = rec(scores?.[key])?.score; return typeof value === "number" ? value : null; };
  return assessmentVersionSchema.parse({ artifact_id: String(artifact._id), status, label: VERSION_LABELS[status] ?? status, current,
    generated_at: iso(artifact.generated_at ?? artifact.createdAt), context_as_of: iso(artifact.context_as_of), schema_version: artifact.schema_version,
    model_version: artifact.model_version, input_mode: artifact.input_mode ?? null,
    transaction_intent: scoreOf("transaction_intent"), move_likelihood: scoreOf("move_likelihood") });
}

/** (5) Full output for an assessment: the exact retained model object and, separately, the accepted server envelope. */
export function assessmentFullOutput(artifact: ArtifactRow, retentionPending = false): FullOutput {
  const availability = artifactAvailability(artifact, retentionPending);
  const served = SCORED_STATUSES.has(availability);
  const sectionAvailability = served ? "ready" : availability === "purged" ? "purged" : availability === "unsupported" ? "unsupported" : "unavailable";
  return fullOutputSchema.parse({ kind: "move_assessment", id: String(artifact._id), version: artifact.schema_version,
    generated_at: iso(artifact.generated_at), availability: sectionAvailability, complete: served && artifact.model_output != null,
    model_output: served ? json(artifact.model_output) : null,
    accepted: served ? json({ scores: artifact.scores ?? null, views: artifact.views ?? null, inventory: artifact.inventory ?? null,
      conflicts: artifact.conflicts ?? null, engagement: artifact.engagement ?? null, engagement_effects: artifact.engagement_effects ?? null,
      coverage: artifact.coverage ?? null }) : null,
    details: { schema_version: artifact.schema_version, prompt_version: artifact.prompt_version, model_version: artifact.model_version,
      digests: { prompt_digest: artifact.prompt_digest, schema_digest: artifact.schema_digest, input_fingerprint: artifact.input_fingerprint } } });
}

/** Every citation an artifact carries, deduplicated by id, in reading order (scores, statements, inventory, conflicts). */
export function assessmentEvidenceRefs(artifact: ArtifactRow): EvidenceRefDto[] {
  const scores = rec(artifact.scores) ?? {}, views = rec(artifact.views) ?? {}, inventory = rec(artifact.inventory) ?? {};
  const all = [...refs(rec(scores.transaction_intent)?.evidence), ...refs(rec(scores.move_likelihood)?.evidence),
    ...arr(views.customer_stated).flatMap(item => refs(rec(item)?.evidence)), ...arr(inventory.items).flatMap(item => refs(rec(item)?.evidence)),
    ...arr(artifact.conflicts).flatMap(item => refs(rec(item)?.evidence))];
  return [...new Map(all.map(ref => [ref.id, ref])).values()];
}

// ---------------------------------------------------------------- evidence resolution

export type SnapshotRow = { _id: unknown; run_id?: unknown; conversation_id?: unknown; response?: unknown; content_digest: string;
  purged_at?: Date | null; purge_started_at?: Date | null; retrieved_at?: Date | null };
export type RunRow = {
  _id: unknown; conversation_id?: unknown; contact_number_id?: unknown; status: string; output?: unknown; raw_output?: unknown; analysis_pipeline?: string | null;
  step_artifacts?: unknown; prompt_version: string; schema_version: string; model_version: string; completed_at?: Date | null; createdAt?: Date | null;
  purged_at?: Date | null; purge_started_at?: Date | null; manifest_snapshot_ids?: readonly unknown[]; subject_key?: string;
};
export type FindingRow = { _id: unknown; run_id?: unknown; revision: number; assertion: unknown; review_state: string; purged_at?: Date | null; conversation_id?: unknown;
  key?: string; kind?: string; superseded_by?: unknown; resolved?: { due_at?: Date | string | null; amount_cents?: number | null } | null };
export type ConversationRow = { _id: unknown; summary?: unknown; content_purged_at?: Date | null; started_at?: Date | null };
/** A source transcript snapshot (`source_type: transcript`), with only the cited segments loaded. */
export type TranscriptRow = { _id: unknown; conversation_id?: unknown; purged_at?: Date | null; purge_started_at?: Date | null;
  segments?: ReadonlyArray<{ sid: number; start_ms?: number | null; speaker?: string | null; text?: string | null }> };
export type InstructionRow = { instruction_id: unknown; revision: number; field: string; current?: unknown; happened_at?: Date | null };
/** Current official flags of a Lead (`${model}:${id}`), for `official` citations. */
export type LeadFlagsRow = { booked?: unknown; cancelled?: unknown; duplicate?: boolean | null; bad_lead?: unknown; no_sync?: boolean | null };
/** Loaded sources an assessment's citations point at. Maps are keyed by string id. */
export type EvidenceSources = {
  snapshots: ReadonlyMap<string, SnapshotRow>;
  runs: ReadonlyMap<string, RunRow>;
  conversations: ReadonlyMap<string, ConversationRow>;
  findings: ReadonlyMap<string, FindingRow>;
  /** `${model}:${id}` of Leads that still exist. */
  leads: ReadonlySet<string>;
  // Additive (data spec §6.11 C): text for transcript, record, Lead, official and correction citations.
  transcripts?: ReadonlyMap<string, TranscriptRow>;
  /** Keyed `${instruction_id}:${revision}`. */
  instructions?: ReadonlyMap<string, InstructionRow>;
  lead_flags?: ReadonlyMap<string, LeadFlagsRow>;
  /** The artifact's own Lead views: a Lead citation's text is the value the model was shown. */
  views?: AssessmentSection["views"] | null;
  /** When the artifact's context was assembled (`as_of` of a current-view Lead citation). */
  context_as_of?: string | null;
  /** The read's `as_of`: official citations show the live record. */
  as_of?: string | null;
};

export const SUMMARY_LABELS = { overview: "Overview", customer_wanted: "What the customer wanted", money_and_dates: "Money and dates",
  outcome: "Outcome", commitments: "Commitments", discrepancies: "Discrepancies" } as const;
type SummaryKey = keyof typeof SUMMARY_LABELS;
const CONVERSATION_SECTION: Record<string, string> = { overview: "overview", customer_wanted: "customer_wanted", money_dates: "money_dates",
  outcome: "outcome", promised: "promised", mismatch: "mismatch" };
const LEGACY_SECTION_LABELS: Record<string, string> = { text: "Summary", overview: "Overview", customer_wanted: "What the customer wanted",
  money_dates: "Money and dates", outcome: "Outcome", promised: "Commitments", mismatch: "Discrepancies" };

/** Final spec §11.6 labels for every record the model may cite. */
export const RECORD_LABELS: Record<string, string> = {
  lead: "Lead", booking: "Booking", cancellation: "Cancellation", followup: "Follow-up", outreach: "Outreach", interaction: "Call",
  job_timeline: "Number activity", owner_instruction: "Owner correction", owner_note: "Owner note", contact_number: "Number",
  rep_identity: "Rep identity", agent: "Rep", granot_source: "Granot source", ringcentral_queue: "RingCentral queue", ringcentral_user: "RingCentral user",
  story_event: "Story event", granot_state: "Granot state", prior_summary: "Earlier summary", prior_finding: "Earlier finding", prior_assessment: "Earlier assessment",
};
type RecordLike = { record_type: string; record_id: string; fields: Loose };
export function recordLabel(record: Pick<RecordLike, "record_type" | "fields">): string {
  if (record.record_type === "lead" && /^Attachment /.test(str(record.fields.details) ?? "")) return "Attachment";
  if (record.record_type === "story_event" && /^lead_message/.test(str(record.fields.kind) ?? "")) return "Lead Message";
  return RECORD_LABELS[record.record_type] ?? words(record.record_type);
}
const FIELD_ORDER = ["name", "job_no", "model", "kind", "status", "direction", "result", "instruction_field", "details", "phone", "source", "pickup", "delivery",
  "move_date", "move_size", "priority_label", "agent_name", "due_at", "occurred_at"] as const;
/** One line for a cited record: its own description when it has one, else its identifying fields. */
export function recordText(record: RecordLike): string {
  const f = record.fields;
  const described = str(f.description);
  if (described) return clip(clean(described) ?? described);
  const flags = (["booked", "cancelled", "duplicate", "bad_lead", "no_sync"] as const).filter(flag => f[flag] === true).map(flag => words(flag));
  const parts = FIELD_ORDER.flatMap(key => {
    const value = f[key];
    if (value == null || value === "") return [];
    if (key === "job_no") return [`Job ${String(value)}`];
    if (key === "due_at" || key === "occurred_at") return [formatEtDateTime(value) ?? String(value)];
    return [typeof value === "string" ? value : JSON.stringify(value)];
  });
  if (typeof f.duration_seconds === "number") parts.push(`${f.duration_seconds}s`);
  return clip(clean(joinPresent([...parts, ...flags], " · ") ?? `${recordLabel(record)} ${record.record_id}`) ?? record.record_id);
}
const recordAsOf = (record: RecordLike, snapshot: SnapshotRow | undefined) =>
  iso(record.fields.occurred_at) ?? iso(record.fields.happened_at) ?? iso(snapshot?.retrieved_at);

const OFFICIAL_LABELS: Record<string, string> = { booked: "Booked", cancelled: "Cancelled", duplicate: "Duplicate", bad_lead: "Bad Lead", no_sync: "No-Sync", booking: "Booking" };
const LEAD_FIELD_LABELS: Record<string, string> = { pickup: "Pickup", delivery: "Delivery", move_date: "Move date", move_size: "Move size",
  granot_move_size: "Granot move size", cubic_feet: "Cubic feet" };
function leadCitationText(locator: Extract<EvidenceRefDto["locator"], { source: "lead" }>, views: EvidenceSources["views"]): string | null {
  const view = locator.view === "ingested" ? views?.original_ingestion : views?.canonical_current;
  if (!view) return null;
  const field = locator.field_path.replace(/^ingested_move_snapshot\./, "");
  const value = field === "pickup" ? placeText(view.pickup) : field === "delivery" ? placeText(view.delivery)
    : field === "move_date" ? calendarDay(view.move_date) ?? view.move_date : field === "move_size" ? view.move_size
      : field === "granot_move_size" ? view.granot_move_size : field === "cubic_feet" ? (view.cubic_feet == null ? null : String(view.cubic_feet)) : null;
  return `${LEAD_FIELD_LABELS[field] ?? words(field)}: ${clean(value) ?? "not on file"}`;
}
function correctionText(row: InstructionRow): string {
  const current = rec(row.current);
  const reason = str(current?.reason);
  const state = str(current?.review_state);
  const head = row.field === "assertion" ? (state === "retracted" ? "Retracted a finding" : state === "corrected" ? "Corrected a finding" : "Changed a finding")
    : words(row.field);
  return clip(clean(reason ? `${head}: ${reason}` : `${head}: ${JSON.stringify(row.current ?? null)}`) ?? head);
}

/** Retention and integrity of a snapshot, and when it was purged. */
const retainedSnapshot = (row: SnapshotRow | undefined): "retained" | "purged" | "missing" =>
  !row ? "missing" : row.purged_at || row.purge_started_at ? "purged" : payloadHash(row.response) === row.content_digest ? "retained" : "missing";
const INTENT_SIGNAL_LABELS: Record<string, string> = { definite_move: "Definite move", move_condition: "Move condition", move_abandoned: "Move abandoned",
  booking_readiness: "Ready to book", booking_condition: "Booking condition", price_objection: "Price objection", competitor_commitment: "Committed to a competitor",
  rejects_vantage: "Rejects Vantage" };
const quantityText = (range: { min: number | null; max: number | null }) => range.min == null && range.max == null ? null
  : range.min != null && range.max != null && range.min !== range.max ? `${range.min}–${range.max}` : String(range.min ?? range.max);
type SummaryCitation ={ text: string | null; segment_ids: number[]; speaker: "rep" | "customer" | "unknown" | null; label: string };
/**
 * A summary-artifact citation (`said_on_call.N`, `move_evidence.N`, or a section). D11: `move_evidence` is an
 * object and its citations index observations, inventory and intent signals as ONE flat list, in that order,
 * exactly as the catalog numbers them (`sources.ts` `fromSummaryArtifact`).
 */
function summaryCitation(row: SnapshotRow, section: string): SummaryCitation {
  const summary = rec(rec(row.response)?.analysis_summary);
  const none: SummaryCitation = { text: null, segment_ids: [], speaker: null, label: "From the call summary" };
  if (!summary) return none;
  const said = /^said_on_call\.(\d+)$/.exec(section), move = /^move_evidence\.(\d+)$/.exec(section);
  const speakerOf = (value: unknown) => (value === "rep" || value === "customer" || value === "unknown" ? value : null);
  if (said) {
    const fact = rec(arr(summary.said_on_call)[Number(said[1])]);
    return { text: clean(str(fact?.claim)), segment_ids: arr(fact?.segment_ids).filter((id): id is number => Number.isInteger(id)), speaker: speakerOf(fact?.speaker),
      label: "Said on the call" };
  }
  if (move) {
    const parsed = summaryMoveEvidenceSchema.safeParse(summary.move_evidence);
    if (!parsed.success) return none;
    const { observations, inventory, intent_signals } = parsed.data;
    const flat: Array<{ text: string; segment_ids: number[]; speaker: "rep" | "customer" | "unknown" }> = [
      ...observations.map(o => ({ text: `${MOVE_TABLE_LABELS[ROW_OF[o.field] ?? "move_date"]}: ${observationText(o)}`, segment_ids: o.segment_ids, speaker: o.speaker })),
      ...inventory.map(item => ({ text: `Inventory: ${clean(item.label) ?? item.label}${quantityText(item.quantity) ? ` × ${quantityText(item.quantity)}` : ""}${
        item.room ? ` (${clean(item.room)})` : ""}${item.status !== "included" ? ` · ${item.status}` : ""}`, segment_ids: item.segment_ids, speaker: item.speaker })),
      ...intent_signals.map(signal => ({ text: `${labelOf(INTENT_SIGNAL_LABELS, signal.signal)}: ${clean(signal.text) ?? ""}`, segment_ids: signal.segment_ids, speaker: signal.speaker })),
    ];
    const item = flat[Number(move[1])];
    return item ? { ...item, label: "Said on the call" } : none;
  }
  // The whole-summary reference (`section: "summary"`) reads as its overview.
  return { text: clean(str(rec(summary.summary)?.[section === "summary" ? "overview" : section])), segment_ids: [], speaker: null,
    label: SUMMARY_LABELS[section as SummaryKey] ?? "From the call summary" };
}
const callStart = (sources: EvidenceSources, conversationId: string | null | undefined) =>
  conversationId ? iso(sources.conversations.get(conversationId)?.started_at) : null;

/** The cited transcript segments: from the snapshot itself when it carries them, else from its source transcript snapshot. */
function citedSegments(row: SnapshotRow | undefined, sources: EvidenceSources, segmentIds: readonly number[]) {
  const transcript = rec(rec(row?.response)?.transcript);
  const inline = arr(transcript?.segments).flatMap(segment => { const s = rec(segment); return s && typeof s.sid === "number" ? [s] : []; });
  const pick = (list: readonly Loose[]) => segmentIds.map(id => list.find(s => s.sid === id)).filter((s): s is Loose => Boolean(s));
  const own = pick(inline);
  if (own.length === segmentIds.length && own.length) return { segments: own, source: null as TranscriptRow | null };
  const source = str(transcript?.source_snapshot_id) ? sources.transcripts?.get(str(transcript?.source_snapshot_id)!) ?? null : null;
  const fromSource = source && !source.purged_at && !source.purge_started_at ? pick((source.segments ?? []) as unknown as Loose[]) : [];
  return { segments: fromSource.length ? fromSource : own, source };
}

/** Same hrefs `toOutreachDto` builds for related records. */
export function recordHref(model: string, id: string): string | null {
  const path = model === "FormLead" ? "form-leads" : model === "CallLead" ? "call-leads" : model === "BookedLead" ? "bookings" : model === "CancelledLead" ? "cancellations" : null;
  return path ? `/${path}?record=${id}&database_scope=production` : null;
}

/** (4) Resolve one citation into an evidence item with retention-aware availability, an open target and its server-built text. */
export function resolveEvidence(ref: EvidenceRefDto, sources: EvidenceSources): EvidenceItemDto {
  const base = { id: ref.id, kind: ref.kind, source: ref.locator };
  const locator = ref.locator;
  switch (locator.source) {
    case "summary_artifact": {
      const row = sources.snapshots.get(locator.snapshot_id);
      let availability = retainedSnapshot(row);
      if (availability === "retained" && row!.content_digest !== locator.content_digest) availability = "missing";
      const cited = availability === "retained" ? summaryCitation(row!, locator.section) : null;
      return { ...base, availability, text: cited?.text ?? null,
        open: availability === "retained" ? { kind: "summary_artifact", snapshot_id: locator.snapshot_id } : null,
        conversation_id: locator.conversation_id, call_at: iso(ref.call_at) ?? callStart(sources, locator.conversation_id), segment_ids: cited?.segment_ids ?? [],
        speaker: cited?.speaker ?? ref.speaker ?? null, source_label: cited?.label ?? "From the call summary", purged_at: iso(row?.purged_at ?? row?.purge_started_at) };
    }
    case "legacy_run": {
      const run = sources.runs.get(locator.run_id);
      const availability = !run ? "missing" : run.purged_at || run.purge_started_at ? "purged" : run.output && payloadHash(run.output) === locator.output_digest ? "retained" : "missing";
      return { ...base, availability, text: availability === "retained" ? clean(str(rec(rec(run!.output)?.summary)?.[locator.section])) : null,
        open: availability === "retained" ? { kind: "analysis_run", run_id: locator.run_id } : null,
        conversation_id: locator.conversation_id, call_at: iso(ref.call_at) ?? callStart(sources, locator.conversation_id), segment_ids: [],
        source_label: SUMMARY_LABELS[locator.section as SummaryKey] ?? "From the call summary", purged_at: iso(run?.purged_at ?? run?.purge_started_at) };
    }
    case "conversation_summary": {
      const conversation = sources.conversations.get(locator.conversation_id);
      const summary = rec(conversation?.summary);
      const availability = !conversation || !summary ? "missing" : conversation.content_purged_at ? "purged" : payloadHash(summary) === locator.text_digest ? "retained" : "missing";
      const text = locator.section === "text" ? str(summary?.text) : str(rec(summary?.sections)?.[CONVERSATION_SECTION[locator.section] ?? ""]);
      return { ...base, availability, text: availability === "retained" ? clean(text) : null, open: null,
        conversation_id: locator.conversation_id, call_at: iso(ref.call_at) ?? callStart(sources, locator.conversation_id), segment_ids: [],
        source_label: LEGACY_SECTION_LABELS[locator.section] ?? "From the call summary", purged_at: iso(conversation?.content_purged_at) };
    }
    case "finding": {
      const finding = sources.findings.get(locator.finding_id);
      const availability = !finding ? "missing" : finding.purged_at ? "purged" : finding.revision === locator.revision ? "retained" : "partial";
      return { ...base, availability, text: finding && !finding.purged_at ? clean(str(rec(finding.assertion)?.claim)) : null,
        open: finding && !finding.purged_at ? { kind: "analysis_run", run_id: locator.run_id } : null,
        conversation_id: locator.conversation_id, call_at: iso(ref.call_at) ?? callStart(sources, locator.conversation_id), speaker: ref.speaker ?? null,
        source_label: "Finding", purged_at: iso(finding?.purged_at) };
    }
    case "lead": {
      const exists = sources.leads.has(`${locator.model}:${locator.id}`);
      const href = recordHref(locator.model, locator.id);
      const ingested = locator.view === "ingested";
      return { ...base, availability: exists ? "retained" : "missing", text: leadCitationText(locator, sources.views),
        open: exists && href ? { kind: "record", model: locator.model, id: locator.id, href } : null,
        record_label: ingested ? "Original submission" : "Lead on file",
        as_of: ingested ? iso(sources.views?.original_ingestion?.captured_at) : sources.context_as_of ?? null };
    }
    case "official": {
      const href = recordHref(locator.model, locator.id);
      const flags = sources.lead_flags?.get(`${locator.model}:${locator.id}`);
      const value = flags ? (locator.field_path === "booking" ? flags.booked : flags[locator.field_path as keyof LeadFlagsRow]) : undefined;
      return { ...base, availability: "retained", open: href ? { kind: "record", model: locator.model, id: locator.id, href } : null,
        text: flags ? `${OFFICIAL_LABELS[locator.field_path] ?? words(locator.field_path)}: ${value ? "yes" : "no"}` : null,
        record_label: "Official status", as_of: flags ? sources.as_of ?? null : null };
    }
    case "owner_correction": {
      const row = sources.instructions?.get(`${locator.instruction_id}:${locator.revision}`);
      return { ...base, availability: "retained", text: row ? correctionText(row) : null, open: null,
        record_label: "Owner correction", as_of: iso(row?.happened_at) };
    }
    case "analysis_transcript":
    case "analysis_record": {
      const run = sources.runs.get(locator.run_id);
      const row = sources.snapshots.get(locator.snapshot_id);
      const availability = run && (run.purged_at || run.purge_started_at) ? "purged" : retainedSnapshot(row);
      const inManifest = Boolean(run?.manifest_snapshot_ids?.some(id => String(id) === locator.snapshot_id));
      const summaryIds = arr(rec(run?.step_artifacts)?.summaries).map(String);
      const open = availability !== "retained" ? null : inManifest ? { kind: "analysis_evidence" as const, run_id: locator.run_id, snapshot_id: locator.snapshot_id }
        : summaryIds.includes(locator.snapshot_id) ? { kind: "summary_artifact" as const, snapshot_id: locator.snapshot_id } : null;
      const purgedAt = iso(row?.purged_at ?? row?.purge_started_at ?? run?.purged_at ?? run?.purge_started_at);
      if (locator.source === "analysis_record") {
        const records = arr(rec(rec(row?.response)?.page)?.records).flatMap(item => { const r = rec(item); return r ? [r] : []; });
        const record = availability === "retained" ? records.find(r => r.record_type === locator.record_type && r.record_id === locator.record_id) : undefined;
        const like: RecordLike | null = record ? { record_type: locator.record_type, record_id: locator.record_id, fields: rec(record.fields) ?? {} } : null;
        return { ...base, availability, open, text: like ? recordText(like) : null, purged_at: purgedAt,
          record_label: like ? recordLabel(like) : RECORD_LABELS[locator.record_type] ?? words(locator.record_type), as_of: like ? recordAsOf(like, row) : null };
      }
      const { segments, source } = availability === "retained" ? citedSegments(row, sources, locator.segment_ids) : { segments: [], source: null };
      const quote = clean(joinPresent(segments.map(s => str(s.text)), " "));
      const speakers = [...new Set(segments.map(s => str(s.speaker) ?? "unknown"))];
      const offset = segments.map(s => (typeof s.start_ms === "number" ? s.start_ms : null)).find(ms => ms !== null) ?? null;
      const started = callStart(sources, locator.conversation_id);
      return { ...base, availability, open, text: quote, quote, purged_at: purgedAt ?? iso(source?.purged_at ?? source?.purge_started_at),
        speaker: segments.length ? (speakers.length === 1 ? speakers[0] as "rep" | "customer" | "unknown" : "unknown") : null,
        at: started && offset !== null ? new Date(+new Date(started) + offset).toISOString() : null,
        conversation_id: locator.conversation_id, segment_ids: locator.segment_ids };
    }
  }
}

/**
 * Evidence section for a list of citations. `quotes` are the model's own retained quotes; they stand in only when the
 * transcript segments themselves are not loaded (the segment text is the source, the quote is the model's copy).
 */
export function evidenceSection(items: readonly EvidenceRefDto[], sources: EvidenceSources, options: { retention_pending?: boolean; quotes?: ReadonlyMap<string, string> } = {}): EvidenceSection {
  if (options.retention_pending) return evidenceSectionSchema.parse({ availability: "unavailable", items: [] });
  const unique = [...new Map(items.map(ref => [ref.id, ref])).values()];
  return evidenceSectionSchema.parse({ availability: "ready", items: unique.map(ref => {
    const resolved = resolveEvidence(ref, sources);
    const item = resolved.speaker !== undefined ? { ...resolved, speaker_label: resolved.speaker ? labelOf(PARTY_LABELS, resolved.speaker) : null } : resolved;
    const quote = clean(options.quotes?.get(ref.id));
    return item.availability === "retained" && item.text === null && quote ? { ...item, text: quote, ...(item.kind === "transcript_quote" ? { quote } : {}) } : item;
  }) });
}

// ---------------------------------------------------------------- summary & findings (legacy and structured runs)

export type EffectRow = { _id: unknown; finding_id: unknown; effect_kind: string; status: string; reason?: string | null; target_id?: unknown };
export type FollowupLite = { _id: unknown; kind: string; description: string; status: string; due_at?: Date | null };
export type ReviewItemRow = { _id: unknown; cause_kind: string; cause_key?: string | null; state: string; evidence_ids?: readonly unknown[] };
/** The `analysis.suggestion_applied` audit row for a run, joined to the follow-up the command created. */
export type AppliedSuggestion = { applied_at: Date | string | null; followup_id: string | null; followup_due_at?: Date | string | null };
export type RunPresentationInput = {
  run: RunRow;
  findings: readonly FindingRow[];
  effects: readonly EffectRow[];
  actions: readonly FollowupLite[];
  /** Rows for `step_artifacts.summaries`, any order; missing ids are simply absent. */
  summaries: readonly SnapshotRow[];
  /** Every snapshot any finding cites, for availability. */
  snapshots: ReadonlyMap<string, SnapshotRow>;
  retention_pending?: boolean;
  // Additive (data spec §6.11 B–C). Each is one batched read in `readRunPresentation`.
  /** Review items that name this run's findings, plus those `relations.ts` opened for its relations and discrepancies. */
  review_items?: readonly ReviewItemRow[];
  /** The earlier findings `output.prior_finding_relations` names. */
  prior_findings?: readonly FindingRow[];
  suggestion?: AppliedSuggestion | null;
  instructions?: readonly InstructionRow[];
  /** Conversations the findings and transcript citations belong to (`started_at`). */
  conversations?: readonly ConversationRow[];
  /** Source transcript snapshots (only the cited segments). */
  transcripts?: readonly TranscriptRow[];
};

// ---------------------------------------------------------------- finding presentation (data spec §6.5, §6.11 B)

const FINDING_CATEGORY_OF: Record<string, FindingCategory> = {
  promised_callback: "commitments", customer_requested_callback: "commitments", customer_will_call: "commitments", next_step: "commitments",
  reschedule: "commitments", completion_claim: "commitments", booking_claim: "booking_payment", payment_claim: "booking_payment",
  quoted_amount: "money", objection: "objections", competitor_mention: "objections", contact_restriction: "restrictions",
  move_fact: "move_facts", intent: "move_facts", contact_type: "call_type", coaching_note: "coaching",
};
export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = { commitments: "Commitments and next steps", booking_payment: "Booking and payment",
  money: "Money", objections: "Objections and competitors", restrictions: "Contact restrictions", move_facts: "Move facts", call_type: "Call type", coaching: "Coaching notes" };
/** Final spec §11.5 kind → category. Every one of the server's 16 kinds has a category. */
export const findingCategory = (kind: string): FindingCategory | null => FINDING_CATEGORY_OF[kind] ?? null;

/** `basis` first, then `actor`: `From Vantage records`, `Model inference`, `Customer said`, `Rep said`, `Speaker unknown`. */
export function findingSourceWord(basis: string, actor: string): string {
  if (basis === "vantage_record") return "From Vantage records";
  if (basis === "model_inference") return "Model inference";
  return actor === "customer" ? "Customer said" : actor === "rep" ? "Rep said" : "Speaker unknown";
}
const ACTION_STATUS_WORDS: Record<string, string> = { requested: "Requested", promised: "Promised", completed: "Completed", conditional: "Conditional" };
export const actionStatusWord = (status: string | null | undefined): string | null => (status ? ACTION_STATUS_WORDS[status] ?? words(status) : null);

const QUOTE_MEANING_LABELS: Record<string, string> = { quote_total: "quote total", deposit: "deposit", competitor_quote: "competitor quote", other: "other amount" };
const MOVE_FACT_LABELS: Record<string, string> = { origin: "Pickup", destination: "Delivery", move_date: "Move date", move_size: "Move size", other: "Other" };
const CONTACT_TYPE_LABELS: Record<string, string> = { human_conversation: "Human conversation", voicemail: "Voicemail", unknown: "Contact unknown" };
const INTENT_LABELS: Record<string, string> = { moving_inquiry: "Moving inquiry", service_request: "Service request", not_sales: "Not a sales call", unknown: "Intent unknown" };
export type FindingResolved = { due_at?: Date | string | null; amount_cents?: number | null } | null | undefined;
/**
 * The finding's value as one server-built line (final spec §11.5), or null when the claim says it all.
 * Times come from the server's `resolved` fields (America/New_York); model wording is quoted and marked unresolved.
 */
export function findingValueLine(finding: IntelligenceFinding, resolved: FindingResolved): string | null {
  const value = rec(finding.value) ?? {};
  switch (finding.kind) {
    case "promised_callback": case "customer_requested_callback": case "customer_will_call": case "next_step": case "completion_claim": case "reschedule": {
      const due = formatEtDateTime(resolved?.due_at);
      if (due) return `Due ${due}`;
      const said = clean(str(value.date_text));
      return said ? `Date said: "${said}" (not resolved)` : null;
    }
    case "quoted_amount": {
      const meaning = labelOf(QUOTE_MEANING_LABELS, value.meaning);
      if (typeof resolved?.amount_cents === "number") return `${formatCents(resolved.amount_cents)} · ${meaning}`;
      return `"${clean(str(value.amount_text)) ?? ""}" (amount unclear)`;
    }
    case "contact_restriction": {
      const channels = arr(value.channels);
      const what = channels.includes("call") && channels.includes("text") ? "calls or texts" : channels.includes("text") ? "texts" : "calls";
      if (value.restriction === "ongoing") return `No ${what} until further notice`;
      if (value.restriction === "until") {
        const day = formatEtDay(resolved?.due_at);
        if (day) return `No ${what} until ${day}`;
        const said = clean(str(value.until_text));
        return said ? `No ${what} until "${said}" (not resolved)` : `No ${what} (unclear)`;
      }
      return `No ${what} (unclear)`;
    }
    case "move_fact": return `${labelOf(MOVE_FACT_LABELS, value.field)}: ${clean(str(value.stated_value)) ?? ""}`;
    case "contact_type": return labelOf(CONTACT_TYPE_LABELS, value.type);
    case "intent": return labelOf(INTENT_LABELS, value.intent);
    default: return null;
  }
}

/** Reasons `relations.ts` gives the `open_review` effects it attaches to the NEW finding: bookkeeping, not this finding's work. */
export const RELATION_REVIEW_EFFECT_REASONS = ["prior_finding_contradicted", "prior_fulfilled_followup_open"] as const;
export const isRelationBookkeepingEffect = (effect: Pick<EffectRow, "effect_kind" | "reason">) => effect.effect_kind === "supersede"
  || (effect.effect_kind === "open_review" && (RELATION_REVIEW_EFFECT_REASONS as readonly string[]).includes(effect.reason ?? ""));
/**
 * Review causes that do not describe this finding's own work: `record_disputed_on_call` cites the first five findings of the run
 * (`relations.ts`), and the two relation causes are the review items of the dropped relation bookkeeping effects; they surface as
 * relations (`prior_finding_relations[].review_item_id`) instead.
 */
const NON_SPECIFIC_REVIEW_CAUSES = new Set(["record_disputed_on_call", "prior_contradiction", "prior_fulfilled_unclaimed"]);
const EFFECT_KIND_LABELS: Record<string, string> = { create_followup: "follow-up created", revise_followup: "follow-up rescheduled",
  complete_followup: "follow-up completed", cancel_followup: "follow-up cancelled", assign: "rep assigned", set_contact_type: "call type set",
  mark_meaningful_contact: "contact recorded", pause_channel: "contact paused", open_review: "review opened", open_number_review: "Number review opened" };
/** Effect reasons shown after `Blocked:` (`outreach/effects.ts`, `analysis/apply.ts`); unknown reasons read as their words. */
export const EFFECT_BLOCK_LABELS: Record<string, string> = {
  owner_instruction: "Your instruction on this work takes precedence", owner_contact_type: "You set the call type yourself",
  owner_assertion: "You corrected or retracted an earlier finding of this kind", closed_work_request: "The work is closed",
  event_identity: "The call is not tied to this customer", outreach_binding_unavailable: "No Outreach record to act on",
  live_binding_changed: "The Outreach record changed while the analysis ran", number_review_ineligible: "This Number cannot be opened for review",
};
export type WorkResultInput = {
  finding_id: string; review_state: string; superseded_by?: unknown;
  effects: readonly Pick<EffectRow, "effect_kind" | "status" | "reason" | "target_id">[];
  /** Open review items on the subject; only those naming this finding count. */
  review_items: readonly Pick<ReviewItemRow, "cause_kind" | "state" | "evidence_ids">[];
  /** Follow-ups the effects target (for `follow-up due …`). */
  actions?: readonly FollowupLite[];
};
/**
 * Data spec §6.5, pure. Relation bookkeeping effects are dropped first, so a finding never reads
 * `Applied → supersede`; then retracted › superseded › applied › blocked › needs review › not applicable.
 */
export function findingWorkResult(input: WorkResultInput): { work_result: WorkResult; work_result_detail: string | null } {
  const effects = input.effects.filter(effect => !isRelationBookkeepingEffect(effect));
  if (input.review_state === "retracted") return { work_result: "retracted", work_result_detail: null };
  if (input.superseded_by != null) return { work_result: "superseded", work_result_detail: String(input.superseded_by) };
  const applied = effects.find(effect => effect.status === "applied");
  if (applied) {
    const action = applied.target_id == null ? undefined : input.actions?.find(row => String(row._id) === String(applied.target_id));
    const due = action && ["create_followup", "revise_followup"].includes(applied.effect_kind) ? formatEtDateTime(action.due_at, { weekday: false }) : null;
    return { work_result: "applied", work_result_detail: action && ["create_followup", "revise_followup"].includes(applied.effect_kind)
      ? (due ? `follow-up due ${due}` : "follow-up with no due date") : labelOf(EFFECT_KIND_LABELS, applied.effect_kind) };
  }
  const blocked = effects.find(effect => effect.status.startsWith("blocked_"));
  if (blocked) return { work_result: "blocked", work_result_detail: blocked.reason ? labelOf(EFFECT_BLOCK_LABELS, blocked.reason) : null };
  const namesFinding = input.review_items.some(item => item.state === "open" && !NON_SPECIFIC_REVIEW_CAUSES.has(item.cause_kind)
    && (item.evidence_ids ?? []).some(id => String(id) === input.finding_id));
  if (effects.some(effect => effect.status === "needs_review") || namesFinding) return { work_result: "needs_review", work_result_detail: null };
  return { work_result: "not_applicable", work_result_detail: null };
}

const RELATION_WORDS: Record<string, string> = { superseded: "Replaced", fulfilled: "Done", contradicted: "Contradicted on a later call",
  still_true: "Still true", cannot_determine: "Unclear" };
const RELATION_REVIEW_CAUSE: Record<string, string> = { contradicted: "prior_contradiction", fulfilled: "prior_fulfilled_unclaimed" };
const ASSESSMENT_WORDS: Record<string, string> = { agrees: "Agrees", disagrees: "Disagrees", cannot_determine: "Cannot tell" };
const SUGGESTION_ACTION_LABELS: Record<string, string> = { call: "Call", text_customer_via_lead_message: "Text via Lead Message", send_estimate: "Send estimate",
  check_availability: "Check availability", review: "Review", wait: "Wait for the customer", reconcile_identity: "Reconcile identity", other: "Other" };
/** `story_event_id` is `{kind}:{id}` (`story/sources.ts`); the kind lets the admin link `Show in timeline`. */
export const storyEventKind = (storyEventId: string) => storyEventId.split(":")[0] ?? storyEventId;
export function runPipeline(run: Pick<RunRow, "analysis_pipeline">): "legacy" | "structured" | "unsupported" {
  return run.analysis_pipeline == null ? "legacy" : run.analysis_pipeline === STRUCTURED_ANALYSIS_PIPELINE ? "structured" : "unsupported";
}
const summarySections = (summary: Partial<Record<SummaryKey, unknown>>) => (Object.keys(SUMMARY_LABELS) as SummaryKey[])
  .flatMap(key => { const text = str(summary[key]); return text === null ? [] : [{ key, label: SUMMARY_LABELS[key], text }]; });
type RestoredSummary = { snapshot_id: string; row: SnapshotRow; summary: NonNullable<z.infer<typeof readContentSchema>["analysis_summary"]> };
/** Captured summary artifacts listed on the run, in `step_artifacts` order; purged or tampered rows are reported as missing. */
export function restoreRunSummaries(run: RunRow, rows: readonly SnapshotRow[]) {
  const ids = arr(rec(run.step_artifacts)?.summaries).map(String);
  const byId = new Map(rows.map(row => [String(row._id), row]));
  const restored: RestoredSummary[] = [], unavailable: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    const parsed = row && retainedSnapshot(row) === "retained" ? readContentSchema.safeParse(row.response) : null;
    if (row && parsed?.success && parsed.data.analysis_summary) restored.push({ snapshot_id: id, row, summary: parsed.data.analysis_summary });
    else unavailable.push(id);
  }
  return { ids, restored, unavailable };
}

/** (2)/(3) Legacy or structured run → one Summary & findings section, one Evidence section and Full output references. */
export function runPresentation(input: RunPresentationInput): RunPresentation {
  const { run } = input;
  const runId = String(run._id);
  const pipeline = runPipeline(run);
  const purged = Boolean(run.purged_at || run.purge_started_at);
  const envelope = run.output ? intelligenceEnvelopeSchema.safeParse(run.output) : null;
  const availability = purged ? "purged" : input.retention_pending ? "unavailable" : pipeline === "unsupported" ? "unsupported"
    : !envelope ? "unavailable" : !envelope.success ? "unsupported" : "ready";
  const source = { kind: pipeline === "structured" ? "structured_run" as const : "legacy_run" as const, id: runId, version: run.schema_version ?? null,
    generated_at: iso(run.completed_at), model_version: run.model_version ?? null, prompt_version: run.prompt_version ?? null };
  const scope = run.conversation_id ? "conversation" as const : "number" as const;
  const summaries = pipeline === "structured" && availability === "ready" ? restoreRunSummaries(run, input.summaries) : { ids: [], restored: [], unavailable: [] };
  const fullOutput: FullOutputRef[] = pipeline === "structured"
    ? [...summaries.ids.map((id, index): FullOutputRef => { const row = input.summaries.find(s => String(s._id) === id);
      return { kind: "conversation_summary", id, label: summaries.ids.length > 1 ? `Conversation summary ${index + 1}` : "Conversation summary",
        generated_at: iso(row?.retrieved_at), version: row?.content_digest ?? null, available: summaries.restored.some(s => s.snapshot_id === id) }; }),
    { kind: "findings", id: runId, label: "Findings output", generated_at: iso(run.completed_at), version: run.schema_version ?? null, available: availability === "ready" }]
    : [{ kind: "legacy_analysis", id: runId, label: "Analysis output", generated_at: iso(run.completed_at), version: run.schema_version ?? null, available: availability === "ready" }];
  const unavailableSections = (value: "unavailable" | "purged" | "unsupported") => runPresentationSchema.parse({ run_id: runId,
    full_output: fullOutput.map(ref => ({ ...ref, available: value === "unsupported" && ref.available })),
    evidence: { availability: value, items: [] },
    summary_findings: { availability: value, scope, source, summary: { sections: [], narrative: null }, said_on_call: [], findings: [], suggested_next_step: null, applied_actions: [] } });
  if (availability !== "ready" || !envelope?.success) return unavailableSections(availability === "ready" ? "unavailable" : availability);
  const output: IntelligenceEnvelope = envelope.data;
  // One captured summary for this run (a conversation analysis) is that call's own summary; a Number analysis over
  // several calls keeps its own Number-level summary. Purged captures fall back to the run's retained summary.
  const single = summaries.ids.length === 1 && summaries.restored.length === 1 ? summaries.restored[0]!.summary.summary : null;
  const summary = single ?? output.summary;
  const said = summaries.restored.flatMap((restored) => restored.summary.said_on_call.map((fact, index) => ({ index,
    call_index: summaries.ids.indexOf(restored.snapshot_id), kind: fact.kind, speaker: fact.speaker, text: fact.claim, segment_ids: fact.segment_ids })));
  const rows: readonly FindingRow[] = input.findings.filter(f => !f.purged_at && String(f.run_id ?? runId) === runId);
  const stored = rows.map(row => ({ row, parsed: intelligenceFindingSchema.safeParse(row.assertion) }));
  if (stored.some(item => !item.parsed.success)) return unavailableSections("unsupported");
  const findings = rows.length ? stored.map(({ row, parsed }) => ({ id: String(row._id), finding: parsed.data!, review_state: row.review_state }))
    : output.findings.map(finding => ({ id: `${runId}:${finding.key}`, finding, review_state: "unreviewed" }));
  const quotes = new Map<string, string>();
  const cited: EvidenceRefDto[] = [];
  const cite = (ref: IntelligenceEvidenceRef) => {
    const dto = envelopeEvidenceRef(runId, ref);
    if (ref.source === "transcript" && ref.quote) quotes.set(dto.id, ref.quote);
    cited.push(dto);
    return dto;
  };
  const conversations = new Map((input.conversations ?? []).map(row => [String(row._id), row] as const));
  const reviewItems = input.review_items ?? [];
  const rowById = new Map(rows.map(row => [String(row._id), row] as const));
  const findingDtos = findings.map(({ id, finding, review_state }) => {
    const row = rowById.get(id);
    const evidence = finding.evidence.map(cite);
    const effects = input.effects.filter(effect => String(effect.finding_id) === id);
    const category = findingCategory(finding.kind);
    const conversationId = row?.conversation_id != null ? String(row.conversation_id) : run.conversation_id != null ? String(run.conversation_id) : null;
    return { id, kind: finding.kind, claim: finding.claim, basis: finding.basis, actor: finding.actor, action_status: finding.action_status ?? null,
      clarity: finding.clarity, review_state, evidence,
      effects: effects.map(effect => ({ kind: effect.effect_kind, status: effect.status, reason: effect.reason ?? null, target_id: idOf(effect.target_id) })),
      source_word: findingSourceWord(finding.basis, finding.actor), action_status_word: actionStatusWord(finding.action_status),
      value_line: findingValueLine(finding, row?.resolved), ...(category ? { category, category_label: FINDING_CATEGORY_LABELS[category] } : {}),
      ...findingWorkResult({ finding_id: id, review_state, superseded_by: row?.superseded_by ?? null, effects, review_items: reviewItems, actions: input.actions }),
      superseded_by: idOf(row?.superseded_by), call_at: conversationId ? iso(conversations.get(conversationId)?.started_at) : null };
  });
  // Data spec §6.11 C: relations and story discrepancies joined to the prior findings and the review items `relations.ts` opened.
  const priorById = new Map((input.prior_findings ?? []).map(row => [String(row._id), row] as const));
  const byKey = new Map(findings.map(item => [item.finding.key, item] as const));
  const openedFor = (cause: string | undefined, key: string) => cause ? reviewItems.find(item => item.cause_kind === cause && item.cause_key === key) : undefined;
  const relations = (output.prior_finding_relations ?? []).map(relation => {
    const prior = priorById.get(relation.prior_finding_id);
    const priorClaim = prior && !prior.purged_at ? intelligenceFindingSchema.safeParse(prior.assertion) : null;
    const newer = relation.by_finding_key ? byKey.get(relation.by_finding_key) : undefined;
    const review = openedFor(RELATION_REVIEW_CAUSE[relation.relation], relation.prior_finding_id);
    return { prior_finding_id: relation.prior_finding_id, prior_claim: priorClaim?.success ? priorClaim.data.claim : null,
      prior_kind: priorClaim?.success ? priorClaim.data.kind : prior?.kind ?? null, relation: relation.relation, relation_word: RELATION_WORDS[relation.relation]!,
      group: relation.relation === "still_true" || relation.relation === "cannot_determine" ? "unchanged" as const : "changed" as const,
      by_finding_id: newer?.id ?? null, by_claim: newer?.finding.claim ?? null, note: clean(relation.note), evidence: relation.evidence.map(cite),
      review_item_id: review ? String(review._id) : null, review_item_state: review?.state ?? null };
  });
  const discrepancies = (output.story_discrepancies ?? []).map(item => {
    const review = openedFor("record_disputed_on_call", item.story_event_id);
    return { story_event_id: item.story_event_id, event_kind: storyEventKind(item.story_event_id), claim: item.claim, evidence: item.evidence.map(cite),
      review_item_id: review ? String(review._id) : null, review_item_state: review?.state ?? null };
  });
  const instructionRows = input.instructions ?? [];
  const instructionAssessments = output.owner_instruction_assessments.map(item => {
    const row = instructionRows.find(r => String(r.instruction_id) === item.instruction_id && r.revision === item.instruction_revision)
      ?? instructionRows.find(r => String(r.instruction_id) === item.instruction_id);
    return { instruction_id: item.instruction_id, instruction_revision: item.instruction_revision, instruction_text: row ? correctionText(row) : null,
      assessment: item.assessment, assessment_word: ASSESSMENT_WORDS[item.assessment]!, reason: clean(item.reason) ?? item.reason };
  });
  const summaryRefs: EvidenceRefDto[] = summaries.ids.map(id => {
    const row = input.summaries.find(s => String(s._id) === id);
    const transcript = rec(rec(row?.response)?.transcript);
    return { id: `summary:${id}`, kind: "summary_section", speaker: null, call_at: null, lineage: [],
      locator: { source: "summary_artifact", snapshot_id: id, content_digest: row?.content_digest ?? "", conversation_id: str(transcript?.conversation_id),
        transcript_version: str(transcript?.transcript_version), section: "summary" } };
  });
  const snapshots = new Map([...input.snapshots, ...input.summaries.map(row => [String(row._id), row] as const)]);
  const evidence = evidenceSection([...summaryRefs, ...cited], { snapshots, runs: new Map([[runId, run]]), conversations, findings: new Map(), leads: new Set(),
    transcripts: new Map((input.transcripts ?? []).map(row => [String(row._id), row] as const)) }, { quotes });
  const appliedTargets = new Set(input.effects.filter(effect => effect.status === "applied" && effect.target_id).map(effect => String(effect.target_id)));
  const next = output.next_step_suggestion;
  const applied = input.suggestion ?? null;
  return runPresentationSchema.parse({ run_id: runId, full_output: fullOutput, evidence,
    summary_findings: { availability: "ready", scope, source, summary: { sections: summarySections(summary), narrative: null }, said_on_call: said, findings: findingDtos,
      suggested_next_step: next ? { action_kind: next.action_kind, description: next.description, date_text: next.date_text, timezone_text: next.timezone_text,
        rationale: next.rationale, target_followup_id: next.target_followup_id, action_label: labelOf(SUGGESTION_ACTION_LABELS, next.action_kind),
        applied_at: iso(applied?.applied_at), followup_id: applied?.followup_id ?? null, followup_due_at: iso(applied?.followup_due_at) } : null,
      applied_actions: input.actions.filter(action => appliedTargets.has(String(action._id))).map(action => ({ id: String(action._id), kind: action.kind,
        description: action.description, status: action.status, due_at: iso(action.due_at) })),
      prior_finding_relations: relations, story_discrepancies: discrepancies, owner_instruction_assessments: instructionAssessments } });
}

/** (5) Full output for a run: its retained findings/legacy envelope, or one captured conversation summary. */
export function runFullOutput(input: Pick<RunPresentationInput, "run" | "summaries" | "retention_pending">, outputId: string): FullOutput | null {
  const { run } = input;
  const runId = String(run._id);
  const pipeline = runPipeline(run);
  const purged = Boolean(run.purged_at || run.purge_started_at);
  const blocked = purged ? "purged" as const : input.retention_pending ? "unavailable" as const : pipeline === "unsupported" ? "unsupported" as const : null;
  const details = { schema_version: run.schema_version ?? null, prompt_version: run.prompt_version ?? null, model_version: run.model_version ?? null };
  if (outputId === runId) {
    const served = !blocked && run.output != null;
    return fullOutputSchema.parse({ kind: pipeline === "structured" ? "findings" : "legacy_analysis", id: runId, version: run.schema_version ?? null,
      generated_at: iso(run.completed_at), availability: blocked ?? (served ? "ready" : "unavailable"), complete: served,
      // A legacy agent submitted the envelope itself. A structured run retains the provider's exact findings object in
      // `raw_output` (context provenance §2 R2); runs analysed before that landed have none and show the accepted envelope only.
      model_output: served && pipeline === "legacy" ? json(run.output) : served && run.raw_output != null ? json(run.raw_output) : null,
      accepted: served && pipeline === "structured" ? json(run.output) : null,
      details: { ...details, digests: served ? { output_digest: payloadHash(run.output) } : {} } });
  }
  if (pipeline !== "structured") return null;
  const summaries = restoreRunSummaries(run, input.summaries);
  if (!summaries.ids.includes(outputId)) return null;
  const restored = blocked ? null : summaries.restored.find(s => s.snapshot_id === outputId) ?? null;
  const row = input.summaries.find(s => String(s._id) === outputId);
  return fullOutputSchema.parse({ kind: "conversation_summary", id: outputId, version: row?.content_digest ?? null, generated_at: iso(row?.retrieved_at),
    availability: blocked ?? (restored ? "ready" : row && (row.purged_at || row.purge_started_at) ? "purged" : "unavailable"), complete: Boolean(restored),
    model_output: restored ? json(restored.summary) : null, accepted: null,
    details: { ...details, digests: row ? { content_digest: row.content_digest } : {} } });
}
