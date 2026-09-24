import type { ClientSession } from "mongoose";
import { jsonValue } from "../outreach/store";
import { subjectKey } from "../outreach/types";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";
import {
  assessmentLayoutFromFlag, assessmentStepContract, type AssessmentLayout, type EvidenceCatalogEntry, type EvidenceKind, type SourceManifestEntry,
} from "./contract";
import type { ReadContent } from "../analysis/reads";
import { selectPriorAnalyses } from "../analysis/prior";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { assembleCaseFile } from "../casefile/assemble";
import { CASE_FILE_TIMEZONE, type CaseFileInput, type RenderedCaseFile } from "../casefile/types";
import { moveViewsForLead, type MoveView, type MoveViews } from "./views";
import {
  mongoAssessmentReader, selectConversationSources, selectCorrections, selectRetainedFindings,
  MAX_ASSESSMENT_ENTRIES, type AssessmentReader, type LeadRow, type SelectedConversation,
} from "./sources";

/**
 * Subject-level assessment context (MA-01 §7). Resolves the subject, applies the cheap
 * pre-checks that must skip before any charge, freezes the evidence catalog and computes
 * the input fingerprint. Never reads Priority/Quoted, band, follow-ups, assignment, clocks
 * or the record's own `move_assessment` projection, so none of them can cause a refresh.
 */
export type AssessmentSkipReason = "skipped_no_summary" | "ambiguous_subject" | "not_applicable" | "excluded" | "evidence_limit_reached";
export type AssessmentSkip = { skip: AssessmentSkipReason; reason: string; subject_key: string; outreach_record_id: string };
export type AssessmentInputMode = "summaries" | "summaries_with_findings" | "lead_only";
type LeadRef = { model: "FormLead" | "CallLead"; id: string };
type PromptEntry = { id: string; text: string };
export type AssessmentPromptPayload = {
  subject: { kind: "lead" | "number_review"; lead_model: LeadRef["model"] | null; no_conversation_evidence: boolean };
  context_as_of: string;
  views: {
    original_ingestion: { label: string; evidence_status: string; captured_at: string | null; entries: PromptEntry[] } | null;
    canonical_current: { provenance_source: string | null; entries: PromptEntry[] } | null;
  };
  official: { entries: PromptEntry[] } | null;
  corrections: PromptEntry[];
  conversations: Array<{ call_at: string; entries: Array<{ id: string; kind: EvidenceKind; speaker: string; text: string }> }>;
  /** `restates` lists the catalog ids this finding repeats: the same observation, not a confirmation. */
  findings: Array<{ id: string; text: string; restates: string[] }>;
  /** Case File layout only (spec §4.10): the rendered Case File, audience "assessment". Absent (not null) under the legacy layout, so v1 payloads stay byte-identical. */
  case_file?: string;
};
export type AssessmentContext = {
  subject_key: string; outreach_record_id: string; contact_number_id: string | null; lead_ref: LeadRef | null;
  input_mode: AssessmentInputMode; catalog: EvidenceCatalogEntry[]; prompt_payload: AssessmentPromptPayload;
  fingerprint: string; source_manifest: SourceManifestEntry[]; context_as_of: Date; latest_conversation_at: Date | null;
  coverage: { conversations_available: number; conversations_selected: number; findings_selected: number; source_coverage: "complete" | "partial" | "none" };
  views: MoveViews | null;
  eligibility: { record_revision: number; record_state: string; closure_origin: string | null; disposition_revision: string | null };
  /** Decided once here (spec §4.10/§4.11); the step contract, prompt and validator follow it. */
  layout: AssessmentLayout;
  /** Case File layout only: what the run may record next to the artifact (size, digests, trimming). */
  case_file?: Pick<RenderedCaseFile, "bytes" | "digest" | "customer_evidence_digest" | "trimmed_steps" | "over_hard_budget">;
};
/** Seams for the Case File layout (tests inject both; production reads Mongo through `casefile/assemble.ts`). */
export type AssessmentContextDeps = {
  layout?: AssessmentLayout;
  caseFile?: (input: CaseFileInput) => Promise<{ rendered: RenderedCaseFile }>;
  prior?: (input: { contact_number_id: string; subject_key: string; outreach_record_id: string; as_of: Date }) => Promise<ReadContent | null>;
};
const defaultCaseFile = (input: CaseFileInput) => assembleCaseFile(input);
/** §6 for the assessment audience is the prior assessment only; the shared selection is reused, the builder renders only that record. */
async function defaultPrior(input: { contact_number_id: string; subject_key: string; outreach_record_id: string; as_of: Date }) {
  return selectPriorAnalyses({ ...input, exclude_conversation_id: null }, await readCaptureCoverage());
}
export type AssessmentContextInput = ({ outreach_record_id: string } | { subject_key: string }) & {
  /** Backfill Lead-only cohort, or the normal flow with MOVE_ASSESSMENT on. */
  allow_lead_only?: boolean; now?: Date;
};

const endpoint = (value: MoveView["pickup"]) => [value.city, value.state, value.zip].filter(Boolean).join(", ");
function viewEntries(view: MoveView, kind: "lead_current" | "lead_ingested", lead: LeadRef, prefix: string): EvidenceCatalogEntry[] {
  const fields: Array<[string, string | number | null]> = [
    ["pickup", endpoint(view.pickup) || null], ["delivery", endpoint(view.delivery) || null], ["move_date", view.move_date],
    ["move_size", view.move_size], ["granot_move_size", view.granot_move_size], ["cubic_feet", view.cubic_feet],
  ];
  const ingested = kind === "lead_ingested";
  return fields.flatMap(([field, value]) => value === null ? [] : [{
    id: `lead:${kind}:${field}`, kind, text: `${prefix} ${field}: ${value}`, lineage: [],
    locator: { source: "lead" as const, model: lead.model, id: lead.id, view: ingested ? "ingested" as const : "current" as const,
      field_path: ingested ? `ingested_move_snapshot.${field}` : field } }]);
}

export async function assembleAssessmentContext(input: AssessmentContextInput, session?: ClientSession,
  reader: AssessmentReader = mongoAssessmentReader(session), deps: AssessmentContextDeps = {}): Promise<AssessmentContext | AssessmentSkip> {
  // Read once per context, so the payload, fingerprint, step contract and validator of one run agree.
  const layout = deps.layout ?? assessmentLayoutFromFlag();
  const record = await reader.record("outreach_record_id" in input ? { id: input.outreach_record_id } : { subject_key: input.subject_key });
  if (!record) throw new CsiError("INVALID_INPUT");
  const subject_key = subjectKey(record.subject), outreach_record_id = String(record._id);
  const skip = (kind: AssessmentSkipReason, reason: string): AssessmentSkip => ({ skip: kind, reason, subject_key, outreach_record_id });
  // A Lead-only Outreach Record (no primary Contact Number yet) has no Number checks and no conversations:
  // it can only be assessed from its Lead views when the caller allows Lead-only work (§3, §9).
  const numberId = record.primary_contact_number_id ? String(record.primary_contact_number_id) : null;
  const number = numberId ? await reader.number(numberId) : null;
  if (numberId && !number) throw new CsiError("INVALID_INPUT");
  if (number && (number.kind !== "external" || ["company", "non_customer"].includes(number.classification))) return skip("excluded", `number_${number.kind}_${number.classification}`);
  if (number && (number.purged_at || number.content_purge_pending)) return skip("excluded", "number_content_purged");
  if (record.state === "closed") return skip("not_applicable", `closed_${record.closure_origin ?? "unknown"}`);
  if (record.state === "identity_review") return skip("ambiguous_subject", "identity_review");
  if (record.lead_attachment?.state === "ambiguous") return skip("ambiguous_subject", "lead_attachment_ambiguous");

  let leadRef: LeadRef | null = null, attachment: { attachment_id: string | null; state: string | null; revision: number | null } | null;
  if (record.subject.kind === "lead") {
    leadRef = { model: record.subject.model as LeadRef["model"], id: String(record.subject.id) };
    attachment = { attachment_id: record.lead_attachment?.attachment_id ? String(record.lead_attachment.attachment_id) : null,
      state: record.lead_attachment?.state ?? null, revision: record.lead_attachment_revision ?? null };
  } else {
    if (!numberId) return skip("excluded", "number_review_without_number");
    const attached = (await reader.attachments(numberId)).filter(edge => edge.state === "attached");
    if (attached.length > 1) return skip("ambiguous_subject", "multiple_attached_leads");
    const edge = attached[0];
    leadRef = edge ? { model: edge.lead_ref.model, id: String(edge.lead_ref.id) } : null;
    attachment = edge ? { attachment_id: String(edge._id), state: edge.state, revision: edge.revision } : null;
  }
  const lead: LeadRow | null = leadRef ? await reader.lead(leadRef) : null;
  if (leadRef && !lead) return skip("excluded", "lead_not_found");
  const views = lead && leadRef ? moveViewsForLead(lead, leadRef.model) : null;

  let conversations: SelectedConversation[], skipped: Array<{ conversation_id: string; reason: string }>;
  let findings: Awaited<ReturnType<typeof selectRetainedFindings>>, corrections: Awaited<ReturnType<typeof selectCorrections>>;
  try {
    ({ conversations, skipped } = numberId ? await selectConversationSources(numberId, { session, reader }) : { conversations: [], skipped: [] });
    if (!conversations.length && !(input.allow_lead_only && lead)) return skip("skipped_no_summary", "no_retained_summary");
    findings = await selectRetainedFindings(conversations, { session, reader });
    corrections = await selectCorrections([subject_key, ...(numberId ? [`number:${numberId}`] : []), ...conversations.map(c => `conversation:${c.conversation_id}`)], { session, reader });
  } catch (error) {
    if (error instanceof CsiError && error.code === "EVIDENCE_LIMIT_REACHED") return skip("evidence_limit_reached", "evidence_limit_reached");
    throw error;
  }

  const official = lead && leadRef ? { booked: Boolean(lead.booked), cancelled: Boolean(lead.cancelled), duplicate: Boolean(lead.duplicate),
    bad_lead: Boolean(lead.bad_lead), no_sync: Boolean(lead.no_sync), booking_ids: lead.booked ? [String(lead.booked)] : [] } : null;
  const ingested = views?.original_ingestion ?? null;
  const ingestedEntries = ingested && leadRef ? viewEntries(ingested, "lead_ingested", leadRef, `Original ingestion (${ingested.label})`) : [];
  const currentEntries = views && leadRef ? viewEntries(views.canonical_current, "lead_current", leadRef, "Current Lead") : [];
  const officialEntries: EvidenceCatalogEntry[] = official && leadRef ? (["booked", "cancelled", "duplicate", "bad_lead", "no_sync"] as const)
    .map(field => ({ id: `official:${field}`, kind: "official_state" as const, text: `Official Lead ${field}: ${official[field] ? "yes" : "no"}`,
      lineage: [], locator: { source: "official" as const, model: leadRef.model, id: leadRef.id, field_path: field } })) : [];
  const conversationEntries = conversations.flatMap(c => c.entries);
  const order = new Map(conversations.map((c, index) => [c.conversation_id, index]));
  const findingEntries = [...findings.entries].sort((a, b) => (a.locator.source === "finding" && b.locator.source === "finding"
    ? (order.get(a.locator.conversation_id) ?? 0) - (order.get(b.locator.conversation_id) ?? 0) : 0) || a.id.localeCompare(b.id));
  const provisional = [...ingestedEntries, ...currentEntries, ...officialEntries, ...corrections.map(c => c.entry), ...conversationEntries, ...findingEntries];
  if (provisional.length > MAX_ASSESSMENT_ENTRIES) return skip("evidence_limit_reached", "evidence_limit_reached");
  const ids = new Map(provisional.map((entry, index) => [entry.id, `e${index + 1}`]));
  const renumber = (entry: EvidenceCatalogEntry): EvidenceCatalogEntry =>
    ({ ...entry, id: ids.get(entry.id)!, lineage: entry.lineage.map(id => ids.get(id) ?? id) });
  const catalog = provisional.map(renumber);
  const cited = (entries: EvidenceCatalogEntry[]) => entries.map(entry => ({ id: ids.get(entry.id)!, text: entry.text }));

  const source_manifest: SourceManifestEntry[] = [
    ...conversations.map(c => c.source), ...findings.manifest, ...corrections.map(c => c.manifest),
    ...(views && leadRef ? [{ kind: "lead" as const, id: leadRef.id, version: payloadHash(jsonValue(views)) }] : []),
    ...(official && leadRef ? [{ kind: "official" as const, id: leadRef.id, version: payloadHash(jsonValue(official)) }] : []),
  ].sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  const contract = assessmentStepContract(layout);
  const now = input.now ?? new Date();
  // Case File layout (spec §4.10): the full file, audience "assessment", with each summarized call's catalog lines
  // (renumbered ids) rendered under it. Only its customer-evidence digest (§2 + the §4 call summaries) enters the
  // fingerprint, never the §3 Granot or §5 Outreach text, so neither can refresh an assessment.
  let caseFile: RenderedCaseFile | null = null;
  if (layout === "case_file") {
    const evidence_lines: Record<string, Array<{ id: string; text: string }>> = {};
    for (const c of conversations) evidence_lines[c.conversation_id] = c.entries.map(entry => ({ id: ids.get(entry.id)!, text: entry.text }));
    const prior = numberId ? await (deps.prior ?? defaultPrior)({ contact_number_id: numberId, subject_key, outreach_record_id, as_of: now }) : null;
    ({ rendered: caseFile } = await (deps.caseFile ?? defaultCaseFile)({
      contact_number_id: numberId, e164: null, lead_refs: leadRef ? [leadRef] : [], outreach_record_ids: [outreach_record_id],
      conversation_ids: conversations.map(c => c.conversation_id),
      // The newest selected call is "this run"; the rest are context at their tier.
      focus_conversation_ids: conversations.length ? [conversations.at(-1)!.conversation_id] : [],
      summaries: new Map(), prior, as_of: now, timezone: CASE_FILE_TIMEZONE, audience: "assessment", evidence_lines,
    }));
  }
  const fingerprint = payloadHash(jsonValue({
    contract: { schema_version: contract.schema_version, rubric_version: contract.rubric_version, prompt_digest: contract.prompt_digest, schema_digest: contract.schema_digest },
    sources: source_manifest,
    views: { original_ingestion: views?.original_ingestion ?? null, canonical_current: views?.canonical_current ?? null },
    official, attachment,
    corrections: corrections.map(c => ({ id: c.manifest.id, revision: c.entry.locator.revision })),
    ...(caseFile ? { case_file_customer_evidence: caseFile.customer_evidence_digest } : {}),
  }));

  const latest = conversations.at(-1)?.call_at ?? null;
  const lead_only = conversations.length === 0;
  const prompt_payload: AssessmentPromptPayload = {
    subject: { kind: record.subject.kind, lead_model: leadRef?.model ?? null, no_conversation_evidence: lead_only },
    context_as_of: now.toISOString(),
    views: {
      original_ingestion: ingested ? { label: ingested.label, evidence_status: ingested.evidence_status, captured_at: ingested.captured_at, entries: cited(ingestedEntries) } : null,
      canonical_current: views ? { provenance_source: views.canonical_current.provenance?.source_system ?? null, entries: cited(currentEntries) } : null,
    },
    official: official ? { entries: cited(officialEntries) } : null,
    corrections: cited(corrections.map(c => c.entry)),
    conversations: conversations.map(c => ({ call_at: c.call_at,
      entries: c.entries.map(entry => ({ id: ids.get(entry.id)!, kind: entry.kind, speaker: entry.speaker ?? "unknown", text: entry.text })) })),
    findings: findingEntries.map(entry => ({ id: ids.get(entry.id)!, text: entry.text, restates: entry.lineage.map(id => ids.get(id) ?? id) })),
    ...(caseFile ? { case_file: caseFile.text } : {}),
  };
  const available = conversations.length + skipped.length;
  return {
    subject_key, outreach_record_id, contact_number_id: numberId, lead_ref: leadRef,
    input_mode: lead_only ? "lead_only" : findings.entries.length ? "summaries_with_findings" : "summaries",
    catalog, prompt_payload, fingerprint, source_manifest, context_as_of: now, latest_conversation_at: latest ? new Date(latest) : null,
    coverage: { conversations_available: available, conversations_selected: conversations.length, findings_selected: findings.entries.length,
      source_coverage: !conversations.length ? "none" : skipped.length ? "partial" : "complete" },
    views,
    eligibility: { record_revision: record.revision, record_state: record.state, closure_origin: record.closure_origin ?? null,
      disposition_revision: record.lead_progress?.disposition_revision ?? null },
    layout,
    ...(caseFile ? { case_file: { bytes: caseFile.bytes, digest: caseFile.digest, customer_evidence_digest: caseFile.customer_evidence_digest,
      trimmed_steps: caseFile.trimmed_steps, over_hard_budget: caseFile.over_hard_budget } } : {}),
  };
}
