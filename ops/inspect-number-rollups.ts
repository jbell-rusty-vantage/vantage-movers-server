/**
 * S10-REPAIR step 7, rollup spot check (the B1 rollup equality, data spec §8, read-only).
 *
 * For a sample of Contact Numbers it recounts the rollups from evidence exactly as the Number
 * `rebuild` job does (`loadRebuildEvidence` + `recountNumber`) and compares them with what is stored
 * (`sameRebuiltFields`). It writes nothing: no rebuild job, no update (replica proof: `test-si-s10-dry-runs.ts`).
 *
 *   node --env-file=.env --import tsx ops/inspect-number-rollups.ts --allow-production [--sample=50] [--json=<path>]
 *
 * Sample: the `--sample` most recently active external Numbers whose last activity is older than
 * `--settle-hours` (default 6; `contact_number_kind_activity`), plus the `--sample` newest form-created ones
 * (`created_via: form_lead`, by `_id`). Seven indexed reads per Number. The settle window matters: webhook
 * capture moves `last_outbound_at` / `last_activity_at` on a live call before its Call Interaction exists
 * (production 2026-09-24: 50 of the 50 most recent Numbers differed that way, all within minutes of the read),
 * so a Number with activity inside the window is not comparable yet. A mismatch names the differing fields only.
 * Expect `mismatched 0`. A real mismatch is repaired by the rebuild job (`sweep-number-rollups.ts`), never here.
 */
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { loadRebuildEvidence, recountNumber, sameRebuiltFields, type RebuildRollups, type RebuiltFields } from "../src/services/numberActivity/rebuild";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

function differing(current: RebuiltFields, next: RebuiltFields): string[] {
  const out: string[] = [];
  const norm = (v: unknown) => (v instanceof Date ? v.getTime() : v === undefined ? "undefined" : JSON.stringify(v));
  for (const key of Object.keys(next.rollups) as Array<keyof RebuildRollups>) if (norm(current.rollups?.[key] ?? null) !== norm(next.rollups[key] ?? null)) out.push(`rollups.${key}`);
  if (JSON.stringify(current.provider_names) !== JSON.stringify(next.provider_names)) out.push("provider_names");
  if (JSON.stringify([...current.search_terms].sort()) !== JSON.stringify([...next.search_terms].sort())) out.push("search_terms");
  if (norm(current.first_observed_at) !== norm(next.first_observed_at)) out.push("first_observed_at");
  if (norm(current.last_activity_at) !== norm(next.last_activity_at)) out.push("last_activity_at");
  return out;
}

async function main() {
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !process.argv.includes("--allow-production")) throw new Error(`${database} is not a loopback testvantagemovers_* database; pass --allow-production`);
  const sample = Number(arg("sample") ?? 50);
  const settleHours = Number(arg("settle-hours") ?? 6);
  const settledBefore = new Date(Date.now() - settleHours * 3_600_000);
  const Numbers = getContactNumberModel();
  const active = await Numbers.find({ kind: "external", last_activity_at: { $lt: settledBefore } }).sort({ last_activity_at: -1 }).limit(sample).select({ _id: 1 }).lean();
  const form = await Numbers.find({ kind: "external", created_via: "form_lead", last_activity_at: { $lt: settledBefore } }).sort({ _id: -1 }).limit(sample).select({ _id: 1 }).lean();
  const ids = [...new Set([...active, ...form].map(row => String(row._id)))];
  const mismatches: Array<{ number_id: string; fields: string[] }> = [];
  let checked = 0, missing = 0;
  for (const id of ids) {
    const evidence = await loadRebuildEvidence(id);
    if (!evidence.number) { missing++; continue; }
    checked++;
    const n = evidence.number;
    const current: RebuiltFields = { rollups: n.rollups as RebuildRollups, provider_names: [...(n.provider_names ?? [])], search_terms: [...(n.search_terms ?? [])],
      first_observed_at: n.first_observed_at, last_activity_at: n.last_activity_at };
    const next = recountNumber({ number: n, interactions: evidence.interactions, attachments: evidence.attachments, open_outreach_count: evidence.open_outreach_count,
      analyzed_conversations: evidence.analyzed_conversations, outreach_records_total: evidence.outreach_records_total });
    if (!sameRebuiltFields(current, next)) mismatches.push({ number_id: id, fields: differing(current, next) });
  }
  const byField: Record<string, number> = {};
  for (const m of mismatches) for (const f of m.fields) byField[f] = (byField[f] ?? 0) + 1;
  const result = { database, sample, settle_hours: settleHours, settled_before: settledBefore.toISOString(), checked, missing, sampled_active: active.length, sampled_form_created: form.length, equal: checked - mismatches.length, mismatched: mismatches.length, by_field: byField, mismatches: mismatches.slice(0, 50) };
  if (arg("json")) await writeFile(arg("json")!, JSON.stringify(result, null, 1) + "\n");
  console.log(JSON.stringify(result, null, 1));
}
main().then(() => mongoose.disconnect()).then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
