/** Targeted, resumable 45-day Outreach backfill. Dry run unless --apply is supplied. */
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { connectMongo } from "../src/db";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { BookedLead } from "../src/models/BookedLead";
import { phoneEvidence } from "../src/services/salesIntelligence/attachment/sources";
import { officialClosure } from "../src/services/salesIntelligence/outreach/transitions";
import { analysisRuntimeConfiguration, estimateAnalysisCents } from "../src/services/salesIntelligence/analysis/worker";
import { executeBackfill } from "./outreach-backfill-execute";
import { backfillEvent } from "./outreach-backfill-history";
import { reportBackfill } from "./outreach-backfill-report";

async function main() {
  // Operational runs must not build application indexes as a connection side effect.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  backfillEvent({ phase: "started", database: mongoose.connection.name, apply: process.argv.includes("--apply"), resume: process.argv.includes("--resume") });
  const limit = Number(process.argv.find(a => a.startsWith("--limit="))?.slice(8) ?? 24);
  if (process.argv.includes("--report-only")) return reportBackfill(limit);
  if (process.argv.includes("--resume")) return executeBackfill(limit, process.argv.includes("--apply"));
  const now = new Date(), from = new Date(+now - 45 * 86400000);
  const numbers = await getContactNumberModel().find({ kind: "external", classification: { $nin: ["company", "non_customer"] } }).select({ e164: 1, contact_eligibility: 1 }).lean();
  const byPhone = new Map(numbers.map(n => [n.e164, n]));
  console.log(JSON.stringify({ phase: "connected", database: mongoose.connection.name, numbers: numbers.length }));
  const candidates = [];
  const counts: Record<string, number> = {};
  for (const model of ["FormLead", "CallLead"] as const) {
    const fields = { timestamp: 1, createdAt: 1, updatedAt: 1, normalized_phone_number: 1, job_no: 1, booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1, ingested_contact_snapshot: 1, granot_contact_snapshot: 1, current_contact_provenance: 1, ringcentral: 1 };
    const leads = model === "FormLead" ? await getFormLeadModel().find({ timestamp: { $gte: from, $lte: now } }).select(fields).lean() : await getCallLeadModel().find({ timestamp: { $gte: from, $lte: now } }).select(fields).lean();
    counts[`${model}_scanned`] = leads.length;
    console.log(JSON.stringify({ phase: "scan", model, leads: leads.length }));
    for (const lead of leads) {
      if (officialClosure(lead)) continue;
      const matched = [...new Set(phoneEvidence(lead, model).map(p => byPhone.get(p.e164)).filter(n => n && n.contact_eligibility.state !== "suppressed"))];
      if (!matched.length) continue;
      const booking = await BookedLead.exists({ $or: [{ lead_ref: lead._id, lead_model: model }, ...(lead.job_no ? [{ normalized_job_no: lead.job_no.trim().toUpperCase() }] : [])] });
      if (booking) { counts.booking_excluded = (counts.booking_excluded ?? 0) + 1; continue; }
      const ids = matched.map(n => n!._id);
      const [edges, conversations, outreach] = await Promise.all([
        getNumberLeadAttachmentModel().find({ contact_number_id: { $in: ids }, "lead_ref.id": lead._id, "lead_ref.model": model }).select({ contact_number_id: 1, state: 1, certainty: 1 }).lean(),
        getLeadConversationModel().find({ contact_number_id: { $in: ids }, started_at: { $gte: lead.timestamp, $lte: now }, content_purged_at: null }).select({ contact_number_id: 1, call_interaction_id: 1, started_at: 1, duration_seconds: 1, state: 1, latest_transcript_version: 1, latest_analysis_run_id: 1, analysis_eligibility: 1, "media.blob_pathname": 1 }).lean(),
        getOutreachRecordModel().findOne({ "subject.model": model, "subject.id": lead._id }).select({ state: 1, responsible_agent_id: 1 }).lean(),
      ]);
      candidates.push({ model, lead_id: String(lead._id), arrived_at: lead.timestamp, number_ids: ids.map(String), edges: edges.map(e => ({ number_id: String(e.contact_number_id), state: e.state, certainty: e.certainty })), outreach_id: outreach ? String(outreach._id) : null, outreach_state: outreach?.state ?? null, conversations: conversations.map(c => ({ id: String(c._id), number_id: String(c.contact_number_id), interaction_id: String(c.call_interaction_id), started_at: c.started_at, duration_seconds: c.duration_seconds, state: c.state, transcript: Boolean(c.latest_transcript_version), media: Boolean(c.media?.blob_pathname), eligibility: c.analysis_eligibility?.status })) });
    }
  }
  const config = analysisRuntimeConfiguration();
  const report = { from, now, database: mongoose.connection.name, counts, candidate_count: candidates.length, preflight: { model: config.model_id, configured: Boolean(config.endpoint && config.key && config.gateway_key && config.pricing), estimate_cents: config.pricing ? estimateAnalysisCents(config.pricing, config.limits) : null }, candidates };
  await mkdir("scripts/output/outreach-backfill", { recursive: true });
  await writeFile("scripts/output/outreach-backfill/inventory.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, candidates: undefined, conversation_states: candidates.flatMap(c => c.conversations).reduce<Record<string, number>>((sum, c) => { sum[c.state] = (sum[c.state] ?? 0) + 1; return sum; }, {}) }, null, 2));
  await executeBackfill(limit, process.argv.includes("--apply"));
}
main().catch(error => { backfillEvent({ phase: "failed", error_type: error instanceof Error ? error.name : "unknown" }); console.error(error instanceof Error ? error.message : "Backfill failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
