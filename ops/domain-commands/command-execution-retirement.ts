/**
 * Validated retirement of Domain Command receipts, phases 1–2: operator command (docs/knowledge/validated-retirement.md).
 *
 *   pnpm domain:command-execution-retirement status   --target=vantagemovers                  # read-only: switch, cursor, catalog, bucket rule
 *   pnpm domain:command-execution-retirement dry-run  --target=vantagemovers [--limit=250000] # read-only verdicts from the stored cursor (no GCS, no writes)
 *   pnpm domain:command-execution-retirement install  --target=vantagemovers                  # catalog indexes + the 90-day bucket rule (if absent)
 *   pnpm domain:command-execution-retirement enable   --target=vantagemovers                  # the cron starts retiring proven receipts
 *   pnpm domain:command-execution-retirement disable  --target=vantagemovers                  # every receipt stays in MongoDB again
 *   pnpm domain:command-execution-retirement run      --target=vantagemovers [--batches=20]   # one supervised worker pass (same code as the cron)
 *   pnpm domain:command-execution-retirement lookup   --target=vantagemovers --id=<receipt>   # restore one retired receipt from GCS (read-only)
 *
 * Prints one JSON summary.
 */
import mongoose from "mongoose";
import { DOMAIN_COMMAND_EXECUTION_COLLECTION } from "../../src/models/DomainCommandExecution";
import {
  COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID,
  lookupArchivedCommandExecution, retireProvenCommandExecutions, reviewCommandBatch,
} from "../../src/services/domainCommands/retirement/commandExecutions";
import { RETIREMENT_CONTROL_COLLECTION } from "../../src/services/domainCommands/retirement/shared";
import { bucketRuleStatus, catalogSummary, finish, install, open, parse, setSwitch, supervise } from "./retirement-cli";

finish(async () => {
  const args = parse(process.argv.slice(2));
  const { db, reader, database, config, scope } = await open(args);
  const now = new Date();
  const control = await db.collection<{ _id: string; [k: string]: unknown }>(RETIREMENT_CONTROL_COLLECTION).findOne({ _id: COMMAND_EXECUTION_RETIREMENT_CONTROL_ID });
  const cursor = (control?.cursor as string | null | undefined) ?? null;
  let out: Record<string, unknown> = { mode: args.mode, database, measured_at: now.toISOString() };

  if (args.mode === "status") {
    out = { ...out, enabled_at: control?.enabled_at ?? null, cursor, pass_completed_at: control?.pass_completed_at ?? null,
      hot_rows: await db.collection(DOMAIN_COMMAND_EXECUTION_COLLECTION).estimatedDocumentCount(), last_run: control?.last_run ?? null,
      catalog: await catalogSummary(db, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION), bucket_rule: await bucketRuleStatus(config, scope) };
  } else if (args.mode === "dry-run") {
    const tally: Record<string, { rows: number; bytes: number }> = {};
    let at = cursor, scanned = 0;
    while (scanned < args.limit) {
      const { rows, verdicts } = await reviewCommandBatch(reader, at, now);
      if (!rows.length) break;
      rows.forEach((r, i) => {
        const v = verdicts[i]!;
        const key = `${r.doc.origin}:${v.verdict === "retire" ? "retire" : `hold:${v.reason}`}`;
        const t = (tally[key] ??= { rows: 0, bytes: 0 });
        t.rows++; t.bytes += r.raw.length;
      });
      scanned += rows.length;
      at = String(rows.at(-1)!.doc._id);
    }
    out = { ...out, cursor, scanned, verdicts: tally };
  } else if (args.mode === "install") {
    out = { ...out, ...(await install(db, COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES, config, scope)) };
  } else if (args.mode === "enable" || args.mode === "disable") {
    out = { ...out, control: await setSwitch(db, COMMAND_EXECUTION_RETIREMENT_CONTROL_ID, args.mode === "enable",
      COMMAND_EXECUTION_ARCHIVE_PACKS_COLLECTION, COMMAND_EXECUTION_ARCHIVE_PACK_INDEXES, now) };
  } else if (args.mode === "run") {
    out = { ...out, ...(await supervise(args.batches, (max) => retireProvenCommandExecutions(db, { maxBatches: max, budgetMs: 120_000 }))) };
  } else {
    if (!args.id) throw new Error("lookup needs --id=<receipt _id>");
    const found = await lookupArchivedCommandExecution(db, args.id);
    const live = await db.collection(DOMAIN_COMMAND_EXECUTION_COLLECTION).findOne({ _id: new mongoose.Types.ObjectId(args.id) }, { projection: { _id: 1 } });
    out = { ...out, id: args.id, in_mongo: live !== null, archived: found ? { pack: found.pack, origin: found.doc.origin, command_name: found.doc.command_name,
      idempotency_key: found.doc.idempotency_key, applied_at: found.doc.applied_at, bytes: mongoose.mongo.BSON.calculateObjectSize(found.doc) } : null };
  }
  console.log(JSON.stringify(out, null, 2));
});
