import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { inventorySchema, selectCandidates } from "./outreach-backfill-plan";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { toOutreachDto } from "../src/services/salesIntelligence/outreach/reads";
import { readAttention } from "../src/services/salesIntelligence/outreach/attention";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { backfillEvent } from "./outreach-backfill-history";

/** Read current durable outcomes. Queued, submitted and applied are distinct. */
export async function reportBackfill(limit: number) {
  const inventory = inventorySchema.parse(JSON.parse(await readFile("scripts/output/outreach-backfill/inventory.json", "utf8")));
  if (inventory.database !== csiDataset().database) throw new Error("Inventory database mismatch");
  const selected = selectCandidates(inventory.candidates, limit), coverage = await readCaptureCoverage();
  const executionText = await readFile("scripts/output/outreach-backfill/results.json", "utf8").catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  const savedExecution = executionText ? z.object({ started_at: z.string(), updated_at: z.string(), results: z.array(z.object({ lead_id: z.string(),
    analyses: z.array(z.object({ conversation_id: z.string(), status: z.string(), reason: z.string().nullish(), application: z.string().nullish() })),
  })) }).parse(JSON.parse(executionText)) : null;
  const execution = savedExecution && +new Date(savedExecution.started_at) === +inventory.now ? savedExecution : null;
  const rows = [];
  for (const candidate of selected) {
    const record = await getOutreachRecordModel().findOne({ "subject.model": candidate.model, "subject.id": candidate.lead_id }).lean();
    const dto = record ? await toOutreachDto(record, new Date(), coverage) : null;
    const conversations = await getLeadConversationModel().find({ _id: { $in: candidate.conversations.map(c => c.id) } }).select({ state: 1, latest_completed_run_id: 1 }).lean();
    const runs = await getIntelligenceRunModel().find({ _id: { $in: conversations.flatMap(c => c.latest_completed_run_id ? [c.latest_completed_run_id] : []) } }).select({ status: 1, result_counts: 1, completed_at: 1, usage: 1 }).lean();
    const numbers = await getContactNumberModel().find({ _id: { $in: candidate.number_ids } }).select({ running_summary: 1 }).lean();
    const edges = await getNumberLeadAttachmentModel().find({ "lead_ref.model": candidate.model, "lead_ref.id": candidate.lead_id,
      contact_number_id: { $in: candidate.number_ids }, state: { $ne: "rejected" } }).select({ state: 1, certainty: 1 }).lean();
    rows.push({ model: candidate.model, lead_id: candidate.lead_id, outreach_id: record ? String(record._id) : null,
      state: record?.state, band: dto?.derived.attention_band, reasons: dto?.derived.reasons,
      responsibility_missing: dto?.derived.no_owner, review_badges: dto?.derived.review_badges,
      blockers: dto?.derived.call_blockers, absence_qualified: dto?.derived.absence_qualified,
      attachment_certainties: [...new Set(edges.map(e => e.certainty))],
      needs_identity_confirmation_for_ai_effects: !edges.some(e => e.state === "attached" && ["exact", "owner_confirmed"].includes(e.certainty)),
      completed_conversations: runs.filter(r => r.status === "completed").length,
      completed_since_inventory: runs.filter(r => r.status === "completed" && r.completed_at && r.completed_at >= inventory.now).length,
      number_summaries: numbers.filter(n => n.running_summary?.text).length,
      open_followups: dto?.followups.filter(f => f.status === "open").map(f => ({ id: f.id, kind: f.kind, due_at: f.due_at, origin: f.origin, owner: f.assignment.agent?.id ?? null })),
    });
  }
  const recoveryJobs = await getSalesIntelligenceJobModel().find({ ...csiDataset(), dedupe_key: /:outreach-seed-2026-09-21(?::citation-guidance-v1)?$/ }).select({ status: 1, result: 1, input_refs: 1 }).lean();
  const recoveries = await getIntelligenceRunModel().find({ ...csiDataset(), job_id: { $in: recoveryJobs.map(j => j._id) } }).select({ status: 1, usage: 1, result_counts: 1, processing_reason: 1 }).lean();
  const summary = { candidates: inventory.candidates.length, selected: rows.length,
    with_completed_conversations: rows.filter(r => r.completed_conversations > 0).length,
    completed_conversations: rows.reduce((n, r) => n + r.completed_conversations, 0),
    completed_since_inventory: rows.reduce((n, r) => n + r.completed_since_inventory, 0),
    open_followups: rows.reduce((n, r) => n + (r.open_followups?.length ?? 0), 0),
    number_summaries: rows.reduce((n, r) => n + r.number_summaries, 0),
    needs_identity_confirmation_for_ai_effects: rows.filter(r => r.needs_identity_confirmation_for_ai_effects).length,
    bands: rows.reduce<Record<string, number>>((n, r) => { const key = String(r.band); n[key] = (n[key] ?? 0) + 1; return n; }, {}),
    reasons: rows.reduce<Record<string, number>>((n, r) => { for (const reason of r.reasons ?? []) n[reason] = (n[reason] ?? 0) + 1; return n; }, {}),
    recovery_jobs: recoveryJobs.reduce<Record<string, number>>((n, j) => { n[j.status] = (n[j.status] ?? 0) + 1; return n; }, {}),
    recovery_actual_cents: recoveries.reduce((n, r) => n + (r.usage?.actual_cents ?? 0), 0),
    recovery_unresolved_costs: recoveries.filter(r => r.usage?.actual_cents == null).length,
    last_execution_analysis_statuses: (execution?.results ?? []).flatMap(r => r.analyses).reduce<Record<string, number>>((n, a) => {
      n[a.status] = (n[a.status] ?? 0) + 1; return n;
    }, {}),
  };
  const attention = await readAttention({ scope: "production", limit: 1 });
  const report = { at: new Date(), from: inventory.from, inventory_at: inventory.now, summary, rows,
    attention: { status: attention.data.status, total_items: attention.data.total_items, as_of: attention.as_of },
    last_execution: execution,
    recovery_jobs: recoveryJobs.map(j => ({ id: String(j._id), status: j.status, reason: j.result?.reason ?? null })),
    recovery_runs: recoveries.map(r => ({ id: String(r._id), status: r.status, reason: r.processing_reason, results: r.result_counts })) };
  await writeFile("scripts/output/outreach-backfill/verification.json", JSON.stringify(report, null, 2));
  backfillEvent({ phase: "verified", summary });
  return report;
}
