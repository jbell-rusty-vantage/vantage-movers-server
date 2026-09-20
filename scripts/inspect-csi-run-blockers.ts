/**
 * Budget, attachment, and job blockers for the three attention subjects.
 * Redacted ids only.
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { isTestMode } from "../src/config/domain/runtime";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";
import { analysisRuntimeConfiguration, estimateAnalysisCents } from "../src/services/salesIntelligence/analysis/worker";

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

async function main() {
  if (isTestMode()) throw new Error("Refusing TEST_MODE.");
  await connectMongo();
  const policy = await resolvePolicy();
  const config = analysisRuntimeConfiguration();
  const estimate = config.pricing ? estimateAnalysisCents(config.pricing, config.limits) : null;
  const budgets = await getSalesIntelligenceAiBudgetModel().find({}).sort({ period_start: -1 }).limit(3).lean();
  console.log("policy", {
    version: policy.version,
    per_recording_ceiling_cents: policy.per_recording_ceiling_cents,
    monthly_ceiling_cents: (policy as { monthly_ceiling_cents?: number }).monthly_ceiling_cents ?? null,
  });
  console.log("estimate_cents", estimate, "model", config.model_id, "pricing", config.pricing ? { version: config.pricing.version } : null);
  console.log("budgets", budgets.map(row => ({
    month: row.month,
    activated: Boolean(row.activated_at),
    reserved: row.reserved_cents,
    actual: row.actual_cents,
    remaining: (row as { remaining_cents?: number }).remaining_cents ?? null,
    ceiling: (row as { ceiling_cents?: number }).ceiling_cents ?? null,
    period_start: row.period_start,
    period_end: row.period_end,
  })));
  const edges = await getNumberLeadAttachmentModel().find({}).limit(20).lean();
  console.log("attachment_count", await getNumberLeadAttachmentModel().countDocuments({}));
  console.log("edges", edges.map(row => ({
    id: mask(row._id),
    number: mask(row.contact_number_id),
    lead: `${row.lead_ref.model} ${mask(row.lead_ref.id)}`,
    state: row.state,
    certainty: row.certainty,
  })));
  const jobs = await getSalesIntelligenceJobModel().find({
    $or: [
      { subject_key: { $regex: /6aaee2|6aac3e|6ab01f|6ab036|6ab027f0|6ab0282c|attachment-lead/ } },
      { "input_refs.0": { $in: ["6ab036430c84337849a0ab47", "6ab027f00c84337849a072d6", "6ab0282c0c84337849a07454"] } },
    ],
  }).select({ stage: 1, status: 1, reason: 1, subject_key: 1, "result.reason": 1, "result.changed": 1 }).lean();
  console.log("related_jobs", jobs.map(job => ({
    id: mask(job._id),
    stage: job.stage,
    status: job.status,
    reason: job.reason,
    result: (job as { result?: { reason?: string; changed?: number } }).result ?? null,
    subject: job.subject_key,
  })));
  const runs = await getIntelligenceRunModel().find({ conversation_id: "6ab0282c0c84337849a07454" }).select({ status: 1, processing_reason: 1, model_version: 1 }).lean();
  console.log("unbooked_runs", runs.map(run => ({ id: mask(run._id), status: run.status, reason: run.processing_reason, model: run.model_version })));
}

main().then(async () => { await mongoose.disconnect(); }).catch(async error => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
