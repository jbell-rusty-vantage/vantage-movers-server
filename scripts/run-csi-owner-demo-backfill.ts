/**
 * Owner demo backfill for five real Number↔Lead connections (task 19 §3.4).
 * Redacted ids and job numbers only. Never prints phones, names, or transcripts.
 *
 *   pnpm exec tsx --env-file=.env --env-file=sales-intelligence.env scripts/run-csi-owner-demo-backfill.ts
 *   pnpm exec tsx --env-file=.env --env-file=sales-intelligence.env scripts/run-csi-owner-demo-backfill.ts --confirm-write
 */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { isTestMode } from "../src/config/domain/runtime";
import { csiDataset, csiFlag } from "../src/config/domain/salesIntelligence";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getCallLeadModel } from "../src/models/CallLead";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getIntelligenceEffectModel } from "../src/models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceAiReservationModel } from "../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceReviewItemModel } from "../src/models/SalesIntelligenceReviewItem";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { analysisRuntimeConfiguration, estimateAnalysisCents, runIntelligenceJob } from "../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { scheduleNumberIntelligence } from "../src/services/salesIntelligence/analysis/scheduling";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot, decompressAttentionRows } from "../src/services/salesIntelligence/outreach/attention";
import {
  resolveAtInteraction,
  type Attachment,
  type InteractionIdentity,
} from "../src/services/salesIntelligence/attachment/suggest";

const WRITE = process.argv.includes("--confirm-write");
const FINISH = process.argv.includes("--finish");
const PICKS = [
  { role: "booked", model: "FormLead" as const, job_no: "5563953" },
  { role: "booked", model: "FormLead" as const, job_no: "5564267" },
  { role: "open", model: "FormLead" as const, job_no: "5564618" },
  { role: "open", model: "CallLead" as const, job_no: "5564791" },
  { role: "open", model: "CallLead" as const, job_no: "5564716" },
];

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

function asAttachment(edge: {
  lead_ref: { model: "FormLead" | "CallLead"; id: unknown };
  state: Attachment["state"];
  certainty: Attachment["certainty"];
  evidence?: ReadonlyArray<{ window_from?: Date | null; window_to?: Date | null }>;
  decided_at?: Date | null;
}): Attachment {
  return {
    lead_ref: { model: edge.lead_ref.model, id: String(edge.lead_ref.id) },
    state: edge.state,
    certainty: edge.certainty,
    evidence: (edge.evidence ?? []).map((item) => ({
      ...(item as Attachment["evidence"][number]),
      window_from: item.window_from ?? null,
      window_to: item.window_to ?? null,
    })),
    decided_at: edge.decided_at ?? null,
  };
}

function preflight() {
  const config = analysisRuntimeConfiguration();
  const estimate = config.pricing ? estimateAnalysisCents(config.pricing, config.limits) : null;
  const flags = {
    ENABLED: csiFlag("ENABLED"),
    ATTACHMENT_REFRESH: csiFlag("ATTACHMENT_REFRESH"),
    OUTREACH_ENSURE: csiFlag("OUTREACH_ENSURE"),
    MEDIA_ENABLED: csiFlag("MEDIA_ENABLED"),
    STT_ENABLED: csiFlag("STT_ENABLED"),
    EXTRACTION_ENABLED: csiFlag("EXTRACTION_ENABLED"),
    PROVIDER_READS: csiFlag("PROVIDER_READS"),
  };
  const ready = Boolean(
    config.pricing && config.endpoint && config.key && config.gateway_key && estimate !== null && estimate <= 25 && flags.ENABLED && flags.EXTRACTION_ENABLED,
  );
  return {
    model: config.model_id,
    pricing_version: config.pricing?.version ?? null,
    estimate_cents: estimate,
    per_recording_ceiling_cents: 25,
    limits: config.limits,
    endpoint: Boolean(config.endpoint),
    mcp_key: Boolean(config.key),
    gateway_key: Boolean(config.gateway_key),
    flags,
    ready,
  };
}

async function resolvePick(pick: (typeof PICKS)[number]) {
  const lead =
    pick.model === "FormLead"
      ? await getFormLeadModel().findOne({ $or: [{ job_no: pick.job_no }, { normalized_job_no: pick.job_no }] }).select({ booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1 }).lean()
      : await getCallLeadModel().findOne({ $or: [{ job_no: pick.job_no }, { normalized_job_no: pick.job_no }] }).select({ booked: 1, cancelled: 1, duplicate: 1, no_sync: 1 }).lean();
  if (!lead) return { pick, error: "lead_missing" };
  const edges = await getNumberLeadAttachmentModel()
    .find({ "lead_ref.model": pick.model, "lead_ref.id": lead._id, state: "attached" })
    .select({ contact_number_id: 1, state: 1, certainty: 1, evidence: 1, decided_at: 1, lead_ref: 1, auto_decision: 1 })
    .lean();
  const numberIds = [...new Set(edges.map((edge) => String(edge.contact_number_id)))];
  const conversations = await getLeadConversationModel()
    .find({
      contact_number_id: { $in: numberIds },
      "media.blob_pathname": { $type: "string" },
      "media.purged_at": null,
      latest_transcript_version: { $ne: null },
    })
    .sort({ duration_seconds: -1 })
    .limit(12)
    .select({
      contact_number_id: 1,
      call_interaction_id: 1,
      started_at: 1,
      duration_seconds: 1,
      state: 1,
      direction: 1,
      latest_transcript_version: 1,
      analysis_eligibility: 1,
      provider_account_id: 1,
    })
    .lean();
  for (const conversation of conversations) {
    const interaction = conversation.call_interaction_id
      ? await getCallInteractionModel().findById(conversation.call_interaction_id).select({
          terminal: 1, direction: 1, monitoring: 1, provider_account_id: 1, telephony_session_id: 1, session_id: 1, call_log_ids: 1, started_at: 1,
        }).lean()
      : null;
    if (!interaction?.terminal || interaction.monitoring) continue;
    if (interaction.direction !== "Inbound" && interaction.direction !== "Outbound") continue;
    const numberEdges = await getNumberLeadAttachmentModel()
      .find({ contact_number_id: conversation.contact_number_id })
      .select({ state: 1, certainty: 1, evidence: 1, decided_at: 1, lead_ref: 1, auto_decision: 1 })
      .lean();
    const identity: InteractionIdentity = {
      id: String(interaction._id),
      provider_account_id: interaction.provider_account_id,
      started_at: interaction.started_at,
      telephony_session_id: interaction.telephony_session_id,
      session_id: interaction.session_id,
      call_log_ids: interaction.call_log_ids ?? [],
    };
    const resolution = resolveAtInteraction(numberEdges.map(asAttachment), identity);
    if (!resolution.lead_effects_allowed || resolution.lead_ref?.id !== String(lead._id) || resolution.lead_ref.model !== pick.model) continue;
    const outreach = await getOutreachRecordModel()
      .findOne({ "subject.kind": "lead", "subject.model": pick.model, "subject.id": lead._id })
      .select({ state: 1, closed_reason: 1, revision: 1, primary_contact_number_id: 1 })
      .lean();
    return {
      pick,
      conversation_id: String(conversation._id),
      number_id: String(conversation.contact_number_id),
      lead_id: String(lead._id),
      outreach_id: outreach ? String(outreach._id) : null,
      summary: {
        role: pick.role,
        job_no: pick.job_no,
        lead_model: pick.model,
        conversation: mask(conversation._id),
        number: mask(conversation.contact_number_id),
        lead: mask(lead._id),
        outreach: outreach ? mask(outreach._id) : null,
        outreach_state: outreach?.state ?? null,
        closed_reason: outreach?.closed_reason ?? null,
        certainty: resolution.certainty,
        auto_attached: Boolean(numberEdges.find((edge) => String(edge.lead_ref.id) === String(lead._id))?.auto_decision),
        duration_seconds: conversation.duration_seconds,
        started_at: conversation.started_at,
        state: conversation.state,
        eligibility: conversation.analysis_eligibility?.status ?? null,
        transcript: Boolean(conversation.latest_transcript_version),
      },
    };
  }
  return { pick, error: "conversation_missing" };
}

async function ensureAnalysisJob(conversationId: string) {
  const conversation = await getLeadConversationModel().findById(conversationId).select({ latest_transcript_version: 1 }).lean();
  const snapshot = await getIntelligenceEvidenceSnapshotModel()
    .findOne({ conversation_id: conversationId, source_type: "transcript", "completeness.complete": true })
    .sort({ _id: -1 })
    .select({ _id: 1 })
    .lean();
  if (!conversation?.latest_transcript_version || !snapshot) return { error: "transcript_incomplete" as const };
  const existing = await getSalesIntelligenceJobModel()
    .findOne({
      ...csiDataset(),
      stage: "analysis",
      subject_key: `conversation:${conversationId}`,
      "input_refs.0": conversationId,
      "input_refs.1": String(snapshot._id),
      status: { $nin: ["completed", "dead_letter"] },
    })
    .sort({ priority: -1, _id: -1 })
    .lean();
  const priorRun = existing
    ? await getIntelligenceRunModel().findOne({ job_id: existing._id }).select({ model_version: 1, status: 1 }).lean()
    : null;
  const modelMatches = !priorRun || priorRun.model_version === analysisRuntimeConfiguration().model_id;
  const claimable = existing?.status === "pending" || existing?.status === "retry" || (existing?.status === "paused" && existing.reason === "budget_exhausted");
  if (existing && modelMatches && claimable) {
    if (existing.status === "paused" && existing.reason === "budget_exhausted") {
      await getSalesIntelligenceJobModel().updateOne(
        { _id: existing._id, status: "paused", reason: "budget_exhausted" },
        { $set: { status: "pending", reason: null, next_attempt_at: new Date() } },
      );
    }
    return { job_id: String(existing._id), created: false, prior_status: existing.status, prior_reason: existing.reason ?? null };
  }
  const job = await withTransaction((session) =>
    enqueueCsiJob(
      {
        stage: "analysis",
        subject_key: `conversation:${conversationId}`,
        dedupe_key: `csi:analysis:conversation:${conversationId}:${conversation.latest_transcript_version}:owner-demo`,
        input_revision: 1,
        input_refs: [conversationId, String(snapshot._id)],
        priority: 0,
      },
      session,
    ),
  );
  return { job_id: String(job._id), created: true, prior_status: job.status, prior_reason: job.reason ?? null };
}

async function runSubject(resolved: Awaited<ReturnType<typeof resolvePick>>) {
  if (!("conversation_id" in resolved) || !resolved.conversation_id) return { ...resolved, hops: [] };
  const started = new Date().toISOString();
  const hops: Record<string, unknown>[] = [];
  hops.push({ hop: "attachment_outreach", at: started, ...resolved.summary });
  const ensured = await ensureAnalysisJob(resolved.conversation_id);
  hops.push({ hop: "analysis_job", at: new Date().toISOString(), ...("job_id" in ensured ? { job: mask(ensured.job_id), created: ensured.created, prior_status: ensured.prior_status, prior_reason: ensured.prior_reason } : ensured) });
  if (!("job_id" in ensured)) return { summary: resolved.summary, hops };

  const analysis = await runIntelligenceJob(ensured.job_id, "analysis");
  const run = "run_id" in analysis && analysis.run_id
    ? await getIntelligenceRunModel().findById(analysis.run_id).select({ status: 1, processing_reason: 1, usage: 1, model_version: 1, completed_at: 1 }).lean()
    : await getIntelligenceRunModel().findOne({ conversation_id: resolved.conversation_id }).sort({ _id: -1 }).select({ status: 1, processing_reason: 1, usage: 1, model_version: 1, completed_at: 1 }).lean();
  hops.push({
    hop: "analysis",
    at: new Date().toISOString(),
    result: analysis.status,
    reason: "reason" in analysis ? analysis.reason ?? null : null,
    run: run ? mask(run._id) : null,
    run_status: run?.status ?? null,
    processing_reason: run?.processing_reason ?? null,
    model: run?.model_version ?? null,
    usage: run?.usage ? { input_tokens: run.usage.input_tokens, output_tokens: run.usage.output_tokens, reasoning_tokens: run.usage.reasoning_tokens, actual_cents: run.usage.actual_cents, usage_complete: run.usage.usage_complete } : null,
  });

  let application: { status: string } | null = null;
  if (analysis.status === "submitted" && "run_id" in analysis && analysis.run_id) {
    const applyJob = await getSalesIntelligenceJobModel().findOne({ stage: "application", "input_refs.0": analysis.run_id }).sort({ _id: -1 }).select({ status: 1, reason: 1 }).lean();
    if (applyJob && applyJob.status !== "completed") {
      if (applyJob.status === "paused") {
        await getSalesIntelligenceJobModel().updateOne(
          { _id: applyJob._id, status: "paused" },
          { $set: { status: "pending", reason: null, next_attempt_at: new Date() } },
        );
      }
      application = await runIntelligenceApplicationJob(String(applyJob._id));
    } else if (applyJob) {
      application = { status: applyJob.status };
    }
    const effects = await getIntelligenceEffectModel().find({ run_id: analysis.run_id }).select({ effect_kind: 1, status: 1, reason: 1 }).lean();
    hops.push({
      hop: "application",
      at: new Date().toISOString(),
      job: applyJob ? mask(applyJob._id) : null,
      result: application?.status ?? "missing",
      effects: effects.map((effect) => ({ kind: effect.effect_kind, status: effect.status, reason: typeof effect.reason === "string" && /^[a-z0-9_]+$/.test(effect.reason) ? effect.reason : effect.reason ? "present" : null })),
    });
  }

  const scheduled = await withTransaction((session) => scheduleNumberIntelligence(resolved.number_id, session));
  let synthesis: { status: string; reason?: string } | null = null;
  if (scheduled) {
    const refresh = await getSalesIntelligenceJobModel().findById(scheduled).select({ status: 1, next_attempt_at: 1 }).lean();
    if (refresh && refresh.status === "pending" && refresh.next_attempt_at && refresh.next_attempt_at > new Date()) {
      await getSalesIntelligenceJobModel().updateOne({ _id: refresh._id, status: "pending" }, { $set: { next_attempt_at: new Date() } });
    }
    if (refresh && refresh.status !== "completed") synthesis = await runIntelligenceJob(scheduled, "number_refresh");
    else synthesis = { status: refresh?.status ?? "missing" };
  }
  const number = await getContactNumberModel().findById(resolved.number_id).select({ running_summary: 1 }).lean();
  const summaryRun = number?.running_summary?.run_id
    ? await getIntelligenceRunModel().findById(number.running_summary.run_id).select({ status: 1, usage: 1, mode: 1 }).lean()
    : null;
  hops.push({
    hop: "number_synthesis",
    at: new Date().toISOString(),
    job: scheduled ? mask(scheduled) : null,
    result: synthesis?.status ?? "not_scheduled",
    running_summary: Boolean(number?.running_summary?.text),
    summary_run: summaryRun ? mask(summaryRun._id) : null,
    summary_status: summaryRun?.status ?? null,
    summary_cents: summaryRun?.usage?.actual_cents ?? null,
  });

  const outreach = resolved.outreach_id
    ? await getOutreachRecordModel().findById(resolved.outreach_id).select({ state: 1, closed_reason: 1, revision: 1 }).lean()
    : null;
  const followups = resolved.outreach_id
    ? await getOutreachFollowupModel().find({ outreach_record_id: resolved.outreach_id }).select({ kind: 1, status: 1, origin: 1 }).lean()
    : [];
  const reviews = await getSalesIntelligenceReviewItemModel().find({ subject_key: `lead:${resolved.pick.model}:${resolved.lead_id}`, state: "open" }).select({ cause_kind: 1, state: 1 }).lean();
  const reservation = run
    ? await getSalesIntelligenceAiReservationModel().find({ run_id: run._id }).select({ status: 1, estimated_cents: 1, actual_cents: 1, stage: 1 }).lean()
    : [];
  hops.push({
    hop: "outreach_after",
    at: new Date().toISOString(),
    state: outreach?.state ?? null,
    closed_reason: outreach?.closed_reason ?? null,
    revision: outreach?.revision ?? null,
    followups: followups.map((row) => ({ kind: row.kind, status: row.status, origin: row.origin ?? null })),
    open_reviews: reviews.map((row) => row.cause_kind),
    reservations: reservation.map((row) => ({ stage: row.stage, status: row.status, estimated_cents: row.estimated_cents, actual_cents: row.actual_cents })),
  });
  return { summary: resolved.summary, hops };
}

async function attentionFor(subjects: { job_no: string; lead_id: string }[]) {
  const snapshot = await getSalesIntelligenceAttentionSnapshotModel()
    .findOne({ ...csiDataset(), chunk_index: null, $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] })
    .sort({ as_of: -1 })
    .select({ snapshot_id: 1, as_of: 1, expires_at: 1, counts: 1, rows: 1, rows_gzip_base64: 1 })
    .lean();
  const wanted = new Map(subjects.map((row) => [row.lead_id, row.job_no]));
  let rows: unknown[] = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (snapshot?.rows_gzip_base64) rows = decompressAttentionRows(snapshot.rows_gzip_base64);
  else if (snapshot?.counts?.chunks) {
    const chunks = await getSalesIntelligenceAttentionSnapshotModel().find({ ...csiDataset(), parent_snapshot_id: snapshot.snapshot_id }).sort({ chunk_index: 1 }).lean();
    rows = chunks.flatMap(chunk => Array.isArray(chunk.rows) ? chunk.rows : []);
  }
  const hits = rows.flatMap((row) => {
    const record = row as { subject?: { id?: string }; derived?: { attention_band?: number | null } };
    const job = record.subject?.id ? wanted.get(String(record.subject.id)) : undefined;
    return job ? [{ job_no: job, band: record.derived?.attention_band ?? null }] : [];
  });
  return {
    snapshot: snapshot ? { id: snapshot.snapshot_id, as_of: snapshot.as_of, expires_at: snapshot.expires_at, total: snapshot.counts?.total_items ?? rows.length } : null,
    hits,
  };
}

function safeReason(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_]+$/.test(value) ? value : value ? "present" : null;
}

async function finishSubject(row: Extract<Awaited<ReturnType<typeof resolvePick>>, { conversation_id: string }>) {
  const run = await getIntelligenceRunModel()
    .findOne({ conversation_id: row.conversation_id, mode: { $ne: "number_refresh" } })
    .sort({ _id: -1 })
    .select({ status: 1, processing_reason: 1, usage: 1, result_counts: 1, completed_at: 1 })
    .lean();
  const analysisJob = await getSalesIntelligenceJobModel()
    .findOne({ ...csiDataset(), stage: "analysis", "input_refs.0": row.conversation_id })
    .sort({ _id: -1 })
    .select({ status: 1, reason: 1, result: 1, attempts: 1 })
    .lean();
  const refreshRuns = await getIntelligenceRunModel()
    .find({ contact_number_id: row.number_id, mode: "number_refresh" })
    .sort({ _id: -1 })
    .limit(2)
    .select({ status: 1, processing_reason: 1, usage: 1, completed_at: 1 })
    .lean();
  const number = await getContactNumberModel().findById(row.number_id).select({ running_summary: 1 }).lean();
  const outreach = row.outreach_id
    ? await getOutreachRecordModel().findById(row.outreach_id).lean()
    : null;
  const coverage = await readCaptureCoverage();
  const dto = outreach ? await toOutreachDto(outreach, new Date(), coverage) : null;
  const reviews = await getSalesIntelligenceReviewItemModel()
    .find({ subject_key: { $in: [`lead:${row.pick.model}:${row.lead_id}`, `number:${row.number_id}`, `conversation:${row.conversation_id}`] }, state: "open" })
    .select({ cause_kind: 1, subject_key: 1 })
    .lean();
  const effects = run
    ? await getIntelligenceEffectModel().find({ run_id: run._id }).select({ effect_kind: 1, status: 1, reason: 1 }).lean()
    : [];
  return {
    job_no: row.pick.job_no,
    role: row.pick.role,
    run_status: run?.status ?? null,
    processing_reason: run?.processing_reason ?? null,
    completed_at: run?.completed_at ?? null,
    result_counts: run?.result_counts ?? null,
    actual_cents: run?.usage?.actual_cents ?? null,
    analysis_job: analysisJob ? { id: mask(analysisJob._id), status: analysisJob.status, reason: analysisJob.reason ?? null, result_reason: safeReason((analysisJob.result as { reason?: string } | null)?.reason), attempts: analysisJob.attempts } : null,
    refresh: refreshRuns.map((item) => ({ id: mask(item._id), status: item.status, reason: item.processing_reason ?? null, cents: item.usage?.actual_cents ?? null })),
    running_summary: Boolean(number?.running_summary?.text),
    outreach_state: outreach?.state ?? null,
    band: dto?.derived.attention_band ?? null,
    band_reasons: dto?.derived.reasons ?? [],
    effects: effects.map((effect) => ({ kind: effect.effect_kind, status: effect.status, reason: safeReason(effect.reason) })),
    open_reviews: reviews.map((item) => ({ cause: item.cause_kind, subject: item.subject_key.split(":")[0] })),
  };
}

async function applySubmittedRefresh(numberId: string) {
  const runs = await getIntelligenceRunModel().find({ contact_number_id: numberId, mode: "number_refresh", status: "submitted" }).select({ _id: 1 }).lean();
  const applied = [];
  for (const run of runs) {
    const job = await getSalesIntelligenceJobModel().findOne({ stage: "application", "input_refs.0": String(run._id) }).sort({ _id: -1 }).lean();
    if (!job) {
      applied.push({ run: mask(run._id), status: "application_missing" });
      continue;
    }
    if (job.status === "completed") {
      applied.push({ run: mask(run._id), status: "already_completed" });
      continue;
    }
    if (job.status === "paused") {
      await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "paused" }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
    }
    const result = await runIntelligenceApplicationJob(String(job._id));
    applied.push({ run: mask(run._id), job: mask(job._id), status: result.status });
  }
  return applied;
}

async function retryConversation(row: Extract<Awaited<ReturnType<typeof resolvePick>>, { conversation_id: string }>) {
  const snapshot = await getIntelligenceEvidenceSnapshotModel()
    .findOne({ conversation_id: row.conversation_id, source_type: "transcript", "completeness.complete": true })
    .sort({ _id: -1 })
    .select({ _id: 1 })
    .lean();
  const version = (await getLeadConversationModel().findById(row.conversation_id).select({ latest_transcript_version: 1 }).lean())?.latest_transcript_version;
  if (!snapshot || !version) return { status: "transcript_incomplete" };
  const job = await withTransaction((session) =>
    enqueueCsiJob(
      {
        stage: "analysis",
        subject_key: `conversation:${row.conversation_id}`,
        dedupe_key: `csi:analysis:conversation:${row.conversation_id}:${version}:owner-demo-repair-2026-09-21`,
        input_revision: 1,
        input_refs: [row.conversation_id, String(snapshot._id)],
        priority: 0,
      },
      session,
    ),
  );
  if (job.status === "paused" && job.reason === "budget_exhausted") {
    await getSalesIntelligenceJobModel().updateOne({ _id: job._id, status: "paused", reason: "budget_exhausted" }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
  }
  const analysis = await runIntelligenceJob(String(job._id), "analysis", {
    beforeProvider: async () => { console.log(JSON.stringify({ phase: "provider_start", job_no: row.pick.job_no, at: new Date().toISOString() })); },
    onError: error => { console.log(JSON.stringify({ phase: "analysis_error", name: error instanceof Error ? error.name : "unknown", code: (error as { code?: unknown; statusCode?: number }).code, statusCode: (error as { statusCode?: number }).statusCode })); },
  });
  let application: string | null = null;
  if (analysis.status === "submitted" && "run_id" in analysis && analysis.run_id) {
    const applyJob = await getSalesIntelligenceJobModel().findOne({ stage: "application", "input_refs.0": analysis.run_id }).sort({ _id: -1 }).lean();
    if (applyJob && applyJob.status !== "completed") {
      if (applyJob.status === "paused") {
        await getSalesIntelligenceJobModel().updateOne({ _id: applyJob._id, status: "paused" }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
      }
      application = (await runIntelligenceApplicationJob(String(applyJob._id))).status;
    }
  }
  return { job: mask(job._id), analysis: analysis.status, reason: "reason" in analysis ? safeReason(analysis.reason) : null, application };
}

async function finish(resolved: Awaited<ReturnType<typeof resolvePick>>[]) {
  const ready = resolved.filter((row): row is Extract<typeof row, { conversation_id: string }> => "conversation_id" in row);
  const before = [];
  for (const row of ready) before.push(await finishSubject(row));
  console.log(JSON.stringify({ phase: "finish_before", subjects: before }));
  if (!WRITE) return;
  const repairs = [];
  for (const row of ready) {
    const current = before.find((item) => item.job_no === row.pick.job_no);
    const needsAnalysis = !current || !["submitted", "completed"].includes(String(current.run_status));
    const analysis = needsAnalysis ? await retryConversation(row) : { status: "kept" };
    const refreshApplied = await applySubmittedRefresh(row.number_id);
    const number = await getContactNumberModel().findById(row.number_id).select({ running_summary: 1 }).lean();
    let synthesis: { status: string; reason?: string | null } | null = null;
    if (!number?.running_summary?.text) {
      const scheduled = await withTransaction((session) => scheduleNumberIntelligence(row.number_id, session));
      if (scheduled) {
        const refresh = await getSalesIntelligenceJobModel().findById(scheduled).select({ status: 1, next_attempt_at: 1, reason: 1 }).lean();
        if (refresh && ["pending", "retry"].includes(refresh.status)) {
          if (refresh.next_attempt_at && refresh.next_attempt_at > new Date()) {
            await getSalesIntelligenceJobModel().updateOne({ _id: refresh._id, status: refresh.status }, { $set: { next_attempt_at: new Date() } });
          }
          const ran = await runIntelligenceJob(scheduled, "number_refresh");
          synthesis = { status: ran.status, reason: "reason" in ran ? safeReason(ran.reason) : null };
          if (ran.status === "submitted") await applySubmittedRefresh(row.number_id);
        } else {
          synthesis = { status: refresh?.status ?? "missing", reason: safeReason(refresh?.reason) };
        }
      } else {
        synthesis = { status: "not_scheduled" };
      }
    }
    repairs.push({ job_no: row.pick.job_no, analysis, refreshApplied, synthesis });
    console.log(JSON.stringify({ phase: "finish_subject", job_no: row.pick.job_no, analysis, refreshApplied, synthesis }));
  }
  const published = process.argv.includes("--skip-publish")
    ? { status: "skipped" }
    : await publishAttentionSnapshot({ deadlineMs: 600_000 });
  const attention = await attentionFor(ready.map((row) => ({ job_no: row.pick.job_no, lead_id: row.lead_id })));
  const after = [];
  for (const row of ready) after.push(await finishSubject(row));
  console.log(JSON.stringify({ phase: "finish_after", published, attention, repairs, subjects: after }));
}

async function main() {
  if (isTestMode()) throw new Error("Refusing TEST_MODE.");
  const admission = preflight();
  console.log(JSON.stringify({ phase: "preflight", write: WRITE, finish: FINISH, admission }));
  if (WRITE && !admission.ready) throw new Error("Local analysis admission is not ready. Refusing to spend.");
  await connectMongo();
  const resolved = [];
  const onlyJob = process.argv.find(arg => arg.startsWith("--job="))?.slice(6);
  if (onlyJob && !PICKS.some(pick => pick.job_no === onlyJob)) throw new Error("Job is not in the reviewed demo set");
  for (const pick of PICKS.filter(pick => !onlyJob || pick.job_no === onlyJob)) resolved.push(await resolvePick(pick));
  if (FINISH) {
    await finish(resolved);
    return;
  }
  console.log(JSON.stringify({
    phase: "selected",
    subjects: resolved.map((row) => ("summary" in row ? row.summary : { ...row.pick, error: "error" in row ? row.error : "unresolved" })),
  }));
  if (!WRITE) return;
  const results = [];
  for (const row of resolved) {
    if (!("conversation_id" in row)) {
      results.push(row);
      continue;
    }
    console.log(JSON.stringify({ phase: "subject_start", job_no: row.pick.job_no }));
    const result = await runSubject(row);
    results.push(result);
    console.log(JSON.stringify({ phase: "subject_done", job_no: row.pick.job_no, hops: "hops" in result ? result.hops : result }));
  }
  const published = await publishAttentionSnapshot({ deadlineMs: 180_000 });
  const attention = await attentionFor(
    resolved.flatMap((row) => ("lead_id" in row && row.lead_id ? [{ job_no: row.pick.job_no, lead_id: row.lead_id }] : [])),
  );
  console.log(JSON.stringify({ phase: "attention", published, attention, results }));
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
