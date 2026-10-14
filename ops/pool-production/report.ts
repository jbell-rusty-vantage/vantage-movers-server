/** Read-only pilot nomination. Never logs customer data or exact operational identities. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import { contentHash, PILOT_LIMIT, publicSummary, selectionSchema, type LeadRef } from "./manifest";

async function main() {
  const argv = process.argv.slice(2);
  for (const arg of argv) if (!/^--(target|leads|nominate|private-out|summary-out)=/.test(arg)) throw new Error("Unknown report option");
  const option = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), privateOut = option("private-out"), summaryOut = option("summary-out"), input = option("leads"), nominate = option("nominate");
  if (!target || !privateOut || (!!input === !!nominate)) throw new Error("Require --target, --private-out and exactly one of --leads or --nominate");
  // Exact operational identities must stay in an already ignored local destination.
  execFileSync("git", ["check-ignore", "--quiet", "--", resolve(privateOut)], { stdio: "ignore" });
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime.js");
  const { connectMongo } = await import("../../src/db.js");
  const { inspectPilot } = await import("./inspect.js");
  if (getMongoDatabaseName() !== target) throw new Error("Named target differs from resolved database");
  await connectMongo();
  const started = new Date();
  let selected: LeadRef[] = [];
  const heldReasons: Record<string, number> = {};
  let examined = 0;
  if (input) selected = selectionSchema.parse(JSON.parse(await readFile(input, "utf8")));
  else {
    const limit = Number(nominate);
    if (!Number.isInteger(limit) || limit < 1 || limit > PILOT_LIMIT) throw new Error("Nomination must be between 1 and 20");
    const db = mongoose.connection.useDb(target, { useCache: true }).db!;
    const pool: Array<LeadRef & { accepted_at: number }> = [];
    for (const [model, collection] of [["FormLead", "form_leads"], ["CallLead", "call_leads"]] as const) {
      const rows = await db.collection(collection).find({ granot_priority: "9", receiver_agent: { $ne: null }, duplicate: { $ne: true }, created_on_unmatched: { $ne: true } },
        { projection: { _id: 1, "last_accepted_granot_observation.captured_at": 1 } }).toArray();
      for (const row of rows) pool.push({ model, id: String(row._id), accepted_at: +(row.last_accepted_granot_observation?.captured_at ?? 0) });
    }
    pool.sort((a, b) => b.accepted_at - a.accepted_at || a.id.localeCompare(b.id));
    // Bounded report-only nomination, never admission of the discovered inventory.
    for (let i = 0; i < Math.min(pool.length, 200) && selected.length < limit; i += PILOT_LIMIT) {
      const refs = pool.slice(i, i + PILOT_LIMIT).map(({ model, id }) => ({ model, id }));
      const report = await inspectPilot(refs, target, started);
      examined += refs.length;
      for (const candidate of report.candidates) {
        if (!candidate.holds.length && selected.length < limit) selected.push(candidate.lead);
        for (const reason of candidate.holds) heldReasons[reason] = (heldReasons[reason] ?? 0) + 1;
      }
    }
    if (!selected.length) throw new Error(`No ready assigned candidates; holds=${JSON.stringify(heldReasons)}`);
  }
  // A fresh snapshot across all pins avoids assembling a pilot from moving per-candidate reads.
  const session = await mongoose.connection.startSession();
  let manifest: Awaited<ReturnType<typeof inspectPilot>> | undefined;
  try {
    await session.withTransaction(async () => { manifest = await inspectPilot(selected, target!, new Date(), session); }, { readConcern: { level: "snapshot" } });
  } finally { await session.endSession(); }
  if (!manifest) throw new Error("Snapshot did not produce a manifest");
  await mkdir(dirname(resolve(privateOut)), { recursive: true });
  await writeFile(privateOut, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const summary = { ...publicSummary(manifest), examined, nomination_holds: heldReasons, private_manifest_hash: contentHash(manifest),
    production_activation: "not_performed", snapshot: "single_read_only_transaction", no_customer_contact: true };
  if (summaryOut) { await mkdir(dirname(resolve(summaryOut)), { recursive: true }); await writeFile(summaryOut, JSON.stringify(summary, null, 2)); }
  console.log(JSON.stringify(summary, null, 2));
  if (!manifest.ready) process.exitCode = 2;
}

main().catch(error => { console.error(error instanceof Error && /^(Require|Unknown|Named|Nomination|No ready|Snapshot)/.test(error.message) ? error.message : "Pilot report failed; private database/provider details suppressed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
