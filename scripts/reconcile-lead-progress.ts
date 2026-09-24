/**
 * LP-03/LP-05 deterministic Lead progress reconcile (spec §6, §13.3 H3).
 *
 * Dry run by default: inventories both Lead types, projects what LP-01 would
 * do, and counts the §13.4 one-person-two-Leads buckets. `--apply` runs the
 * existing `ensureLead` projection in bounded transactional pages with a
 * resumable checkpoint. Zero model calls, zero RingCentral calls, no deletes,
 * no mass "worked now" stamp: every write is the same code path the minute
 * worker uses, keyed by the stable policy version.
 *
 *   node --env-file=.env --import tsx scripts/reconcile-lead-progress.ts            # inventory
 *   ... --apply --pilot 200                                                           # first 200 per model
 *   ... --apply --resume                                                              # continue from checkpoint
 *
 * Refuses to apply against the production database unless --allow-production is
 * passed; the coordinator never passes it without Owner approval.
 *
 * S6-P5: Priority 5 (`crm_booked`, closure `granot_booked`) follows SALES_INTELLIGENCE_PRIORITY5_CLOSURE
 * in this process; with it on, the inventory counts 5 under `terminal_*`. The dedicated S10 step 4
 * reconcile (report of closes / uncertain / upgrades, held `number_refresh`, drift guard) is
 * `scripts/dev_ops/reconcile-priority5.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { csiFlag } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../src/models/SalesIntelligenceAttentionSnapshot";
import { ensureLead, latestProgressEvidence, workerContext } from "../src/services/salesIntelligence/outreach/ensure";
import { authoritativeClosure } from "../src/services/salesIntelligence/outreach/transitions";
import { isTerminal, LEAD_PROGRESS_POLICY_VERSION, projectLeadProgress, type LeadProgressRow } from "../src/services/salesIntelligence/outreach/leadProgress";
import { decompressAttentionRows, publishAttentionSnapshot } from "../src/services/salesIntelligence/outreach/attention";
import { completeNormalizedMatchSet } from "../src/services/salesIntelligence/attachment/matchSet";

type Model = "FormLead" | "CallLead";
type InventoryLead = { _id: mongoose.Types.ObjectId; granot_priority?: unknown; quoted?: unknown; duplicate?: boolean; bad_lead?: unknown; booked?: unknown; cancelled?: unknown; no_sync?: boolean };
const arg = (name: string) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const PAGE = Number(arg("page") ?? 100);
const OUT_DIR = "scripts/dev_ops/output";
const CHECKPOINT = `${OUT_DIR}/lead-progress-reconcile.checkpoint.json`;

type Checkpoint = { policy_version: string; database: string; started_at: string; models: Record<Model, { after: string | null; processed: number; done: boolean }> };
const bump = (counts: Record<string, number>, key: string, by = 1) => { counts[key] = (counts[key] ?? 0) + by; };

async function bandDistribution() {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const header = await Snapshot.findOne({ chunk_index: null }).sort({ as_of: -1 }).lean();
  if (!header) return null;
  let rows: Array<{ derived: { attention_band: number | null }; outreach: { state: string; lead_progress?: { disposition?: string } | null } | null }> = [];
  if (header.rows_gzip_base64) rows = decompressAttentionRows(header.rows_gzip_base64) as typeof rows;
  else if (header.counts?.chunks) rows = (await Snapshot.find({ parent_snapshot_id: header.snapshot_id }).sort({ chunk_index: 1 }).lean()).flatMap(p => (p.rows as typeof rows) ?? []);
  else rows = (header.rows as typeof rows) ?? [];
  const bands: Record<string, number> = {}, states: Record<string, number> = {}, dispositions: Record<string, number> = {};
  for (const row of rows) {
    bump(bands, String(row.derived.attention_band ?? "review_only")); bump(states, row.outreach?.state ?? "review_only");
    bump(dispositions, row.outreach?.lead_progress?.disposition ?? "not_projected");
  }
  return { snapshot_id: header.snapshot_id, as_of: header.as_of, rows: rows.length, bands, states, dispositions };
}

async function inventory(limit: number | null) {
  const counts: Record<string, number> = {}, now = new Date();
  const session = await mongoose.connection.startSession();
  try {
    for (const model of ["FormLead", "CallLead"] as const) {
      let after: mongoose.Types.ObjectId | null = null, seen = 0;
      for (;;) {
        const filter = after ? { _id: { $gt: after } } : {};
        const page: Array<InventoryLead> = model === "FormLead"
          ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).lean() : await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).lean();
        if (!page.length) break;
        for (const lead of page) {
          seen++; bump(counts, `${model}_scanned`);
          const ref = { model, id: String(lead._id) };
          const record = await getOutreachRecordModel().findOne({ "subject.kind": "lead", "subject.model": model, "subject.id": lead._id }).lean();
          if (!record) bump(counts, `${model}_no_outreach_record`);
          const official = await authoritativeClosure(lead, ref, session);
          const evidence = await latestProgressEvidence(ref, session, lead);
          const next = projectLeadProgress({ lead, prior: (record?.lead_progress as LeadProgressRow | null) ?? null, evidence, now });
          bump(counts, `${model}_disposition_${next.disposition}`); bump(counts, `${model}_provenance_${next.provenance}`);
          if (official) { bump(counts, `${model}_official_closed_${official}`); continue; }
          if (record?.closure_origin === "owner") { bump(counts, `${model}_owner_closed`); continue; }
          if (record?.state === "identity_review") bump(counts, `${model}_identity_review`);
          if (isTerminal(next.disposition)) bump(counts, next.provenance === "accepted" ? `${model}_terminal_accepted_would_close` : `${model}_terminal_uncertain_needs_review`);
          else if (next.work_observed) {
            bump(counts, `${model}_qualifying_progress`);
            if (!record || record.state === "unworked") bump(counts, `${model}_would_open_band5`);
            else bump(counts, `${model}_already_open_or_waiting`);
            if (next.basis === "historical_snapshot") bump(counts, `${model}_work_time_unknown`);
          } else bump(counts, `${model}_still_unworked_no_evidence`);
          if (next.provenance === "uncertain" && !isTerminal(next.disposition) && next.granot_priority !== null) bump(counts, `${model}_priority_uncertain_provenance`);
          const edges = await getNumberLeadAttachmentModel().countDocuments({ "lead_ref.model": model, "lead_ref.id": lead._id, state: { $ne: "rejected" } });
          if (!edges) bump(counts, `${model}_no_number`);
        }
        after = page.at(-1)!._id as mongoose.Types.ObjectId;
        if (limit !== null && seen >= limit) break;
      }
    }
    // §13.4 buckets over external Contact Numbers via the complete normalized match set.
    let afterNumber: mongoose.Types.ObjectId | null = null, numbers = 0;
    for (;;) {
      const page = await getContactNumberModel().find({ kind: "external", purged_at: null, ...(afterNumber ? { _id: { $gt: afterNumber } } : {}) }).sort({ _id: 1 }).limit(PAGE).lean();
      if (!page.length) break;
      for (const number of page) {
        numbers++;
        const set = await completeNormalizedMatchSet(number, session);
        if (set.status !== "complete") { bump(counts, `numbers_lookup_unknown_${set.reason ?? "unknown"}`); continue; }
        const candidates = set.candidates;
        if (candidates.length === 0) bump(counts, "numbers_no_candidate");
        else if (candidates.length === 1) {
          const edge = await getNumberLeadAttachmentModel().findOne({ contact_number_id: number._id, "lead_ref.model": candidates[0]!.lead_ref.model, "lead_ref.id": candidates[0]!.lead_ref.id }).lean();
          if (edge?.decided_at || edge?.state === "rejected") bump(counts, "numbers_sole_match_protected_owner_decision");
          else if (set.target) bump(counts, edge?.state === "attached" ? "numbers_sole_match_already_attached" : "numbers_sole_match_eligible");
          else bump(counts, "numbers_sole_match_target_ineligible_bad_or_no_sync");
        } else {
          bump(counts, "numbers_competing_match");
          const forms = candidates.filter(c => c.lead_ref.model === "FormLead").length, calls = candidates.filter(c => c.lead_ref.model === "CallLead").length;
          if (forms === 1 && calls === 1) bump(counts, "numbers_competing_one_form_one_call");
          if (new Set(candidates.map(c => c.source_company ?? "")).size > 1) bump(counts, "numbers_competing_spans_source_companies");
        }
        if (limit !== null && numbers >= limit) break;
      }
      afterNumber = page.at(-1)!._id as mongoose.Types.ObjectId;
      if (limit !== null && numbers >= limit) break;
    }
    counts.numbers_scanned = numbers;
  } finally { await session.endSession(); }
  return counts;
}

async function apply(limit: number | null, resume: boolean) {
  if (!csiFlag("LEAD_PROGRESS")) throw new Error("SALES_INTELLIGENCE_LEAD_PROGRESS must be true to apply");
  if (!csiFlag("OUTREACH_ENSURE")) throw new Error("SALES_INTELLIGENCE_OUTREACH_ENSURE must be true to apply");
  await mkdir(OUT_DIR, { recursive: true });
  let checkpoint: Checkpoint | null = null;
  if (resume) { try { checkpoint = JSON.parse(await readFile(CHECKPOINT, "utf8")) as Checkpoint; } catch { checkpoint = null; } }
  if (checkpoint && (checkpoint.policy_version !== LEAD_PROGRESS_POLICY_VERSION || checkpoint.database !== getMongoDatabaseName())) checkpoint = null;
  checkpoint ??= { policy_version: LEAD_PROGRESS_POLICY_VERSION, database: getMongoDatabaseName(), started_at: new Date().toISOString(),
    models: { FormLead: { after: null, processed: 0, done: false }, CallLead: { after: null, processed: 0, done: false } } };
  const counts: Record<string, number> = {};
  for (const model of ["FormLead", "CallLead"] as const) {
    const state = checkpoint.models[model];
    if (state.done) continue;
    let pageProcessed = 0;
    for (;;) {
      if (limit !== null && state.processed >= limit) break;
      const filter = state.after ? { _id: { $gt: new mongoose.Types.ObjectId(state.after) } } : {};
      // A pilot never overshoots: the last page shrinks to the remaining allowance.
      const size = limit === null ? PAGE : Math.max(1, Math.min(PAGE, limit - state.processed));
      const page: Array<{ _id: mongoose.Types.ObjectId }> = model === "FormLead"
        ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(size).select({ _id: 1 }).lean() : await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(size).select({ _id: 1 }).lean();
      if (!page.length) { state.done = true; break; }
      // Flags and Owner decisions are rechecked inside every page's transaction by `ensureLead` itself.
      await withTransaction(async session => {
        if (!csiFlag("LEAD_PROGRESS")) throw new Error("LEAD_PROGRESS turned off mid-run");
        const context = workerContext(session, `reconcile:${LEAD_PROGRESS_POLICY_VERSION}:${model}:${page[0]!._id}`);
        for (const row of page) {
          const before = await getOutreachRecordModel().findOne({ "subject.model": model, "subject.id": row._id }).select({ state: 1, closure_origin: 1, revision: 1 }).session(session).lean();
          const record = await ensureLead({ model, id: String(row._id) }, context);
          bump(counts, `${model}_processed`);
          if (!record) { bump(counts, `${model}_lead_missing`); continue; }
          if (!before) bump(counts, `${model}_outreach_created`);
          else if (before.revision !== record.revision) bump(counts, `${model}_changed_${before.state}_to_${record.state}`);
          else bump(counts, `${model}_unchanged`);
          if (record.closure_origin === "crm_disposition" && before?.closure_origin !== "crm_disposition") bump(counts, `${model}_closed_by_crm_disposition`);
        }
      });
      state.after = String(page.at(-1)!._id); state.processed += page.length; pageProcessed += page.length;
      await writeFile(CHECKPOINT, JSON.stringify(checkpoint, null, 2));
      console.log(JSON.stringify({ phase: "page", model, processed: state.processed, page: page.length }));
    }
    console.log(JSON.stringify({ phase: "model_done", model, processed: state.processed, this_run: pageProcessed, done: state.done }));
  }
  return counts;
}

async function main() {
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const applying = flag("apply");
  if (applying && database === "vantagemovers" && !flag("allow-production")) throw new Error("Refusing to apply against the production database without --allow-production");
  const limit = arg("pilot") ? Number(arg("pilot")) : arg("limit") ? Number(arg("limit")) : null;
  const started = new Date();
  const before = await bandDistribution();
  console.log(JSON.stringify({ phase: "started", database, apply: applying, limit, policy_version: LEAD_PROGRESS_POLICY_VERSION, flags: { LEAD_PROGRESS: csiFlag("LEAD_PROGRESS"), OUTREACH_ENSURE: csiFlag("OUTREACH_ENSURE"), ATTACHMENT_REFRESH: csiFlag("ATTACHMENT_REFRESH"), AUTO_ATTACH: csiFlag("AUTO_ATTACH") }, before }));
  const result: Record<string, unknown> = { database, policy_version: LEAD_PROGRESS_POLICY_VERSION, started_at: started.toISOString(), apply: applying, limit, before };
  if (!applying || flag("inventory")) result.inventory = await inventory(limit);
  if (applying) {
    result.apply = await apply(limit, flag("resume"));
    result.publish = await publishAttentionSnapshot({ deadlineMs: 300_000 });
    result.after = await bandDistribution();
  }
  result.finished_at = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/lead-progress-reconcile-${started.toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ phase: "finished", file, ...result }, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
