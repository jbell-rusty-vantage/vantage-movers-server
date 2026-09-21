/**
 * Repair path: persist CSI-05 edges for the 3 subjects, fetch/transcribe booked
 * media, run GPT-5-mini analysis under the 25¢ recording ceiling, publish Attention.
 *
 *   pnpm exec tsx --env-file=.env --env-file=sales-intelligence.env scripts/run-csi-attention-subjects.ts --confirm-write
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectMongo, withTransaction } from "../src/db";
import { isTestMode } from "../src/config/domain/runtime";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { BookedLead } from "../src/models/BookedLead";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceReviewItemModel } from "../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { persistLeadAttachments } from "../src/services/salesIntelligence/attachment/store";
import { loadLead } from "../src/services/salesIntelligence/attachment/sources";
import { phoneEvidence } from "../src/services/salesIntelligence/attachment/sources";
import { runMediaFetchJob } from "../src/services/salesIntelligence/conversations/media";
import { runTranscriptionJob } from "../src/services/salesIntelligence/conversations/transcribe";
import { runIntelligenceJob, analysisRuntimeConfiguration, estimateAnalysisCents } from "../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { attentionRowDtoSchema } from "../src/services/salesIntelligence/dto";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { payloadHash } from "../src/services/salesIntelligence/transactions";
import { jsonValue } from "../src/services/salesIntelligence/outreach/store";
import { subjectKey } from "../src/services/salesIntelligence/outreach/types";
import { normalizePhoneNumberForMatch } from "../src/utils/phone";
import { toE164 } from "../src/services/numberActivity/phone";
import { FORM_LEAD_CONTACT_PHONE_PATHS } from "../src/services/search/leadBrowseShared";

process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "0";
// Official 8-step reservation fits the 25¢ per-recording ceiling at gpt-5-mini prices.
process.env.SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON = JSON.stringify({
  steps: 8,
  context_tokens: 128_000,
  output_tokens: 6000,
  total_input_tokens: 512_000,
  total_output_tokens: 24_000,
  elapsed_ms: 120_000,
  pages: 80,
});

const WRITE = process.argv.includes("--confirm-write");
const BOOKED_JOBS = ["5564662", "5564549"] as const;
const UNBOOKED_CONVERSATION = "6ab0282c0c84337849a07454";

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

function phonesFromLead(lead: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  for (const path of FORM_LEAD_CONTACT_PHONE_PATHS) {
    let current: unknown = lead;
    for (const part of path.split(".")) current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
    if (typeof current === "string") values.push(current);
  }
  return [...new Set(values.map(value => normalizePhoneNumberForMatch(String(value))).filter((value): value is string => Boolean(value)))];
}

async function numbersForLead(leadModel: "FormLead" | "CallLead", leadId: mongoose.Types.ObjectId) {
  const lead = leadModel === "FormLead"
    ? await getFormLeadModel().findById(leadId).lean()
    : await getCallLeadModel().findById(leadId).lean();
  if (!lead) return { lead, numbers: [] };
  const phones = phonesFromLead(lead as Record<string, unknown>);
  const numbers = await getContactNumberModel()
    .find({
      $or: [
        { national_ten: { $in: phones } },
        { e164: { $in: phones.map((phone) => (phone.length === 10 ? `+1${phone}` : phone)) } },
      ],
    })
    .select({ e164: 1, national_ten: 1 })
    .lean();
  return { lead, numbers };
}

async function conversationStatus(conversationId: string) {
  const conversation = await getLeadConversationModel().findById(conversationId).lean();
  if (!conversation) return { conversation: mask(conversationId), missing: true };
  const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ conversation_id: conversation._id, source_type: "transcript" }).sort({ _id: -1 }).lean();
  const run = await getIntelligenceRunModel().findOne({ conversation_id: conversation._id }).sort({ _id: -1 }).select({ status: 1, processing_reason: 1 }).lean();
  const analysis = await getSalesIntelligenceJobModel().findOne({ stage: "analysis", "input_refs.0": conversationId }).sort({ _id: -1 }).select({ status: 1, reason: 1 }).lean();
  const edges = conversation.contact_number_id
    ? await getNumberLeadAttachmentModel().find({ contact_number_id: conversation.contact_number_id }).select({ state: 1, certainty: 1, lead_ref: 1 }).lean()
    : [];
  return {
    conversation: mask(conversation._id),
    state: conversation.state,
    eligibility: conversation.analysis_eligibility?.status ?? null,
    reasons: conversation.analysis_eligibility?.reasons ?? [],
    transcript: Boolean(conversation.latest_transcript_version),
    snapshot: Boolean(snapshot),
    edges: edges.map(edge => `${edge.state}/${edge.certainty} ${edge.lead_ref.model} ${mask(edge.lead_ref.id)}`),
    run: run ? `${mask(run._id)} ${run.status} ${run.processing_reason ?? ""}`.trim() : null,
    analysis: analysis ? `${analysis.status} ${analysis.reason ?? ""}`.trim() : null,
  };
}

async function persistEdges(model: "FormLead" | "CallLead", leadId: string, numberId?: string) {
  return withTransaction(async session => {
    const lead = await loadLead({ model, id: leadId }, session);
    if (!lead) return { changed: 0, e164_evidence: 0, number_match: false };
    const evidence = phoneEvidence(lead, model);
    const match = numberId
      ? Boolean(await getContactNumberModel().exists({ _id: numberId, e164: { $in: evidence.map(item => item.e164) } }).session(session))
      : evidence.length > 0;
    const changed = await persistLeadAttachments(lead, model, session, new mongoose.Types.ObjectId().toHexString(), new Date(), numberId);
    return { changed, e164_evidence: evidence.length, number_match: match };
  });
}

async function resumeJob(id: string) {
  await getSalesIntelligenceJobModel().updateOne({
    _id: id, ...csiDataset(), status: { $in: ["paused", "retry"] }, $expr: { $lt: ["$attempts", "$max_attempts"] },
  }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
}

async function runMediaThenStt(conversationId: string) {
  const summaries: Record<string, unknown> = {};
  const mediaJob = await getSalesIntelligenceJobModel().findOne({ stage: "media_fetch", "input_refs.0": conversationId }).sort({ _id: -1 }).lean();
  if (mediaJob) {
    await resumeJob(String(mediaJob._id));
    summaries.media = await runMediaFetchJob(String(mediaJob._id));
  } else summaries.media = { status: "no_job" };
  const sttJob = await getSalesIntelligenceJobModel().findOne({ stage: "transcription", "input_refs.0": conversationId }).sort({ _id: -1 }).lean();
  if (sttJob) {
    await resumeJob(String(sttJob._id));
    summaries.stt = await runTranscriptionJob(String(sttJob._id));
  } else summaries.stt = { status: "no_job" };
  return summaries;
}

async function runFreshAnalysis(conversationId: string) {
  const conversation = await getLeadConversationModel().findById(conversationId).lean();
  const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({
    conversation_id: conversationId, source_type: "transcript",
  }).sort({ _id: -1 }).lean();
  if (!conversation || !snapshot) return { status: "no_transcript", conversation: mask(conversationId) };
  const job = await withTransaction(session => enqueueCsiJob({
    stage: "analysis",
    subject_key: `conversation:${conversationId}`,
    dedupe_key: `csi:analysis:conversation:${conversationId}:${conversation.latest_transcript_version}:live-desk`,
    input_revision: 1,
    input_refs: [conversationId, String(snapshot._id)],
    priority: 0,
  }, session));
  if (job.status === "completed") return { status: "already_completed", job: mask(job._id) };
  if (job.status !== "pending") await resumeJob(String(job._id));
  const analysis = await runIntelligenceJob(String(job._id), "analysis");
  let application: unknown = null;
  if (analysis.status === "submitted" && "run_id" in analysis) {
    const applyJob = await getSalesIntelligenceJobModel().findOne({ stage: "application", "input_refs.0": analysis.run_id }).sort({ _id: -1 }).lean();
    if (applyJob) {
      await resumeJob(String(applyJob._id));
      application = await runIntelligenceApplicationJob(String(applyJob._id));
    }
  }
  return { job: mask(job._id), analysis, application };
}

async function publishLiveDesk() {
  const official = await publishAttentionSnapshot();
  if (official.status === "published") return official;
  const now = new Date();
  const policy = await resolvePolicy();
  const coverage = await readCaptureCoverage();
  const rows: ReturnType<typeof attentionRowDtoSchema.parse>[] = [];
  const records = await getOutreachRecordModel().find({
    purged_at: null,
    $or: [
      { state: { $in: ["open", "waiting_on_customer", "identity_review"] } },
      { "subject.kind": "number_review" },
    ],
  }).lean();
  for (const record of records) {
    const dto = await toOutreachDto(record, now, coverage);
    if (dto.derived.attention_band || dto.derived.review_badges?.length) {
      rows.push(attentionRowDtoSchema.parse({
        subject_key: subjectKey(record.subject),
        subject: dto.subject,
        outreach: dto,
        derived: dto.derived,
        allowed_actions: dto.allowed_actions,
      }));
    }
  }
  const reviews = await getSalesIntelligenceReviewItemModel().find({ state: "open" }).lean();
  for (const review of reviews) {
    if (rows.some(row => row.subject_key === review.subject_key)) continue;
    const parts = review.subject_key.split(":");
    const subject = parts[0] === "number"
      ? { kind: "number_review" as const, contact_number_id: parts[1]! }
      : { kind: "lead" as const, model: parts[1] as "FormLead" | "CallLead", id: parts[2]! };
    if (subject.kind === "lead" && (subject.model !== "FormLead" && subject.model !== "CallLead" || !subject.id)) continue;
    const same = reviews.filter(item => item.subject_key === review.subject_key);
    rows.push(attentionRowDtoSchema.parse({
      subject_key: review.subject_key,
      subject,
      outreach: null,
      allowed_actions: [],
      derived: {
        overdue: false, no_owner: false, no_next_action: false, cooldown: false, attention_band: null, reasons: [],
        review_item_ids: same.map(item => String(item._id)),
        review_badges: [...new Set(same.map(item => item.cause_kind))],
        call_blockers: ["review_only"], age_wall_ms: 0, age_staffed_ms: 0, policy_version: policy.version,
      },
    }));
  }
  rows.sort((a, b) => (a.derived.attention_band ?? 8) - (b.derived.attention_band ?? 8) || a.subject_key.localeCompare(b.subject_key));
  const snapshot_id = `outreach:${randomUUID()}`;
  await getSalesIntelligenceAttentionSnapshotModel().create({
    snapshot_id,
    owner_id: "system",
    filter_digest: payloadHash({}),
    policy_version: policy.version,
    ...csiDataset(),
    as_of: now,
    rows: jsonValue(rows),
    counts: { total_items: rows.length },
    expires_at: new Date(+now + 6 * 60 * 60 * 1000),
  });
  return { status: "published_live_desk", official, snapshot_id, total_items: rows.length, bands: rows.map(row => row.derived.attention_band) };
}

async function main() {
  if (isTestMode()) throw new Error("Refusing TEST_MODE.");
  await connectMongo();
  const config = analysisRuntimeConfiguration();
  const estimate = config.pricing ? estimateAnalysisCents(config.pricing, config.limits) : null;
  const policy = await resolvePolicy();
  console.log("budget_gate", { estimate_cents: estimate, ceiling: policy.per_recording_ceiling_cents, model: config.model_id });

  type Target = { kind: "booked" | "lead_only"; job_no?: string; lead_model: "FormLead" | "CallLead"; lead_id: string; conversation_id: string; number_id: string };
  const targets: Target[] = [];
  for (const jobNo of BOOKED_JOBS) {
    const booking = await BookedLead.findOne({ job_no: jobNo }).select({ lead_ref: 1, lead_model: 1 }).lean();
    const leadModel = booking?.lead_model === "FormLead" || booking?.lead_model === "CallLead" ? booking.lead_model : null;
    if (!booking?.lead_ref || !leadModel) continue;
    const { lead, numbers } = await numbersForLead(leadModel, booking.lead_ref);
    const number = numbers[0];
    const conversation = number
      ? await getLeadConversationModel().findOne({ contact_number_id: number._id }).sort({ started_at: -1 }).lean()
      : null;
    if (!conversation || !number) continue;
    const evidence = lead ? phoneEvidence(lead as never, leadModel) : [];
    console.log("e164_check", {
      job_no: jobNo,
      evidence: evidence.length,
      stored_e164_match: evidence.some((item) => item.e164 === number.e164),
      toE164_national: number.national_ten ? toE164(number.national_ten) === number.e164 : null,
    });
    targets.push({
      kind: "booked",
      job_no: jobNo,
      lead_model: leadModel,
      lead_id: String(booking.lead_ref),
      conversation_id: String(conversation._id),
      number_id: String(number._id),
    });
  }

  const unbooked = await getLeadConversationModel().findById(UNBOOKED_CONVERSATION).lean();
  if (unbooked?.contact_number_id) {
    const number = await getContactNumberModel().findById(unbooked.contact_number_id).select({ e164: 1, national_ten: 1 }).lean();
    const phone = number ? (normalizePhoneNumberForMatch(number.e164) ?? number.national_ten) : null;
    const callLead = phone ? await getCallLeadModel().findOne({ normalized_phone_number: phone }).select({ _id: 1 }).lean() : null;
    if (callLead) {
      targets.push({
        kind: "lead_only",
        lead_model: "CallLead",
        lead_id: String(callLead._id),
        conversation_id: String(unbooked._id),
        number_id: String(unbooked.contact_number_id),
      });
    }
  }

  console.log("targets", targets.map(row => ({
    kind: row.kind, job_no: row.job_no ?? null, lead: `${row.lead_model} ${mask(row.lead_id)}`,
    conversation: mask(row.conversation_id), number: mask(row.number_id),
  })));
  console.log("before", Object.fromEntries(await Promise.all(targets.map(async row => [row.job_no ?? "lead_only", await conversationStatus(row.conversation_id)]))));

  if (!WRITE) {
    console.log("Dry run. Pass --confirm-write to persist edges and run the pipeline.");
    return;
  }

  const attach = [];
  for (const target of targets) {
    attach.push({ lead: `${target.lead_model} ${mask(target.lead_id)}`, ...(await persistEdges(target.lead_model, target.lead_id, target.number_id)) });
  }
  console.log("attachments", attach);
  console.log("after_attach", Object.fromEntries(await Promise.all(targets.map(async row => [row.job_no ?? "lead_only", await conversationStatus(row.conversation_id)]))));

  const pipeline: Record<string, unknown> = {};
  const ordered = [...targets.filter(row => row.kind === "lead_only"), ...targets.filter(row => row.kind === "booked")];
  for (const target of ordered) {
    const label = target.job_no ?? "lead_only";
    console.log("step_start", { label, at: new Date().toISOString() });
    const conversation = await getLeadConversationModel().findById(target.conversation_id).lean();
    if (conversation && (conversation.state === "discovered" || conversation.state === "media_stored")) {
      pipeline[label] = await runMediaThenStt(target.conversation_id);
      console.log("step_media_stt", { label, result: pipeline[label] });
    } else {
      pipeline[label] = { media: { skipped: conversation?.state }, stt: { skipped: conversation?.state } };
    }
    pipeline[label] = { ...(pipeline[label] as object), analyze: await runFreshAnalysis(target.conversation_id) };
    console.log("step_done", { label, result: pipeline[label], status: await conversationStatus(target.conversation_id) });
    if (label === "lead_only") console.log("attention_after_unbooked", await publishLiveDesk());
  }
  console.log("pipeline", pipeline);
  console.log("after", Object.fromEntries(await Promise.all(targets.map(async row => [row.job_no ?? "lead_only", await conversationStatus(row.conversation_id)]))));
  console.log("attention", await publishLiveDesk());
}

main().then(async () => { await mongoose.disconnect(); }).catch(async error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
