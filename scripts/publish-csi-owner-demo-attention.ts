/**
 * Publish one Attention snapshot with a deadline long enough for the full
 * Outreach walk. Prints the snapshot header and whether the four demo job
 * numbers are present. No phones, names, or transcripts.
 *
 *   pnpm exec tsx --env-file=.env scripts/publish-csi-owner-demo-attention.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getCallLeadModel } from "../src/models/CallLead";
import { getFormLeadModel } from "../src/models/FormLead";
import { publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";

const JOBS = ["5563953", "5564267", "5564618", "5564791"];

async function main() {
  await connectMongo();
  const started = Date.now();
  const published = await publishAttentionSnapshot({ deadlineMs: 55 * 60 * 1000 });
  const snapshot = await getSalesIntelligenceAttentionSnapshotModel()
    .findOne({ expires_at: { $gt: new Date() }, $or: [{ chunk_index: null }, { chunk_index: { $exists: false } }] })
    .sort({ as_of: -1 })
    .select({ snapshot_id: 1, as_of: 1, expires_at: 1, counts: 1, rows: 1 })
    .lean();
  const leads = await Promise.all(JOBS.map(async (job_no) => {
    const form = await getFormLeadModel().findOne({ $or: [{ job_no }, { normalized_job_no: job_no }] }).select({ _id: 1 }).lean();
    const call = form ? null : await getCallLeadModel().findOne({ $or: [{ job_no }, { normalized_job_no: job_no }] }).select({ _id: 1 }).lean();
    return { job_no, lead_id: String((form ?? call)?._id ?? "") };
  }));
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const hits = leads.map((lead) => {
    const row = rows.find((item) => {
      const subject = item as { subject?: { id?: string }; derived?: { attention_band?: number | null; reasons?: string[] } };
      return subject.subject?.id === lead.lead_id;
    }) as { derived?: { attention_band?: number | null; reasons?: string[] } } | undefined;
    return { job_no: lead.job_no, present: Boolean(row), band: row?.derived?.attention_band ?? null, reasons: row?.derived?.reasons ?? [] };
  });
  console.log(JSON.stringify({
    elapsed_ms: Date.now() - started,
    published,
    snapshot: snapshot ? { id: snapshot.snapshot_id, as_of: snapshot.as_of, expires_at: snapshot.expires_at, total: snapshot.counts?.total_items ?? rows.length } : null,
    hits,
  }));
}

main().then(() => mongoose.disconnect()).catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
