/**
 * AC7-AB (Attention and Case File spec §10): the findings step and the Move assessment, run twice per Number
 * against the same frozen inputs — the current layout (story/prior/calls blocks, v4; assessment v1) and the
 * Case File (v5; assessment v2) — side by side. **Side-effect-free:** inputs are read (never captured as run
 * artifacts), the model is called directly (no run, job, reservation or budget row), outputs are validated
 * with the production validators, and nothing is submitted, applied or published. Summaries are the
 * Number's current canonical (v2) summaries for both layouts, so the comparison isolates the layout; the
 * v3 re-summary cost is the backfill estimate's concern.
 *
 *   # choose ~20 Numbers (Form, Call, no-Lead, busy, estimate change, unreviewed rep); read only
 *   node --env-file=.env --import tsx scripts/dev_ops/case-file-ab.ts --select <numbers.json> [--allow-production]
 *   # render both prompts only (sizes; free)
 *   node --env-file=.env --import tsx scripts/dev_ops/case-file-ab.ts --numbers <numbers.json> --prompts-only [--out <dir>] [--allow-production]
 *   # the paid A/B (operator approval in the conversation first; personal key)
 *   node --env-file=.env --import tsx scripts/dev_ops/case-file-ab.ts --numbers <numbers.json> --confirm-paid [--out <dir>] [--allow-production]
 *
 * Without `--confirm-paid` (and without `--prompts-only`) it refuses before any model call. Output:
 * `<out>/<number>.md` (both outputs, the rendered Case File, sizes, tokens, cost) and `<out>/SUMMARY.md`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import mongoose from "mongoose";
import type { LanguageModel, LanguageModelUsage } from "ai" with { "resolution-mode": "import" };
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import { loadReadScope, readIntelligenceEvidence, type ReadContent } from "../../src/services/salesIntelligence/analysis/reads";
import { intelligenceReadSchema } from "../../src/services/salesIntelligence/analysis/contracts";
import { assembleContextPage, findSummaryArtifact, restoreAnalysisArtifact } from "../../src/services/salesIntelligence/analysis/structuredArtifacts";
import { readStructuredIdentities } from "../../src/services/salesIntelligence/analysis/structuredIdentity";
import { expandStructuredFindings, minimalFindingsSchema, structuredInstructions, type StructuredCall } from "../../src/services/salesIntelligence/analysis/structuredContract";
import { FINDINGS_PROMPT, FINDINGS_PROMPT_V5, FINDINGS_PROMPT_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION, SUMMARY_PROMPT_VERSION } from "../../src/services/salesIntelligence/analysis/structuredPrompt";
import { structuredProviderSchema } from "../../src/services/salesIntelligence/analysis/structuredProviderSchema";
import { measuredCents, type StepPricing } from "../../src/services/salesIntelligence/analysis/structuredGeneration";
import { modelEvidence } from "../../src/services/salesIntelligence/analysis/modelEvidence";
import { priorPromptBlock, storyPromptBlock } from "../../src/services/salesIntelligence/analysis/structuredRuntime";
import { selectPriorAnalyses } from "../../src/services/salesIntelligence/analysis/prior";
import type { CapturedPromptPage } from "../../src/services/salesIntelligence/analysis/prompt";
import { assembleSubjectStory } from "../../src/services/salesIntelligence/story/assemble";
import { storyToReadContent } from "../../src/services/salesIntelligence/story/page";
import { assembleCaseFile } from "../../src/services/salesIntelligence/casefile/assemble";
import { caseFileFromReadContent, caseFileToReadContent } from "../../src/services/salesIntelligence/casefile/page";
import { findingsAppendix } from "../../src/services/salesIntelligence/casefile/appendix";
import { CASE_FILE_TIMEZONE } from "../../src/services/salesIntelligence/casefile/types";
import { assembleAssessmentContext, type AssessmentContext } from "../../src/services/salesIntelligence/assessment/context";
import { assessmentStepContract, type AssessmentLayout } from "../../src/services/salesIntelligence/assessment/contract";
import { generateMoveAssessment, type AssessmentLedger } from "../../src/services/salesIntelligence/assessment/generate";
import { CsiError } from "../../src/services/salesIntelligence/auth";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";

export const AB_CATEGORIES = ["form", "call", "no_lead", "busy", "estimate_change", "unreviewed_rep"] as const;
export type AbNumber = { number_id: string; category: string };
type Usage = { input_tokens: number; output_tokens: number; cents: number; attempts: number };
type FindingsResult = { layout: "legacy" | "case_file"; prompt_version: string; prompt_bytes: number; output?: unknown; error?: string; usage: Usage };
type AssessmentResult = { layout: AssessmentLayout; prompt_version: string; payload_bytes: number; output?: unknown; error?: string; skipped?: string; usage: Usage };
export type AbNumberResult = { number_id: string; category: string; skipped?: string; conversations: number; summaries: number;
  case_file?: { bytes: number; trimmed: unknown; over_hard_budget: boolean }; findings: FindingsResult[]; assessment: AssessmentResult[] };

const iso = (d: Date) => d.toISOString();
const blankUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cents: 0, attempts: 0 });

/** The frozen inputs of one Number, read once and shared by both layouts. Nothing is persisted. */
async function frozenInputs(numberId: string, modelId: string, asOf: Date) {
  const coverage = await readCaptureCoverage();
  // A synthetic, never-persisted run: `loadReadScope` needs only these fields to scope the reads.
  const runLike = { _id: new mongoose.Types.ObjectId(), subject_key: `number:${numberId}`, contact_number_id: numberId, conversation_id: null, outreach_record_id: null, job_id: null };
  const scope = await loadReadScope(runLike as never);
  const read = (raw: unknown) => readIntelligenceEvidence(scope, intelligenceReadSchema.parse(raw), coverage);
  const base = await readIntelligenceEvidence(scope, { tool: "get_intelligence_context", args: {} }, coverage);
  const conversations = await getLeadConversationModel().find({ contact_number_id: numberId, "analysis_eligibility.status": "eligible", latest_transcript_version: { $type: "string" },
    content_purged_at: null }).select("_id call_interaction_id latest_transcript_version started_at").sort({ _id: 1 }).limit(100).lean();
  const identities = await readStructuredIdentities(numberId, conversations.flatMap(c => (c.call_interaction_id ? [String(c.call_interaction_id)] : [])), coverage);
  const calls: StructuredCall[] = [];
  for (const conversation of conversations) {
    // The summary cached for this model and the current summary prompt, else the newest canonical summary
    // artifact at the conversation's transcript version (as the Case File reads it).
    const key = payloadHash({ ...csiDataset(), conversation_id: String(conversation._id), transcript_version: conversation.latest_transcript_version, prompt: SUMMARY_PROMPT_VERSION, model: modelId });
    let cached = await findSummaryArtifact(key).catch(() => null);
    if (!cached) {
      const rows = await getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" }, conversation_id: conversation._id,
        purged_at: null, purge_started_at: null }).sort({ _id: -1 }).limit(5).lean();
      const row = rows.find(r => (r.response as { transcript?: { transcript_version?: string } } | null)?.transcript?.transcript_version === conversation.latest_transcript_version) ?? rows[0];
      cached = row ? (() => { try { return restoreAnalysisArtifact(row); } catch { return null; } })() : null;
    }
    if (!cached?.data.analysis_summary || !cached.data.transcript) continue;
    calls.push({ ...cached, summary: cached.data.analysis_summary, speaker_refs: identities.get(String(conversation.call_interaction_id))?.speaker_refs ?? [] });
  }
  const pages: ReadContent[] = [base];
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
  const context: CapturedPromptPage = { snapshot_id: "ab:context", data: assembleContextPage([...pages, ...identities.values()]) };
  const conversationIds = calls.map(c => c.data.transcript!.conversation_id);
  const story: CapturedPromptPage = { snapshot_id: "ab:story", data: storyToReadContent(await assembleSubjectStory({ contact_number_id: scope.contact_number_id, e164: scope.e164,
    lead_refs: scope.lead_refs, outreach_record_ids: [], conversation_ids: conversationIds, as_of: asOf, focus: null }), coverage) };
  const prior: CapturedPromptPage = { snapshot_id: "ab:prior", data: await selectPriorAnalyses({ contact_number_id: scope.contact_number_id, subject_key: runLike.subject_key,
    outreach_record_id: null, exclude_conversation_id: null, as_of: asOf }, coverage) };
  const summaries = new Map(calls.map(call => [call.data.transcript!.conversation_id, { summary: call.summary,
    call_interaction_id: conversations.find(c => String(c._id) === call.data.transcript!.conversation_id)?.call_interaction_id ? String(conversations.find(c => String(c._id) === call.data.transcript!.conversation_id)!.call_interaction_id) : null }]));
  const assembled = await assembleCaseFile({ contact_number_id: scope.contact_number_id, e164: scope.e164, lead_refs: scope.lead_refs, outreach_record_ids: [],
    conversation_ids: conversationIds, focus_conversation_ids: null, summaries, prior: prior.data, as_of: asOf, timezone: CASE_FILE_TIMEZONE, audience: "findings",
    allowed_followup_ids: context.data.allowed_followup_ids, coverage });
  const caseFile: CapturedPromptPage = { snapshot_id: "ab:case_file", data: caseFileToReadContent(assembled.file, assembled.rendered, coverage) };
  return { scope, conversations, calls, context, story, prior, caseFile, rendered: assembled.rendered };
}
type Frozen = Awaited<ReturnType<typeof frozenInputs>>;
const recordsOf = (page: CapturedPromptPage, type: string) => page.data.page.records.filter(r => r.record_type === type);

/** The two findings prompts exactly as `structuredRuntime.ts` composes them for a Number run (legacy, then `invokeCaseFileLayout`). */
export function findingsPrompts(f: Frozen) {
  const instructions = structuredInstructions([f.context]);
  const legacy = { system: FINDINGS_PROMPT, version: FINDINGS_PROMPT_VERSION, pages: [f.context, f.story, f.prior], calls: f.calls,
    story_event_ids: recordsOf(f.story, "story_event").map(r => r.record_id), prior_finding_ids: recordsOf(f.prior, "prior_finding").map(r => r.record_id),
    prompt: JSON.stringify(modelEvidence({ subject_scope: "number",
      calls: f.calls.map((call, call_index) => { const { move_evidence: _move, ...summary } = call.summary; return { call_index, ...summary }; }),
      context: { records: f.context.data.page.records, coverage: f.context.data.coverage, allowed_followup_ids: f.context.data.allowed_followup_ids },
      story: storyPromptBlock(f.story), prior: priorPromptBlock(f.prior),
      instructions: instructions.map((instruction, instruction_index) => ({ instruction_index, ...instruction })), owner_corrections: [] })) };
  const recorded = caseFileFromReadContent(f.caseFile.data);
  if (!recorded) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const byConversation = new Map(f.calls.map(call => [call.data.transcript!.conversation_id, call]));
  const empty = { summary: { overview: "", customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "" }, said_on_call: [] };
  const ordered: StructuredCall[] = recorded.call_conversation_ids.map(id => byConversation.get(id) ?? { snapshot_id: "", summary: empty, speaker_refs: [],
    data: { page: { records: [], next_cursor: null, complete: true, missing_ranges: [] }, coverage: f.context.data.coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [] } });
  for (const call of f.calls) if (!recorded.call_conversation_ids.includes(call.data.transcript!.conversation_id)) ordered.push(call);
  const storyEventIds = recordsOf(f.caseFile, "story_event").map(r => r.record_id), priorFindingIds = recordsOf(f.prior, "prior_finding").map(r => r.record_id);
  const caseFile = { system: FINDINGS_PROMPT_V5, version: CASE_FILE_FINDINGS_PROMPT_VERSION, pages: [f.context, f.caseFile, f.prior], calls: ordered,
    story_event_ids: storyEventIds, prior_finding_ids: priorFindingIds,
    prompt: JSON.stringify(modelEvidence({ subject_scope: "number", case_file: recorded.text,
      appendix: findingsAppendix({ calls: ordered.map(call => ({ summary: call.summary, segments_available: Boolean(call.data.transcript) })), context: f.context.data,
        story_event_ids: storyEventIds, prior_finding_ids: priorFindingIds }),
      instructions: instructions.map((instruction, instruction_index) => ({ instruction_index, ...instruction })), owner_corrections: [] })) };
  return { legacy, caseFile, instructions };
}

/** One findings generation: a direct provider call, the production validator, one local repair. No reservation, no run. */
async function generateFindingsOnce(model: LanguageModel, pricing: StepPricing, spec: ReturnType<typeof findingsPrompts>["legacy"], instructions: ReturnType<typeof structuredInstructions>, subjectKey: string) {
  const { generateObject, NoObjectGeneratedError } = await import("ai");
  const schema = await structuredProviderSchema(minimalFindingsSchema);
  const usage = blankUsage();
  const observe = (u: LanguageModelUsage, metadata: unknown) => { usage.input_tokens += u.inputTokens ?? 0; usage.output_tokens += u.outputTokens ?? 0; usage.cents += measuredCents(u, metadata, pricing).cents; };
  let repair = "", last: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    usage.attempts++;
    let value: unknown;
    try {
      const result = await generateObject({ model, schema, maxRetries: 0, system: spec.system, prompt: spec.prompt + repair });
      observe(result.usage, result.providerMetadata); value = result.object;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) return { error: error instanceof Error ? error.message.slice(0, 200) : "provider_error", usage };
      if (error.usage) observe(error.usage, undefined);
      repair = "\nThe previous response failed validation. Return the complete object."; continue;
    }
    last = value;
    try {
      expandStructuredFindings(value, { subject_key: subjectKey, context: spec.pages, calls: spec.calls, instructions, prior_finding_ids: spec.prior_finding_ids, story_event_ids: spec.story_event_ids });
      return { output: value, usage };
    } catch (error) {
      const paths = error instanceof CsiError ? (error.issues ?? []).map(i => `${i.path}:${i.code}`) : ["output:invalid_structured_response"];
      repair = `\nThe previous object (data) was ${JSON.stringify(value)}. Correct these validation paths: ${JSON.stringify(paths)}. Return the complete object.`;
      if (attempt === 1) return { output: last, error: `validation: ${paths.slice(0, 6).join(", ")}`, usage };
    }
  }
  return { output: last, error: "no valid object", usage };
}

/** Accounting in memory only: `generateMoveAssessment` books nothing through this ledger. */
function memoryLedger(): AssessmentLedger {
  return { activeMonth: async () => "ab", nominalCents: async () => 0, reserve: async () => undefined, providerStarted: async () => undefined,
    record: async () => undefined, markUncertain: async () => undefined, reconcile: async () => undefined };
}

export type AbOptions = { numbers: AbNumber[]; model?: LanguageModel; modelId: string; pricing: StepPricing; outDir: string; promptsOnly?: boolean; asOf?: Date; log?: (line: string) => void };

export async function runCaseFileAb(options: AbOptions): Promise<AbNumberResult[]> {
  if (!options.promptsOnly && !options.model) throw new Error("a model is required unless --prompts-only");
  const asOf = options.asOf ?? new Date();
  await mkdir(options.outDir, { recursive: true });
  const results: AbNumberResult[] = [];
  for (const entry of options.numbers) {
    const result: AbNumberResult = { number_id: entry.number_id, category: entry.category, conversations: 0, summaries: 0, findings: [], assessment: [] };
    results.push(result);
    let frozen: Frozen;
    try { frozen = await frozenInputs(entry.number_id, options.modelId, asOf); }
    catch (error) { result.skipped = error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 120) : "unreadable"; continue; }
    result.conversations = frozen.conversations.length; result.summaries = frozen.calls.length;
    result.case_file = { bytes: frozen.rendered.bytes, trimmed: frozen.rendered.trimmed_steps, over_hard_budget: frozen.rendered.over_hard_budget };
    if (!frozen.calls.length) { result.skipped = "no_canonical_summary"; continue; }
    const prompts = findingsPrompts(frozen);
    for (const [layout, spec] of [["legacy", prompts.legacy], ["case_file", prompts.caseFile]] as const) {
      const base: FindingsResult = { layout, prompt_version: spec.version, prompt_bytes: Buffer.byteLength(spec.system) + Buffer.byteLength(spec.prompt), usage: blankUsage() };
      if (options.promptsOnly) { result.findings.push(base); continue; }
      result.findings.push({ ...base, ...(await generateFindingsOnce(options.model!, options.pricing, spec, prompts.instructions, `number:${entry.number_id}`)) });
    }
    // The Move assessment of the Number's open Lead record (the Number-review record when it has no Lead).
    const record = await getOutreachRecordModel().findOne({ primary_contact_number_id: entry.number_id, state: { $ne: "closed" } }).sort({ "subject.kind": 1, _id: -1 }).select({ _id: 1 }).lean();
    if (record) for (const layout of ["legacy", "case_file"] as const) {
      const context = await assembleAssessmentContext({ outreach_record_id: String(record._id), allow_lead_only: true, now: asOf }, undefined, undefined, { layout }).catch(error => ({ error }));
      const version = assessmentStepContract(layout).prompt_version;
      if ("error" in context) { result.assessment.push({ layout, prompt_version: version, payload_bytes: 0, error: String((context.error as Error).message ?? context.error).slice(0, 120), usage: blankUsage() }); continue; }
      // The assessment's own skips (no summary, limits, closed, ambiguous) are outcomes, not failures: both layouts skip alike.
      if ("skip" in context) { result.assessment.push({ layout, prompt_version: version, payload_bytes: 0, skipped: context.skip, usage: blankUsage() }); continue; }
      const ready = context as AssessmentContext;
      const base: AssessmentResult = { layout, prompt_version: version, payload_bytes: Buffer.byteLength(JSON.stringify(ready.prompt_payload)), usage: blankUsage() };
      if (options.promptsOnly) { result.assessment.push(base); continue; }
      try {
        const generated = await generateMoveAssessment({ lease: { job_id: "0".repeat(24), owner: "case-file-ab", epoch: 0 }, artifact_id: `ab-${entry.number_id}-${layout}`,
          model: options.model, model_id: options.modelId, credential: "PERSONAL_AI_GATEWAY_API_KEY", pricing: options.pricing, prompt_payload: ready.prompt_payload,
          catalog: ready.catalog, layout, ledger: memoryLedger(), deadline: Date.now() + 740_000 });
        result.assessment.push({ ...base, output: { scores: { move_likelihood: generated.accepted.scores.move_likelihood.level, transaction_intent: generated.accepted.scores.transaction_intent.level },
          model_output: generated.model_output }, usage: { input_tokens: generated.usage.input_tokens, output_tokens: generated.usage.output_tokens, cents: generated.usage.actual_cents, attempts: generated.usage.attempts } });
      } catch (error) { result.assessment.push({ ...base, error: error instanceof CsiError ? `${error.code}: ${(error.issues ?? []).map(i => `${i.path}:${i.code}`).slice(0, 4).join(", ")}` : error instanceof Error ? error.message.slice(0, 160) : "failed" }); }
    }
    await writeFile(join(options.outDir, `${entry.number_id}.md`), numberMarkdown(result, frozen.rendered.text));
    options.log?.(JSON.stringify({ number: entry.number_id, category: entry.category, case_file_bytes: result.case_file?.bytes, findings: result.findings.map(f => f.error ?? "ok"), assessment: result.assessment.map(a => a.error ?? "ok") }));
  }
  await writeFile(join(options.outDir, "SUMMARY.md"), summaryMarkdown(results, options));
  return results;
}

function summaryOf(output: unknown) {
  const o = output as { summary?: Record<string, string>; findings?: unknown[]; prior_finding_relations?: unknown[]; story_discrepancies?: unknown[] } | null;
  return { summary_chars: o?.summary ? Object.values(o.summary).join("").length : 0, findings: o?.findings?.length ?? 0, relations: o?.prior_finding_relations?.length ?? 0,
    discrepancies: o?.story_discrepancies?.length ?? 0 };
}
function numberMarkdown(r: AbNumberResult, caseFileText: string) {
  const block = (title: string, value: unknown) => `### ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 1)}\n\`\`\`\n`;
  return `# AC7-AB · Number ${r.number_id} (${r.category})\n\nConversations ${r.conversations}, canonical summaries used ${r.summaries}. Case File ${r.case_file?.bytes ?? 0} bytes${r.case_file?.over_hard_budget ? " (over the hard budget)" : ""}.\n\n` +
    `| step | layout | version | prompt bytes | tokens in/out | cents | attempts | result |\n|---|---|---|---|---|---|---|---|\n` +
    [...r.findings.map(f => `| findings | ${f.layout} | ${f.prompt_version} | ${f.prompt_bytes} | ${f.usage.input_tokens}/${f.usage.output_tokens} | ${f.usage.cents} | ${f.usage.attempts} | ${f.error ?? (f.output ? "valid" : "not run")} |`),
      ...r.assessment.map(a => `| assessment | ${a.layout} | ${a.prompt_version} | ${a.payload_bytes} | ${a.usage.input_tokens}/${a.usage.output_tokens} | ${a.usage.cents} | ${a.usage.attempts} | ${a.error ?? (a.skipped ? `skipped: ${a.skipped}` : a.output ? "valid" : "not run")} |`)].join("\n") +
    `\n\n## Findings, side by side\n\n${r.findings.map(f => block(`${f.layout} (${f.prompt_version})`, f.output ?? null)).join("\n")}\n## Move assessment, side by side\n\n${r.assessment.map(a => block(`${a.layout} (${a.prompt_version})`, a.output ?? null)).join("\n")}\n## The rendered Case File\n\n\`\`\`text\n${caseFileText}\n\`\`\`\n`;
}
function summaryMarkdown(results: AbNumberResult[], options: AbOptions) {
  const rows = results.map(r => {
    const [legacy, cf] = [r.findings.find(f => f.layout === "legacy"), r.findings.find(f => f.layout === "case_file")];
    const [a1, a2] = [r.assessment.find(a => a.layout === "legacy"), r.assessment.find(a => a.layout === "case_file")];
    const s1 = summaryOf(legacy?.output), s2 = summaryOf(cf?.output);
    return `| ${r.number_id} | ${r.category} | ${r.skipped ?? ""} | ${r.case_file?.bytes ?? ""} | ${legacy?.prompt_bytes ?? ""} / ${cf?.prompt_bytes ?? ""} | ${legacy?.usage.input_tokens ?? 0} / ${cf?.usage.input_tokens ?? 0} | ${(legacy?.usage.cents ?? 0) + (a1?.usage.cents ?? 0)} / ${(cf?.usage.cents ?? 0) + (a2?.usage.cents ?? 0)} | ${s1.findings} / ${s2.findings} | ${s1.summary_chars} / ${s2.summary_chars} | ${legacy?.error ?? "ok"} / ${cf?.error ?? "ok"} | ${a1?.error ?? a1?.skipped ?? "ok"} / ${a2?.error ?? a2?.skipped ?? "ok"} |`;
  });
  return `# AC7-AB summary (${options.promptsOnly ? "prompts only, no model call" : `model ${options.modelId}`})\n\nEach cell is current layout / Case File. Cents are list-price estimates from the provider usage (findings + assessment).\n\n` +
    `| number | category | skipped | case file bytes | findings prompt bytes | findings tokens in | cents | findings | summary chars | findings result | assessment result |\n|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

// ── Number selection (read only) ────────────────────────────────────────────────────────────────
export async function selectAbNumbers(perCategory = 4, max = 20): Promise<AbNumber[]> {
  const dataset = csiDataset();
  const summarized = await getIntelligenceEvidenceSnapshotModel().distinct("conversation_id", { ...dataset, source_type: "summary", artifact_key: { $type: "string" }, purged_at: null });
  const counts = await getLeadConversationModel().aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([{ $match: { _id: { $in: summarized }, contact_number_id: { $ne: null } } },
    { $group: { _id: "$contact_number_id", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 2000 }]);
  const numbers = (await getContactNumberModel().find({ _id: { $in: counts.map(c => c._id) }, kind: "external", classification: { $nin: ["company", "non_customer"] }, purged_at: null })
    .select({ _id: 1 }).lean()).map(n => String(n._id));
  const eligible = new Set(numbers);
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: { $in: numbers }, state: "attached" }).select({ contact_number_id: 1, lead_ref: 1 }).lean();
  const byNumber = new Map<string, Array<{ model: string; id: string }>>();
  for (const e of edges) byNumber.set(String(e.contact_number_id), [...(byNumber.get(String(e.contact_number_id)) ?? []), { model: e.lead_ref.model, id: String(e.lead_ref.id) }]);
  const picked = new Map<string, string>();
  const take = (category: string, ids: string[]) => { let n = 0; for (const id of ids) { if (n >= perCategory || picked.size >= max) break; if (eligible.has(id) && !picked.has(id)) { picked.set(id, category); n++; } } };
  take("busy", counts.map(c => String(c._id)));
  take("form", numbers.filter(id => byNumber.get(id)?.some(l => l.model === "FormLead")).reverse());
  take("call", numbers.filter(id => byNumber.get(id)?.some(l => l.model === "CallLead")).reverse());
  take("no_lead", numbers.filter(id => !byNumber.has(id)).reverse());
  // Estimate change: the attached Lead's Job has accepted observations with two different estimates.
  const leadIds = edges.filter(e => e.lead_ref.model === "FormLead").map(e => e.lead_ref.id);
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const jobs = await db.collection("form_leads").find({ _id: { $in: leadIds }, normalized_job_no: { $type: "string" } }, { projection: { normalized_job_no: 1 } }).toArray();
  const changed = await db.collection("granot_observations").aggregate<{ _id: string }>([{ $match: { "identity.normalized_job_no": { $in: jobs.map(j => j.normalized_job_no) },
    normalization_result: { $in: ["valid", "valid_with_issues"] }, "display_money.estimate.raw": { $type: "string" } } },
    { $group: { _id: "$identity.normalized_job_no", estimates: { $addToSet: "$display_money.estimate.raw" } } }, { $match: { "estimates.1": { $exists: true } } }]).toArray();
  const changedJobs = new Set(changed.map(c => c._id));
  const leadNumber = new Map(edges.map(e => [String(e.lead_ref.id), String(e.contact_number_id)]));
  take("estimate_change", jobs.filter(j => changedJobs.has(j.normalized_job_no)).map(j => leadNumber.get(String(j._id))!).filter(Boolean));
  // Unreviewed rep: a summarized call answered by an extension with no reviewed identity link.
  const reviewed = new Set((await db.collection("rep_identity_links").find({ status: "reviewed" }, { projection: { rc_extension_id: 1 } }).toArray()).map(l => String(l.rc_extension_id)));
  const calls = await db.collection("call_interactions").find({ contact_number_id: { $in: numbers.map(id => new mongoose.Types.ObjectId(id)) }, "parties.role": "user" },
    { projection: { contact_number_id: 1, parties: 1 } }).limit(5000).toArray();
  take("unreviewed_rep", [...new Set(calls.filter(c => (c.parties as Array<{ role?: string; extension_id?: string | null }>).some(p => p.role === "user" && p.extension_id && !reviewed.has(String(p.extension_id))))
    .map(c => String(c.contact_number_id)))]);
  return [...picked].map(([number_id, category]) => ({ number_id, category }));
}

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

async function main() {
  const select = option("--select"), numbersFile = option("--numbers");
  const promptsOnly = process.argv.includes("--prompts-only"), paid = process.argv.includes("--confirm-paid");
  if (!select && !numbersFile) throw new Error("pass --select <out.json> or --numbers <file>");
  if (numbersFile && !promptsOnly && !paid) {
    console.error(JSON.stringify({ refused: "the A/B calls a paid model twice per step per Number; pass --confirm-paid only with the operator's approval in the conversation (or --prompts-only)" }));
    process.exitCode = 2; return;
  }
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !process.argv.includes("--allow-production")) throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production");
  if (select) {
    const picked = await selectAbNumbers();
    await writeFile(resolve(select), JSON.stringify(picked, null, 1) + "\n");
    console.log(JSON.stringify({ selected: picked.length, by_category: picked.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category]: (m[p.category] ?? 0) + 1 }), {}), file: resolve(select) }));
    return;
  }
  const numbers = JSON.parse(await readFile(resolve(numbersFile!), "utf8")) as AbNumber[];
  const modelId = process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ?? "openai/gpt-5.6-luna";
  const pricing: StepPricing = { version: "case-file-ab", input_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION ?? 0) || 1,
    output_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION ?? 0) || 1 };
  let model: LanguageModel | undefined;
  if (paid) {
    // Personal key only, never the company key (as the context-refresh backfill); spend is not booked to any ledger.
    const key = process.env.PERSONAL_AI_GATEWAY_API_KEY?.trim();
    if (!key) throw new Error("PERSONAL_AI_GATEWAY_API_KEY is missing or empty");
    model = (await import("@ai-sdk/gateway")).createGateway({ apiKey: key })(modelId);
  }
  const results = await runCaseFileAb({ numbers, model, modelId, pricing, promptsOnly, outDir: resolve(option("--out") ?? "scripts/dev_ops/output/AC7-AB"), log: line => console.error(line) });
  console.log(JSON.stringify({ numbers: results.length, skipped: results.filter(r => r.skipped).length, as_of: iso(new Date()), out: resolve(option("--out") ?? "scripts/dev_ops/output/AC7-AB") }));
}

if (require.main === module) {
  main().catch(error => { console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 200) : "setup_failed" })); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
