/**
 * Continue booked analysis after media_stored. Redacted ids only.
 *   NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsx --env-file=.env --env-file=sales-intelligence.env scripts/continue-csi-booked-analysis.ts
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectMongo, withTransaction } from "../src/db";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { BookedLead } from "../src/models/BookedLead";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceReviewItemModel } from "../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { scheduleTranscriptionJobs } from "../src/services/salesIntelligence/conversations/transcriptionScheduling";
import { runTranscriptionJob } from "../src/services/salesIntelligence/conversations/transcribe";
import { runIntelligenceJob } from "../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../src/services/salesIntelligence/analysis/apply";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { attentionRowDtoSchema } from "../src/services/salesIntelligence/dto";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { payloadHash } from "../src/services/salesIntelligence/transactions";
import { jsonValue } from "../src/services/salesIntelligence/outreach/store";
import { subjectKey } from "../src/services/salesIntelligence/outreach/types";

process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "0";
process.env.SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON = JSON.stringify({
  steps: 8, context_tokens: 128_000, output_tokens: 6000,
  total_input_tokens: 800_000, total_output_tokens: 24_000, elapsed_ms: 180_000, pages: 80,
});

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

const BOOKED = "6ab027f00c84337849a072d6";

async function resumeJob(id: string) {
  await getSalesIntelligenceJobModel().updateOne({
    _id: id, ...csiDataset(), status: { $in: ["paused", "retry"] }, $expr: { $lt: ["$attempts", "$max_attempts"] },
  }, { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
}

async function analyze(conversationId: string) {
  const conversation = await getLeadConversationModel().findById(conversationId).lean();
  const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ conversation_id: conversationId, source_type: "transcript" }).sort({ _id: -1 }).lean();
  if (!conversation || !snapshot) return { status: "no_transcript", state: conversation?.state ?? null };
  const job = await withTransaction(session => enqueueCsiJob({
    stage: "analysis",
    subject_key: `conversation:${conversationId}`,
    dedupe_key: `csi:analysis:conversation:${conversationId}:${conversation.latest_transcript_version}:live-desk-3`,
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
    $or: [{ state: { $in: ["open", "waiting_on_customer", "identity_review"] } }, { "subject.kind": "number_review" }],
  }).lean();
  for (const record of records) {
    const dto = await toOutreachDto(record, now, coverage);
    if (dto.derived.attention_band || dto.derived.review_badges?.length) {
      rows.push(attentionRowDtoSchema.parse({
        subject_key: subjectKey(record.subject), subject: dto.subject, outreach: dto, derived: dto.derived, allowed_actions: dto.allowed_actions,
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
      subject_key: review.subject_key, subject, outreach: null, allowed_actions: [],
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
    snapshot_id, owner_id: "system", filter_digest: payloadHash({}), policy_version: policy.version, ...csiDataset(),
    as_of: now, rows: jsonValue(rows), counts: { total_items: rows.length }, expires_at: new Date(+now + 6 * 60 * 60 * 1000),
  });
  return { status: "published_live_desk", official, snapshot_id, total_items: rows.length, bands: rows.map(row => row.derived.attention_band) };
}

async function main() {
  await connectMongo();
  const booked = await BookedLead.findOne({ job_no: "5564549" }).select({ job_no: 1 }).lean();
  console.log("booked_job", booked?.job_no ?? null);
  console.log("schedule", await scheduleTranscriptionJobs(5));
  const sttJob = await getSalesIntelligenceJobModel().findOne({ stage: "transcription", "input_refs.0": BOOKED }).sort({ _id: -1 }).lean();
  console.log("stt_job", sttJob ? `${mask(sttJob._id)} ${sttJob.status} ${sttJob.reason ?? ""}`.trim() : null);
  if (sttJob && sttJob.status !== "completed") {
    await resumeJob(String(sttJob._id));
    console.log("stt", await runTranscriptionJob(String(sttJob._id)));
  }
  const conversation = await getLeadConversationModel().findById(BOOKED).select({ state: 1, latest_transcript_version: 1, analysis_eligibility: 1 }).lean();
  console.log("conversation", { state: conversation?.state, transcript: Boolean(conversation?.latest_transcript_version), eligibility: conversation?.analysis_eligibility?.status });
  console.log("analyze", await analyze(BOOKED));
  console.log("attention", await publishLiveDesk());
}

main().then(async () => { await mongoose.disconnect(); }).catch(async error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
