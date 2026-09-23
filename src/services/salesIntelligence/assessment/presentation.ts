import { z } from "zod";
import { intelligenceEnvelopeSchema, intelligenceFindingSchema, type IntelligenceEnvelope, type IntelligenceEvidenceRef } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { readContentSchema } from "../analysis/reads";
import { payloadHash } from "../transactions";
import { TERMINAL_DISPOSITIONS, type Disposition } from "../outreach/leadProgress";
import {
  assessmentSectionSchema, assessmentVersionSchema, evidenceLocatorDtoSchema, evidenceRefDtoSchema, evidenceSectionSchema, fullOutputSchema,
  inventoryItemDtoSchema, moveViewDtoSchema, observationDtoSchema, outreachMoveAssessmentDtoSchema, runPresentationSchema, scoreDtoSchema,
  sourceManifestEntryDtoSchema, summaryFindingsSectionSchema, conflictDtoSchema, engagementDtoSchema, type EngagementDto,
  type AssessmentApplicability, type AssessmentAvailability, type AssessmentSection, type AssessmentVersion, type EvidenceItemDto, type EvidenceRefDto,
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
 * `outreach.move_assessment` for a record: applicability first, then the stored projection, then a
 * queued job (`pending`). Returns null for Not assessed so older rows and unassessed rows read alike.
 */
export function moveAssessmentProjectionDto(record: ApplicabilityInput & { move_assessment?: ProjectionRow | null }, pending = false): OutreachMoveAssessmentDto | null {
  const applicability = assessmentApplicability(record);
  const projection = record.move_assessment ?? null;
  if (!projection && applicability === "active" && !pending) return null;
  const actionable = applicability === "active" && Boolean(projection && SCORED_STATUSES.has(projection.status));
  const status: AssessmentAvailability = applicability !== "active" ? "not_applicable"
    : projection ? (projection.status as AssessmentAvailability) : "pending";
  return outreachMoveAssessmentDtoSchema.parse({
    artifact_id: idOf(projection?.artifact_id), status, applicability,
    transaction_intent: actionable ? projection?.transaction_intent ?? null : null,
    move_likelihood: actionable ? projection?.move_likelihood ?? null : null,
    transaction_intent_confidence: actionable ? confidenceOf(projection?.transaction_intent_confidence) : null,
    move_likelihood_confidence: actionable ? confidenceOf(projection?.move_likelihood_confidence) : null,
    context_as_of: iso(projection?.context_as_of), latest_conversation_at: iso(projection?.latest_conversation_at),
    stale: applicability === "active" && Boolean(projection?.stale), stale_reason: applicability === "active" ? projection?.stale_reason ?? null : null,
    published_at: iso(projection?.published_at),
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
  engagement?: unknown; engagement_effects?: unknown;
  purged_at?: Date | null; purge_started_at?: Date | null; createdAt?: Date | null;
};
export type SectionContext = {
  applicability: AssessmentApplicability;
  /** The Outreach projection when it points at this artifact; carries freshness. */
  projection?: ProjectionRow | null;
  current: boolean;
  /** `ContactNumber.content_purge_pending` for the subject's Number. */
  retention_pending?: boolean;
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
function emptyScore(availability: AssessmentAvailability, context: Pick<SectionContext, "applicability"> & { stale?: boolean; stale_reason?: string | null }): ScoreDto {
  return { score: null, level: null, label: scoreLabel(null, availability, context.applicability), confidence: null, rationale: null, conditions: [], evidence: [],
    stale: context.stale ?? false, stale_reason: context.stale_reason ?? null, applicability: context.applicability };
}
function dimension(raw: unknown, availability: AssessmentAvailability, context: SectionContext & { stale: boolean; stale_reason: string | null }): ScoreDto {
  const row = rec(raw);
  if (!row) return emptyScore(availability, context);
  const score = typeof row.score === "number" ? row.score : null;
  return scoreDtoSchema.parse({ score, level: row.level ?? null, label: scoreLabel(score, availability, context.applicability),
    confidence: row.confidence ?? null, rationale: str(row.rationale), conditions: arr(row.conditions).map(String), evidence: refs(row.evidence),
    stale: context.stale, stale_reason: context.stale_reason, applicability: context.applicability });
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

function engagementDto(raw: unknown, effectsRaw: unknown): EngagementDto | undefined {
  const row = rec(raw);
  if (!row) return undefined;
  const fx = rec(effectsRaw);
  return engagementDtoSchema.parse({
    work_status: row.work_status, rationale: str(row.rationale) ?? "", evidence: refs(row.evidence),
    promised_callbacks: arr(row.promised_callbacks).map(item => { const r = rec(item) ?? {}; return { by: r.by, raw_text: r.raw_text, date: str(r.date), time_text: str(r.time_text), status: r.status, evidence: refs(r.evidence) }; }),
    next_steps: arr(row.next_steps).map(item => { const r = rec(item) ?? {}; return { action: r.action, owner: r.owner, description: r.description, date: str(r.date), date_text: str(r.date_text), status: r.status, evidence: refs(r.evidence) }; }),
    effects: fx ? { applied: Boolean(fx.applied), mark_worked: Boolean(fx.mark_worked), blocked: str(fx.blocked), followup_ids: arr(fx.followup_ids).map(String),
      followups: arr(fx.followups).map(item => { const r = rec(item) ?? {}; return { kind: String(r.kind), origin: String(r.origin), description: String(r.description ?? ""), source: String(r.source) }; }),
      skipped: arr(fx.skipped).map(item => { const r = rec(item) ?? {}; return { source: String(r.source), index: Number(r.index ?? 0), reason: String(r.reason) }; }) } : null,
  });
}

/** (1) Stored artifact → `AssessmentSection`. Content is only served for ready / insufficient-evidence artifacts. */
export function assessmentSection(artifact: ArtifactRow, context: SectionContext): AssessmentSection {
  const availability = artifactAvailability(artifact, context.retention_pending);
  const projection = context.current ? context.projection ?? null : null;
  const freshness = { stale: context.applicability === "active" && Boolean(projection?.stale), stale_reason: context.applicability === "active" ? projection?.stale_reason ?? null : null };
  const header = {
    artifact_id: String(artifact._id), schema_version: artifact.schema_version, rubric_version: artifact.rubric_version, model_version: artifact.model_version,
    generated_at: iso(artifact.generated_at), context_as_of: iso(artifact.context_as_of), latest_conversation_at: iso(artifact.latest_conversation_at),
    input_mode: artifact.input_mode ?? null, shadow: Boolean(artifact.shadow), current: context.current,
  };
  const empty = (value: AssessmentAvailability): AssessmentSection => assessmentSectionSchema.parse({ ...header, availability: value,
    transaction_intent: emptyScore(value, { ...context, ...freshness }), move_likelihood: emptyScore(value, { ...context, ...freshness }),
    views: { original_ingestion: null, canonical_current: null, customer_stated: [] },
    inventory: { items: [], coverage: null, limitations: [], source_coverage: null }, conflicts: [], coverage: null, source_manifest: [] });
  if (!SCORED_STATUSES.has(availability)) return empty(availability);
  try {
    const scores = rec(artifact.scores) ?? {}, views = rec(artifact.views) ?? {}, inventory = rec(artifact.inventory) ?? {}, coverage = rec(artifact.coverage);
    const scoreContext = { ...context, ...freshness };
    return assessmentSectionSchema.parse({ ...header, availability,
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
  } catch (error) {
    if (error instanceof z.ZodError) return empty("unsupported");
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
  purged_at?: Date | null; purge_started_at?: Date | null; manifest_snapshot_ids?: readonly unknown[];
};
export type FindingRow = { _id: unknown; run_id?: unknown; revision: number; assertion: unknown; review_state: string; purged_at?: Date | null; conversation_id?: unknown };
export type ConversationRow = { _id: unknown; summary?: unknown; content_purged_at?: Date | null };
/** Loaded sources an assessment's citations point at. Maps are keyed by string id. */
export type EvidenceSources = {
  snapshots: ReadonlyMap<string, SnapshotRow>;
  runs: ReadonlyMap<string, RunRow>;
  conversations: ReadonlyMap<string, ConversationRow>;
  findings: ReadonlyMap<string, FindingRow>;
  /** `${model}:${id}` of Leads that still exist. */
  leads: ReadonlySet<string>;
};

const SUMMARY_LABELS = { overview: "Overview", customer_wanted: "What the customer wanted", money_and_dates: "Money and dates",
  outcome: "Outcome", commitments: "Commitments", discrepancies: "Discrepancies" } as const;
type SummaryKey = keyof typeof SUMMARY_LABELS;
const CONVERSATION_SECTION: Record<string, string> = { overview: "overview", customer_wanted: "customer_wanted", money_dates: "money_dates",
  outcome: "outcome", promised: "promised", mismatch: "mismatch" };

/** Same hrefs `toOutreachDto` builds for related records. */
export function recordHref(model: string, id: string): string | null {
  const path = model === "FormLead" ? "form-leads" : model === "CallLead" ? "call-leads" : model === "BookedLead" ? "bookings" : model === "CancelledLead" ? "cancellations" : null;
  return path ? `/${path}?record=${id}&database_scope=production` : null;
}
const retainedSnapshot = (row: SnapshotRow | undefined): "retained" | "purged" | "missing" =>
  !row ? "missing" : row.purged_at || row.purge_started_at ? "purged" : payloadHash(row.response) === row.content_digest ? "retained" : "missing";
function summaryArtifactText(row: SnapshotRow, section: string): string | null {
  const summary = rec(rec(row.response)?.analysis_summary);
  if (!summary) return null;
  const said = /^said_on_call\.(\d+)$/.exec(section), move = /^move_evidence\.(\d+)$/.exec(section);
  if (said) return str(rec(arr(summary.said_on_call)[Number(said[1])])?.claim);
  if (move) { const entry = arr(summary.move_evidence)[Number(move[1])]; return str(entry) ?? str(rec(entry)?.text) ?? str(rec(entry)?.claim); }
  return str(rec(summary.summary)?.[section]);
}

/** (4) Resolve one citation into an evidence item with retention-aware availability and an open target. */
export function resolveEvidence(ref: EvidenceRefDto, sources: EvidenceSources): EvidenceItemDto {
  const base = { id: ref.id, kind: ref.kind, source: ref.locator };
  const locator = ref.locator;
  switch (locator.source) {
    case "summary_artifact": {
      const row = sources.snapshots.get(locator.snapshot_id);
      let availability = retainedSnapshot(row);
      if (availability === "retained" && row!.content_digest !== locator.content_digest) availability = "missing";
      return { ...base, availability, text: availability === "retained" ? summaryArtifactText(row!, locator.section) : null,
        open: availability === "retained" ? { kind: "summary_artifact", snapshot_id: locator.snapshot_id } : null };
    }
    case "legacy_run": {
      const run = sources.runs.get(locator.run_id);
      const availability = !run ? "missing" : run.purged_at || run.purge_started_at ? "purged" : run.output && payloadHash(run.output) === locator.output_digest ? "retained" : "missing";
      return { ...base, availability, text: availability === "retained" ? str(rec(rec(run!.output)?.summary)?.[locator.section]) : null,
        open: availability === "retained" ? { kind: "analysis_run", run_id: locator.run_id } : null };
    }
    case "conversation_summary": {
      const conversation = sources.conversations.get(locator.conversation_id);
      const summary = rec(conversation?.summary);
      const availability = !conversation || !summary ? "missing" : conversation.content_purged_at ? "purged" : payloadHash(summary) === locator.text_digest ? "retained" : "missing";
      const text = locator.section === "text" ? str(summary?.text) : str(rec(summary?.sections)?.[CONVERSATION_SECTION[locator.section] ?? ""]);
      return { ...base, availability, text: availability === "retained" ? text : null, open: null };
    }
    case "finding": {
      const finding = sources.findings.get(locator.finding_id);
      const availability = !finding ? "missing" : finding.purged_at ? "purged" : finding.revision === locator.revision ? "retained" : "partial";
      return { ...base, availability, text: finding && !finding.purged_at ? str(rec(finding.assertion)?.claim) : null,
        open: finding && !finding.purged_at ? { kind: "analysis_run", run_id: locator.run_id } : null };
    }
    case "lead": {
      const exists = sources.leads.has(`${locator.model}:${locator.id}`);
      const href = recordHref(locator.model, locator.id);
      return { ...base, availability: exists ? "retained" : "missing", text: null,
        open: exists && href ? { kind: "record", model: locator.model, id: locator.id, href } : null };
    }
    case "official": {
      const href = recordHref(locator.model, locator.id);
      return { ...base, availability: "retained", text: null, open: href ? { kind: "record", model: locator.model, id: locator.id, href } : null };
    }
    case "owner_correction":
      return { ...base, availability: "retained", text: null, open: null };
    case "analysis_transcript":
    case "analysis_record": {
      const run = sources.runs.get(locator.run_id);
      const row = sources.snapshots.get(locator.snapshot_id);
      const availability = run && (run.purged_at || run.purge_started_at) ? "purged" : retainedSnapshot(row);
      const inManifest = Boolean(run?.manifest_snapshot_ids?.some(id => String(id) === locator.snapshot_id));
      const summaryIds = arr(rec(run?.step_artifacts)?.summaries).map(String);
      const open = availability !== "retained" ? null : inManifest ? { kind: "analysis_evidence" as const, run_id: locator.run_id, snapshot_id: locator.snapshot_id }
        : summaryIds.includes(locator.snapshot_id) ? { kind: "summary_artifact" as const, snapshot_id: locator.snapshot_id } : null;
      return { ...base, availability, text: null, open };
    }
  }
}

/** Evidence section for a list of citations. Quotes already retained in findings are attached by the caller through `quotes`. */
export function evidenceSection(items: readonly EvidenceRefDto[], sources: EvidenceSources, options: { retention_pending?: boolean; quotes?: ReadonlyMap<string, string> } = {}): EvidenceSection {
  if (options.retention_pending) return evidenceSectionSchema.parse({ availability: "unavailable", items: [] });
  const unique = [...new Map(items.map(ref => [ref.id, ref])).values()];
  return evidenceSectionSchema.parse({ availability: "ready", items: unique.map(ref => {
    const item = resolveEvidence(ref, sources);
    const quote = options.quotes?.get(ref.id);
    return item.availability === "retained" && item.text === null && quote ? { ...item, text: quote } : item;
  }) });
}

// ---------------------------------------------------------------- summary & findings (legacy and structured runs)

export type EffectRow = { _id: unknown; finding_id: unknown; effect_kind: string; status: string; reason?: string | null; target_id?: unknown };
export type FollowupLite = { _id: unknown; kind: string; description: string; status: string; due_at?: Date | null };
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
};
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
  const findingDtos = findings.map(({ id, finding, review_state }) => {
    const evidence = finding.evidence.map(ref => {
      const dto = envelopeEvidenceRef(runId, ref);
      if (ref.source === "transcript" && ref.quote) quotes.set(dto.id, ref.quote);
      cited.push(dto);
      return dto;
    });
    return { id, kind: finding.kind, claim: finding.claim, basis: finding.basis, actor: finding.actor, action_status: finding.action_status ?? null,
      clarity: finding.clarity, review_state, evidence,
      effects: input.effects.filter(effect => String(effect.finding_id) === id).map(effect => ({ kind: effect.effect_kind, status: effect.status,
        reason: effect.reason ?? null, target_id: idOf(effect.target_id) })) };
  });
  const summaryRefs: EvidenceRefDto[] = summaries.ids.map(id => {
    const row = input.summaries.find(s => String(s._id) === id);
    const transcript = rec(rec(row?.response)?.transcript);
    return { id: `summary:${id}`, kind: "summary_section", speaker: null, call_at: null, lineage: [],
      locator: { source: "summary_artifact", snapshot_id: id, content_digest: row?.content_digest ?? "", conversation_id: str(transcript?.conversation_id),
        transcript_version: str(transcript?.transcript_version), section: "summary" } };
  });
  const snapshots = new Map([...input.snapshots, ...input.summaries.map(row => [String(row._id), row] as const)]);
  const evidence = evidenceSection([...summaryRefs, ...cited], { snapshots, runs: new Map([[runId, run]]), conversations: new Map(), findings: new Map(), leads: new Set() }, { quotes });
  const appliedTargets = new Set(input.effects.filter(effect => effect.status === "applied" && effect.target_id).map(effect => String(effect.target_id)));
  const next = output.next_step_suggestion;
  return runPresentationSchema.parse({ run_id: runId, full_output: fullOutput, evidence,
    summary_findings: { availability: "ready", scope, source, summary: { sections: summarySections(summary), narrative: null }, said_on_call: said, findings: findingDtos,
      suggested_next_step: next ? { action_kind: next.action_kind, description: next.description, date_text: next.date_text, timezone_text: next.timezone_text,
        rationale: next.rationale, target_followup_id: next.target_followup_id } : null,
      applied_actions: input.actions.filter(action => appliedTargets.has(String(action._id))).map(action => ({ id: String(action._id), kind: action.kind,
        description: action.description, status: action.status, due_at: iso(action.due_at) })) } });
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
