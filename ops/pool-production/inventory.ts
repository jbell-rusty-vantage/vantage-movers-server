/** Full existing canonical9 report. This is review evidence, never an admission manifest. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import { contentHash, expansionCohorts, PILOT_LIMIT, type CandidatePin, type LeadRef } from "./manifest";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !/^--(target|private-out|summary-out)=/.test(a))) throw new Error("Unknown inventory option");
  const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), privateOut = option("private-out"), summaryOut = option("summary-out");
  if (!target || !privateOut || !summaryOut) throw new Error("Require --target, --private-out and --summary-out");
  execFileSync("git", ["check-ignore", "--quiet", "--", resolve(privateOut)], { stdio: "ignore" });
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime.js");
  const { connectMongo } = await import("../../src/db.js");
  const { inspectPilot } = await import("./inspect.js");
  if (getMongoDatabaseName() !== target) throw new Error("Named target differs from resolved database");
  await connectMongo();
  const db = mongoose.connection.useDb(target, { useCache: true }).db!;
  const started = new Date(), refs: LeadRef[] = [], candidates: CandidatePin[] = [], configurations = new Set<string>();
  for (const [model, collection] of [["FormLead", "form_leads"], ["CallLead", "call_leads"]] as const) {
    const count = await db.collection(collection).countDocuments({ granot_priority: "9" });
    if (count > 2_000) throw new Error("Inventory exceeds explicit 2000-row per-model budget");
    const rows = await db.collection(collection).find({ granot_priority: "9" }, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray();
    refs.push(...rows.map(row => ({ model, id: String(row._id) })));
  }
  for (let i = 0; i < refs.length; i += PILOT_LIMIT) {
    const report = await inspectPilot(refs.slice(i, i + PILOT_LIMIT), target, new Date());
    configurations.add(`${report.configuration_revision}:${report.configuration_hash}`); candidates.push(...report.candidates);
    console.log(JSON.stringify({ mode: "read_only_inventory_progress", examined: candidates.length, total: refs.length, writes: 0 }));
  }
  const { pilot_ready: assigned, unassigned_review: unassigned, assigned_other_review: assignedOther, held, coherent } = expansionCohorts(candidates);
  const reasons: Record<string, number> = {};
  for (const candidate of held) for (const reason of candidate.holds) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const report = { contract: "pool-expansion-review-v1", database: target, started_at: started.toISOString(), completed_at: new Date().toISOString(),
    configuration_pins: [...configurations], snapshot: "sequential_read_only_batches_not_atomic", canonical_priority9_count: refs.length,
    assigned_ready_for_selected_manifest: assigned.length, unassigned_coherent_requires_routing_review: unassigned.length,
    canonical_lead_eligible: coherent.length, assigned_to_other_receiver_requires_assignment_review: assignedOther.length,
    assignment_review_rule: "Receiver retained; receiver eligibility is a pilot criterion and does not suppress otherwise coherent shared team Pool work",
    held: held.length, hold_reasons: reasons, writes: 0, provider_requests: 0, admission_authority: false,
    assigned_selection_hash: contentHash(assigned), unassigned_selection_hash: contentHash(unassigned), held_selection_hash: contentHash(held),
    assigned_other_selection_hash: contentHash(assignedOther), canonical_eligible_selection_hash: contentHash(coherent),
    scope: "All existing stored priority9 Leads; not provider inventory; unmatched provider rows remain outside this report",
    expansion_gate: "Deliberate reviewed exact-ID expansion after pilot observation; unassigned cohort requires separate routing review" };
  await mkdir(dirname(resolve(privateOut)), { recursive: true });
  const privateReport = { ...report, candidates };
  await writeFile(privateOut, JSON.stringify(privateReport, null, 2), { mode: 0o600 });
  const publicReport = { ...report, private_review_hash: contentHash(privateReport) };
  await mkdir(dirname(resolve(summaryOut)), { recursive: true }); await writeFile(summaryOut, JSON.stringify(publicReport, null, 2));
  console.log(JSON.stringify(publicReport, null, 2));
}
main().catch(error => { console.error(error instanceof Error && /^(Require|Unknown|Named|Inventory)/.test(error.message) ? error.message : "Pool inventory failed; private database details suppressed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
