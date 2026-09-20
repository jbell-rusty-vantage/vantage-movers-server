/**
 * Fast status for the three attention subjects. Redacted ids only.
 *   pnpm exec tsx --env-file=.env --env-file=sales-intelligence.env scripts/status-csi-attention-subjects.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";

const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 8 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
};

const IDS = {
  "5564662": "6ab036430c84337849a0ab47",
  "5564549": "6ab027f00c84337849a072d6",
  lead_only: "6ab0282c0c84337849a07454",
};

async function main() {
  await connectMongo();
  for (const [label, id] of Object.entries(IDS)) {
    const conversation = await getLeadConversationModel().findById(id).lean();
    const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ conversation_id: id, source_type: "transcript" }).sort({ _id: -1 }).select({ completeness: 1 }).lean();
    const run = await getIntelligenceRunModel().findOne({ conversation_id: id }).sort({ _id: -1 }).select({ status: 1, processing_reason: 1, model_version: 1 }).lean();
    const jobs = await getSalesIntelligenceJobModel().find({
      $or: [{ "input_refs.0": id }, { subject_key: `conversation:${id}` }, { dedupe_key: new RegExp(id) }],
    }).select({ stage: 1, status: 1, reason: 1, dedupe_key: 1, leased_until: 1 }).sort({ _id: -1 }).limit(8).lean();
    const edges = conversation?.contact_number_id
      ? await getNumberLeadAttachmentModel().find({ contact_number_id: conversation.contact_number_id }).select({ state: 1, certainty: 1, lead_ref: 1 }).lean()
      : [];
    console.log(label, {
      conversation: mask(id),
      state: conversation?.state ?? null,
      eligibility: conversation?.analysis_eligibility?.status ?? null,
      transcript: Boolean(conversation?.latest_transcript_version),
      snapshot: Boolean(snapshot),
      edges: edges.map(edge => `${edge.state}/${edge.certainty} ${edge.lead_ref.model} ${mask(edge.lead_ref.id)}`),
      run: run ? `${mask(run._id)} ${run.status} ${run.processing_reason ?? ""}`.trim() : null,
      jobs: jobs.map(job => `${job.stage}:${job.status}${job.reason ? `:${job.reason}` : ""} ${job.dedupe_key.includes("live-desk") ? "live-desk" : ""}`.trim()),
    });
  }
  const now = new Date();
  const snaps = await getSalesIntelligenceAttentionSnapshotModel().find().sort({ as_of: -1 }).limit(3).select({ snapshot_id: 1, as_of: 1, expires_at: 1, counts: 1 }).lean();
  console.log("snapshots", snaps.map(row => ({
    id: row.snapshot_id,
    as_of: row.as_of,
    expires_at: row.expires_at,
    live: row.expires_at ? row.expires_at > now : false,
    total: row.counts?.total_items ?? null,
  })));
}

main().then(async () => { await mongoose.disconnect(); }).catch(async error => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
