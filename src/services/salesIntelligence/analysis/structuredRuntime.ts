import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { authorizeCsiRun, issueCsiRunToken, CsiError } from "../auth";
import { checkpointCsiJob, renewCsiJob, type JobLease } from "../jobs";
import { payloadHash } from "../transactions";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { jsonValue } from "../outreach/store";
import { readIntelligenceEvidence, loadReadScope, type ReadContent } from "./reads";
import { intelligenceReadSchema } from "./contracts";
import { loadAuthorizedRun } from "./lease";
import { submitIntelligenceAnalysis } from "./submit";
import { correctionContextSchema, retainedOriginal } from "./ownerReanalysis";
import { assembleContextPage, findSummaryArtifact, findRunArtifact, persistAnalysisArtifact, restoreAnalysisArtifact } from "./structuredArtifacts";
import { summaryGenerationSchema, minimalFindingsSchema, validateSummaryStep, expandStructuredFindings,
  structuredInstructions, type StructuredCall } from "./structuredContract";
import { SUMMARY_PROMPT_VERSION, SUMMARY_PROMPT, FINDINGS_PROMPT, structuredStepContracts } from "./structuredPrompt";
import { generateStructuredStep, STRUCTURED_INVOCATION_MS, type StepPricing } from "./structuredGeneration";
import type { InvocationInput } from "./runtime";
import { readStructuredIdentities } from "./structuredIdentity";
import { modelEvidence } from "./modelEvidence";
import type { CapturedPromptPage } from "./prompt";
import { selectPriorAnalyses } from "./prior";
import { assembleSubjectStory } from "../story/assemble";
import { storyToReadContent } from "../story/page";
import { nominateMoveAssessmentForNumber } from "../assessment/runtime";

export const STRUCTURED_LEASE_MS = 660_000;
type StructuredInput = InvocationInput & { lease: JobLease; pricing: StepPricing; source_ids: string[]; original_run_id?: string };

const recordsOf = (page: CapturedPromptPage | undefined, type: ReadContent["page"]["records"][number]["record_type"]) =>
  page?.data.page.records.filter(record => record.record_type === type) ?? [];

/**
 * The story and prior pages as the findings model reads them (context provenance §5.4): indexed
 * lists the model cites by index, resolved back to record ids by the server. `context.records`
 * stays the base page only, so nothing is sent twice.
 */
export function storyPromptBlock(story: CapturedPromptPage | undefined) {
  if (!story) return null;
  const events = recordsOf(story, "story_event");
  return { as_of: story.data.story?.as_of ?? null, opening: story.data.story?.opening ?? null,
    events: events.map((record, index) => ({ index, id: record.record_id, at: record.fields.happened_at ?? null, sentence: record.fields.description ?? null })),
    tail: story.data.story?.tail ?? null, coverage: story.data.story?.coverage ?? null,
    granot_state: recordsOf(story, "granot_state").map(record => ({ id: record.record_id, ...record.fields })),
    candidates: story.data.story?.candidates ?? [], truncated: story.data.page.missing_ranges };
}
export function priorPromptBlock(prior: CapturedPromptPage | undefined) {
  if (!prior) return null;
  const summaries = recordsOf(prior, "prior_summary");
  return { summaries: summaries.filter(r => r.fields.kind !== "number_synthesis").map((record, index) => ({ index, id: record.record_id, ...record.fields })),
    number_synthesis: summaries.filter(r => r.fields.kind === "number_synthesis").map(record => ({ id: record.record_id, ...record.fields })),
    findings: recordsOf(prior, "prior_finding").map((record, index) => ({ index, id: record.record_id, ...record.fields })),
    assessment: recordsOf(prior, "prior_assessment").map(record => ({ id: record.record_id, ...record.fields })),
    truncated: prior.data.page.missing_ranges };
}

/** Fixed server-owned steps. No MCP client and no model-selected tools or remote submission. */
export async function invokeStructuredAnalysis(input: StructuredInput) {
  const { createGateway } = await import("@ai-sdk/gateway");
  const deadline = Date.now() + STRUCTURED_INVOCATION_MS;
  const model = input.model ?? createGateway({ apiKey: input.gateway_key })(input.model_id);
  const authorize = async () => {
    await renewCsiJob(input.lease, STRUCTURED_LEASE_MS);
    const token = await issueCsiRunToken(input.run_id, input.lease, STRUCTURED_LEASE_MS / 1000);
    return authorizeCsiRun({ runId: input.run_id, token, tool: "submit_intelligence_analysis" });
  };
  let auth = await authorize();
  const run = await loadAuthorizedRun(auth);
  if (payloadHash(run.step_contracts) !== payloadHash(structuredStepContracts())) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const beforeProvider = async () => { await input.beforeProvider(); auth = await authorize(); };
  const generate = <T>(args: Pick<Parameters<typeof generateStructuredStep<T>>[0], "kind" | "key" | "schema" | "system" | "prompt" | "validate">) =>
    generateStructuredStep({ ...args, lease: input.lease, run_id: input.run_id, model, model_id: input.model_id,
      pricing: input.pricing, deadline, beforeProvider });
  const calls: StructuredCall[] = [];
  let context: CapturedPromptPage | undefined, story: CapturedPromptPage | undefined, prior: CapturedPromptPage | undefined;

  if (input.original_run_id) {
    const original = await retainedOriginal(input.original_run_id);
    for (const row of original.snapshots) {
      const old = restoreAnalysisArtifact(row);
      // Rows are routed by their stored kind; a parent analysed before the story/prior pages existed
      // replays without them, exactly as it was asked.
      const kind = row.source_type === "story" || row.source_type === "prior" ? row.source_type : old.data.analysis_summary ? "summary" : "context";
      const copy = await persistAnalysisArtifact(auth, { kind, key: `original:${row._id}`, data: old.data, retrieved_at: row.retrieved_at });
      if (kind === "summary" && copy.data.analysis_summary) calls.push({ ...copy, summary: copy.data.analysis_summary, speaker_refs: copy.data.speaker_refs });
      else if (kind === "story") story = copy;
      else if (kind === "prior") prior = copy;
      else if (row.source_type === "context") context = copy;
    }
    if (!calls.length || !context) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  } else {
    const scope = await loadReadScope(run), coverage = await readCaptureCoverage();
    // The same scope and coverage watermark feed all reads in this invocation.
    const read = (raw: unknown) => readIntelligenceEvidence(scope, intelligenceReadSchema.parse(raw), coverage);
    const base = await readIntelligenceEvidence(scope, { tool: "get_intelligence_context", args: {} }, coverage);
    const binding = base.page.records.filter(r => r.record_type === "lead").map(r => ({ id: r.record_id,
      model: r.fields.model, certainty: r.fields.certainty, state: r.fields.status }));
    const conversations = await getLeadConversationModel().find({ _id: { $in: input.conversation_ids }, contact_number_id: run.contact_number_id })
      .select("call_interaction_id").lean();
    const identities = await readStructuredIdentities(String(run.contact_number_id),
      conversations.flatMap(c => c.call_interaction_id ? [String(c.call_interaction_id)] : []), coverage);
    const identityPages = [...identities.values()];

    for (let index = 0; index < input.conversation_ids.length; index++) {
      const conversationId = input.conversation_ids[index], sourceId = input.source_ids[index];
      const conversation = conversations.find(c => String(c._id) === conversationId);
      const source = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: sourceId, conversation_id: conversationId,
        source_type: "transcript", purged_at: null, purge_started_at: null, ...csiDataset() })
        .select("transcript_version retrieved_at completeness").lean();
      if (!conversation || !source?.transcript_version || !source.completeness.complete) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
      const key = payloadHash({ ...csiDataset(), conversation_id: conversationId, transcript_version: source.transcript_version,
        prompt: SUMMARY_PROMPT_VERSION, model: input.model_id });
      let cached = await findSummaryArtifact(key);
      if (!cached) {
        // Raw transcript is read only for a missing summary, never sent to the findings model.
        const transcript = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: sourceId, purged_at: null, purge_started_at: null }).select("segments").lean();
        if (!transcript) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
        const segments = transcript.segments.map(s => ({ sid: s.sid, start_ms: s.start_ms, end_ms: s.end_ms,
          timing_source: s.timing_source, speaker: s.speaker, text: s.text }));
        const { accepted: summary } = await generate({ kind: "summary", key, schema: summaryGenerationSchema, system: SUMMARY_PROMPT,
          prompt: JSON.stringify({ subject_binding: binding, segments }),
          validate: value => validateSummaryStep(value, segments.map(s => s.sid)) });
        auth = await authorize();
        cached = await persistAnalysisArtifact(auth, { kind: "summary", key, canonical: true, retrieved_at: source.retrieved_at,
          data: { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] }, coverage,
            allowed_followup_ids: [], instructions: [], speaker_refs: [], analysis_summary: summary,
            transcript: { conversation_id: conversationId, transcript_version: source.transcript_version,
              source_snapshot_id: sourceId, segments: [] } } });
      }
      if (!cached.data.analysis_summary || cached.data.transcript?.source_snapshot_id !== sourceId) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      const speakerRefs = identities.get(String(conversation.call_interaction_id))?.speaker_refs ?? [];
      const captured = await persistAnalysisArtifact(auth, { kind: "summary", key: `summary:${key}`,
        data: { ...cached.data, speaker_refs: speakerRefs }, retrieved_at: source.retrieved_at });
      calls.push({ ...captured, summary: captured.data.analysis_summary!, speaker_refs: captured.data.speaker_refs });
    }

    context = await findRunArtifact(auth, "context") ?? undefined;
    if (!context) {
      const pages = [base];
      for (const tool of ["search_leads", "search_bookings", "list_number_activity"] as const) {
        let cursor: string | null = null;
        const seen = new Set<string>();
        do {
          const page = await read({ tool, args: { limit: 50, ...(cursor ? { cursor } : {}) } });
          pages.push(page);
          cursor = page.page.next_cursor;
          if (!cursor && !page.page.complete) throw new CsiError("EVIDENCE_LIMIT_REACHED");
          if (cursor && seen.has(cursor)) throw new CsiError("EVIDENCE_LIMIT_REACHED");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      context = await persistAnalysisArtifact(auth, { kind: "context", key: "context", data: assembleContextPage([...pages, ...identityPages]) });
    }
    // Context provenance §5.4: the deterministic Subject Story and the Prior Analysis page are
    // captured once per run, frozen like the context, and restored on retry and replay.
    const asOf = run.started_at ?? new Date();
    story = await findRunArtifact(auth, "story") ?? undefined;
    if (!story) {
      const assembled = await assembleSubjectStory({ contact_number_id: scope.contact_number_id, e164: scope.e164, lead_refs: scope.lead_refs,
        outreach_record_ids: scope.outreach_record_id ? [scope.outreach_record_id] : [], conversation_ids: input.conversation_ids, as_of: asOf,
        focus: run.conversation_id ? { conversation_id: String(run.conversation_id) } : null });
      story = await persistAnalysisArtifact(auth, { kind: "story", key: "story", data: storyToReadContent(assembled, coverage) });
    }
    prior = await findRunArtifact(auth, "prior") ?? undefined;
    if (!prior) {
      const selected = await selectPriorAnalyses({ contact_number_id: scope.contact_number_id, subject_key: run.subject_key,
        outreach_record_id: scope.outreach_record_id, exclude_conversation_id: run.conversation_id ? String(run.conversation_id) : null, as_of: asOf }, coverage);
      prior = await persistAnalysisArtifact(auth, { kind: "prior", key: "prior", data: selected });
    }
  }

  const contextPage = context;
  const storyEvents = recordsOf(story, "story_event"), priorFindings = recordsOf(prior, "prior_finding");
  await checkpointCsiJob(input.lease, async session => {
    await getIntelligenceRunModel().updateOne({ _id: run._id }, { $set: { step_artifacts: jsonValue({
      summaries: calls.map(c => c.snapshot_id), context: contextPage.snapshot_id,
      context_digest: payloadHash(contextPage.data),
      story: story?.snapshot_id ?? null, story_digest: story ? payloadHash(story.data) : null,
      prior: prior?.snapshot_id ?? null, prior_digest: prior ? payloadHash(prior.data) : null,
      lineage: {
        prior_run_ids: [...new Set(recordsOf(prior, "prior_finding").concat(recordsOf(prior, "prior_summary")).flatMap(r => r.fields.run_id ? [r.fields.run_id] : []))],
        prior_summary_ids: recordsOf(prior, "prior_summary").map(r => r.record_id),
        prior_finding_ids: priorFindings.map(r => r.record_id),
        assessment_artifact_id: recordsOf(prior, "prior_assessment")[0]?.record_id ?? null,
        story_events: storyEvents.length, story_from: storyEvents[0]?.fields.happened_at ?? null, story_to: storyEvents.at(-1)?.fields.happened_at ?? null,
      },
    }) } }, { session });
    // Move assessment (MA-02 §3): the summaries this invocation captured are the assessment's inputs.
    // Nomination is a durable no-op when nothing changed; it never gates or waits for findings.
    if (!input.original_run_id && run.contact_number_id) await nominateMoveAssessmentForNumber(String(run.contact_number_id), `summary:${run._id}`, session);
  });
  const instructions = structuredInstructions([contextPage]);
  const corrections = correctionContextSchema.parse(run.owner_correction_context ?? []);
  for (const correction of corrections) {
    const existing = instructions.findIndex(i => i.id === correction.instruction_id);
    if (existing >= 0) instructions.splice(existing, 1);
    instructions.push({ id: correction.instruction_id, revision: correction.revision });
  }
  const prompt = JSON.stringify(modelEvidence({ subject_scope: run.conversation_id ? "conversation" : "number",
    // `move_evidence` feeds the Move assessment step only; the findings prompt stays byte-identical to v1.
    calls: calls.map((call, call_index) => { const { move_evidence: _move, ...summary } = call.summary; return { call_index, ...summary }; }),
    context: { records: contextPage.data.page.records, coverage: contextPage.data.coverage, allowed_followup_ids: contextPage.data.allowed_followup_ids },
    story: storyPromptBlock(story), prior: priorPromptBlock(prior),
    instructions: instructions.map((instruction, instruction_index) => ({ instruction_index, ...instruction })),
    owner_corrections: corrections }));
  const pages = [contextPage, ...(story ? [story] : []), ...(prior ? [prior] : [])];
  const { raw, accepted: envelope } = await generate({ kind: "findings", key: input.run_id, schema: minimalFindingsSchema,
    system: FINDINGS_PROMPT, prompt,
    validate: value => expandStructuredFindings(value, { subject_key: run.subject_key, context: pages, calls, instructions,
      prior_finding_ids: priorFindings.map(r => r.record_id), story_event_ids: storyEvents.map(r => r.record_id) }) });
  auth = await authorize();
  await input.beforeProvider(); // Recheck current eligibility / purge before accepting any effects intent.
  const receipt = await submitIntelligenceAnalysis(auth, { idempotency_key: input.run_id, envelope }, { raw_output: raw });
  input.onInvocationComplete?.();
  return receipt;
}
