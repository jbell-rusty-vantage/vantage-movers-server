/**
 * S10 step 1 (reconciliation addendum §3.5, §5): stamp `created_via: "form_lead"` on the Contact
 * Numbers that the Form Lead Contact Numbers backfill or the live `attachment-lead:` job already
 * created. The core of `scripts/dev_ops/stamp-form-created-numbers.ts`; the replica test drives it.
 *
 * Bases (reported separately; a Number counts under the first that applies):
 *   - `audit`: the Number has the create audit `contact_number_created_from_form_lead`
 *     (`attachment/formLeadNumber.ts`, written in the same transaction as the row, so every
 *     Number that code created carries it). Stamped.
 *   - `fallback_zero_calls_form_edge`: no create audit, `rollups.interactions_total` not > 0, and a
 *     `number_lead_attachments` edge to a Form Lead. Reported always; stamped only with
 *     `includeFallback` (a merged or purged call Number can also have zero calls, so it is not proof).
 *   - otherwise the Number stays unstamped (= `call`).
 *
 * Reads are batched (500 Numbers per page, one audit `$in` on `csi_audit_subject`, one edge `$in` on
 * `nla_number_state`). The write is one `updateMany` per page on `_id $in` guarded by
 * `created_via $ne form_lead`, on the raw collection (no revision bump, no `updatedAt`): it is
 * provenance metadata, not a Number change. It creates no job and calls no model.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose from "mongoose";
import { getContactNumberModel } from "../../../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../src/models/NumberLeadAttachment";
import { getSalesIntelligenceAuditEventModel, getSalesIntelligenceJobModel } from "../../../src/models/salesIntelligence/infrastructure";

export const FORM_CREATE_AUDIT_KIND = "contact_number_created_from_form_lead";
export type StampBasis = "audit" | "fallback_zero_calls_form_edge";
export type StampCounts = Record<string, number>;
export type StampCheckpoint = { database: string; mode: "apply"; after: string | null; counts: StampCounts; done?: boolean };
export type StampOptions = {
  database: string;
  apply: boolean;
  includeFallback?: boolean;
  resume?: boolean;
  checkpointPath: string;
  jsonlPath: string;
  pageSize?: number;
  limit?: number;
  now?: () => Date;
  log?: (line: string) => void;
};
export type StampResult = {
  database: string;
  apply: boolean;
  include_fallback: boolean;
  resumed_from: string | null;
  started_at: string;
  finished_at: string;
  counts: StampCounts;
  /**
   * `created_during_run` counts every job created while the script ran (on production the live
   * crons also create jobs); `touching_stamped` counts those whose `input_refs` name a Number this
   * run stamped (must be 0 everywhere: nothing here enqueues work).
   */
  jobs: { before: number; after: number; created_during_run: number; touching_stamped: number };
  stamped_sample: string[];
};

const bump = (c: StampCounts, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };
type NumberRow = { _id: mongoose.Types.ObjectId; created_via?: string | null; purged_at?: Date | null; rollups?: { interactions_total?: number | null } };

async function readCheckpoint(path: string, database: string): Promise<StampCheckpoint | null> {
  try {
    const cp = JSON.parse(await readFile(path, "utf8")) as StampCheckpoint;
    return cp.database === database && cp.mode === "apply" ? cp : null;
  } catch {
    return null;
  }
}

export async function runStampFormCreatedNumbers(options: StampOptions): Promise<StampResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const pageSize = options.pageSize ?? 500;
  const includeFallback = options.includeFallback === true;
  const started = now();
  const Jobs = getSalesIntelligenceJobModel();
  const jobsBefore = await Jobs.countDocuments({});
  const runFloor = mongoose.Types.ObjectId.createFromTime(Math.floor(started.getTime() / 1000));

  const checkpoint = options.apply && options.resume ? await readCheckpoint(options.checkpointPath, options.database) : null;
  const counts: StampCounts = { ...(checkpoint?.counts ?? {}) };
  let after = checkpoint?.after ?? null;
  const resumedFrom = after;
  await mkdir(dirname(options.jsonlPath), { recursive: true });
  const jsonl = (event: string, payload: Record<string, unknown>) =>
    appendFile(options.jsonlPath, JSON.stringify({ at: now().toISOString(), event, ...payload }) + "\n");
  await jsonl("start", { database: options.database, apply: options.apply, include_fallback: includeFallback, resumed_from: resumedFrom });

  const Numbers = getContactNumberModel();
  const Audits = getSalesIntelligenceAuditEventModel();
  const Edges = getNumberLeadAttachmentModel();
  const sample: string[] = [];
  const stampedIds: mongoose.Types.ObjectId[] = [];
  let scanned = 0;
  for (;;) {
    const remaining = options.limit !== undefined ? options.limit - scanned : Infinity;
    if (remaining <= 0) break;
    const page = (await Numbers.find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {},
      { _id: 1, created_via: 1, purged_at: 1, "rollups.interactions_total": 1 })
      .sort({ _id: 1 }).limit(Math.min(pageSize, remaining)).lean()) as unknown as NumberRow[];
    if (!page.length) break;
    scanned += page.length;
    const ids = page.map((row) => String(row._id));
    const audited = new Set((await Audits.find({ subject_key: { $in: ids.map((id) => `number:${id}`) }, event_kind: FORM_CREATE_AUDIT_KIND },
      { subject_key: 1 }).lean()).map((a) => String((a as { subject_key: string }).subject_key).slice("number:".length)));
    const zeroNoAudit = page.filter((row) => !audited.has(String(row._id)) && !((row.rollups?.interactions_total ?? 0) > 0));
    const formEdge = new Set(zeroNoAudit.length
      ? (await Edges.find({ contact_number_id: { $in: zeroNoAudit.map((row) => row._id) }, "lead_ref.model": "FormLead" },
        { contact_number_id: 1 }).lean()).map((e) => String((e as { contact_number_id: mongoose.Types.ObjectId }).contact_number_id))
      : []);

    const toStamp: { id: mongoose.Types.ObjectId; basis: StampBasis }[] = [];
    for (const row of page) {
      const id = String(row._id);
      const hasCalls = (row.rollups?.interactions_total ?? 0) > 0;
      bump(counts, "numbers_scanned");
      bump(counts, `numbers_created_via_${row.created_via ?? "absent"}`);
      const basis: StampBasis | null = audited.has(id) ? "audit" : formEdge.has(id) ? "fallback_zero_calls_form_edge" : null;
      if (row.created_via === "form_lead") {
        bump(counts, `already_stamped_${basis ?? "no_basis"}`);
        continue;
      }
      if (!basis) {
        bump(counts, hasCalls ? "unstamped_call_with_calls" : "unstamped_call_zero_calls_no_form_edge");
        continue;
      }
      bump(counts, `match_${basis}`);
      if (basis === "audit" && hasCalls) bump(counts, "match_audit_has_calls_since");
      if (row.purged_at) bump(counts, `match_${basis}_purged`);
      if (basis === "fallback_zero_calls_form_edge" && !includeFallback) { bump(counts, "fallback_reported_not_stamped"); continue; }
      toStamp.push({ id: row._id, basis });
    }

    if (toStamp.length) {
      for (const item of toStamp) await jsonl(options.apply ? "stamp" : "would_stamp", { number_id: String(item.id), basis: item.basis });
      if (sample.length < 10) sample.push(...toStamp.slice(0, 10 - sample.length).map((item) => String(item.id)));
    }
    if (options.apply && toStamp.length) {
      const result = await Numbers.collection.updateMany(
        { _id: { $in: toStamp.map((item) => item.id) }, created_via: { $ne: "form_lead" } },
        { $set: { created_via: "form_lead" } },
      );
      bump(counts, "stamped", result.modifiedCount);
      stampedIds.push(...toStamp.map((item) => item.id));
    } else if (!options.apply) {
      bump(counts, "would_stamp", toStamp.length);
    }
    after = ids[ids.length - 1]!;
    if (options.apply) await writeCheckpoint(options.checkpointPath, { database: options.database, mode: "apply", after, counts });
    await jsonl("page", { after, scanned: page.length, to_stamp: toStamp.length });
    log(JSON.stringify({ phase: "page", after, scanned: counts.numbers_scanned, to_stamp: toStamp.length }));
  }
  if (options.apply) await writeCheckpoint(options.checkpointPath, { database: options.database, mode: "apply", after, counts, done: true });

  const jobsAfter = await Jobs.countDocuments({});
  const createdDuringRun = await Jobs.countDocuments({ _id: { $gte: runFloor } });
  let touchingStamped = 0;
  for (let i = 0; createdDuringRun && i < stampedIds.length; i += 1000) {
    touchingStamped += await Jobs.countDocuments({ _id: { $gte: runFloor }, input_refs: { $in: stampedIds.slice(i, i + 1000) } });
  }
  const result: StampResult = {
    database: options.database, apply: options.apply, include_fallback: includeFallback, resumed_from: resumedFrom,
    started_at: started.toISOString(), finished_at: now().toISOString(), counts,
    jobs: { before: jobsBefore, after: jobsAfter, created_during_run: createdDuringRun, touching_stamped: touchingStamped }, stamped_sample: sample,
  };
  await jsonl("finished", { counts, jobs: result.jobs });
  return result;
}

async function writeCheckpoint(path: string, checkpoint: StampCheckpoint) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint));
}

/** The `evidence/S10-1-<env>.md` report. Identifiers and counts only, never phone numbers. */
export function renderStampReport(result: StampResult, env: string, command: string): string {
  const rows = Object.entries(result.counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`);
  const jobsOk = result.jobs.touching_stamped === 0 && (env === "production" || result.jobs.created_during_run === 0);
  return [
    `# S10-1 (${env}): stamp \`created_via: "form_lead"\` on form-created Numbers`,
    "",
    `- Database: \`${result.database}\``,
    `- Mode: **${result.apply ? "apply" : "dry run (no writes)"}**${result.include_fallback ? ", fallback basis stamped" : ""}`,
    `- Command: \`${command}\``,
    `- Started ${result.started_at}, finished ${result.finished_at}${result.resumed_from ? `, resumed after \`${result.resumed_from}\`` : ""}`,
    `- Jobs: ${result.jobs.before} before, ${result.jobs.after} after, ${result.jobs.created_during_run} created during the run (production: live crons included), ${result.jobs.touching_stamped} naming a stamped Number: **${jobsOk ? "zero jobs, zero model calls" : "JOBS CHANGED: investigate"}**`,
    "",
    "## Counts by basis",
    "",
    "| Count | Value |",
    "|---|---|",
    ...rows,
    "",
    "`match_audit` = the create audit `contact_number_created_from_form_lead`. `match_fallback_zero_calls_form_edge` = no create audit, zero calls and a Form Lead edge (stamped only with `--include-fallback`). `unstamped_*` stay `call` (absent). `already_stamped_*` were `form_lead` before this run.",
    "",
    `Sample stamped ids: ${result.stamped_sample.map((id) => `\`${id}\``).join(", ") || "none"}`,
    "",
  ].join("\n");
}
