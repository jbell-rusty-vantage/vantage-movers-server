/**
 * Validated retirement of the Granot incident Entity Changes: operator command (docs/knowledge/validated-retirement.md).
 *
 *   pnpm domain:entity-change-retirement status   --target=vantagemovers                   # read-only: switch, cursor, tails, catalog, bucket rule
 *   pnpm domain:entity-change-retirement dry-run  --target=vantagemovers [--limit=250000]  # read-only verdicts from the stored cursor (no GCS, no writes)
 *   pnpm domain:entity-change-retirement install  --target=vantagemovers                   # catalog indexes + the 90-day bucket rule
 *   pnpm domain:entity-change-retirement enable   --target=vantagemovers                   # the cron starts retiring proven rows
 *   pnpm domain:entity-change-retirement disable  --target=vantagemovers                   # every row stays in MongoDB again
 *   pnpm domain:entity-change-retirement run      --target=vantagemovers [--batches=20]    # one supervised worker pass (same code as the cron)
 *   pnpm domain:entity-change-retirement lookup   --target=vantagemovers --id=<change>     # restore one retired row from GCS (read-only)
 *   pnpm domain:entity-change-retirement lookup   --target=vantagemovers --entity=<CallLead id>  # every archived row of one Call Lead
 *
 * Prints one JSON summary.
 */
import mongoose from "mongoose";
import { ENTITY_CHANGE_COLLECTION } from "../../src/models/EntityChange";
import { ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, readArchivedEntityChanges } from "../../src/services/domainCommands/retirement/archivedEntityChanges";
import {
  ENTITY_CHANGE_ARCHIVE_PACK_INDEXES, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, lookupArchivedEntityChange, retireIncidentEntityChanges,
  reviewIncidentBatch, reviewUntil,
} from "../../src/services/domainCommands/retirement/entityChanges";
import { RETIREMENT_CONTROL_COLLECTION } from "../../src/services/domainCommands/retirement/shared";
import { bucketRuleStatus, catalogSummary, finish, install, open, parse, setSwitch, supervise } from "./retirement-cli";

finish(async () => {
  const args = parse(process.argv.slice(2));
  const { db, reader, database, config, scope } = await open(args);
  const now = new Date();
  const control = await db.collection<{ _id: string; [k: string]: unknown }>(RETIREMENT_CONTROL_COLLECTION).findOne({ _id: ENTITY_CHANGE_RETIREMENT_CONTROL_ID });
  const cursor = (control?.cursor as { entity_id: string; revision_after: number } | null | undefined) ?? null;
  let out: Record<string, unknown> = { mode: args.mode, database, measured_at: now.toISOString() };

  if (args.mode === "status") {
    out = { ...out, enabled_at: control?.enabled_at ?? null, cursor, pass_completed_at: control?.pass_completed_at ?? null,
      review_until: await reviewUntil(db, now), hot_rows: await db.collection(ENTITY_CHANGE_COLLECTION).estimatedDocumentCount(),
      last_run: control?.last_run ?? null, catalog: await catalogSummary(db, ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION),
      bucket_rule: await bucketRuleStatus(config, scope) };
  } else if (args.mode === "dry-run") {
    const until = await reviewUntil(reader, now);
    if (!until) throw new Error("Nothing is reviewable: a lead-change tail has no cursor");
    const tally: Record<string, { rows: number; bytes: number }> = {};
    const leads = new Set<string>();
    let at = cursor, scanned = 0;
    while (scanned < args.limit) {
      const { rows, verdicts } = await reviewIncidentBatch(reader, at, until);
      if (!rows.length) break;
      rows.forEach((r, i) => {
        const v = verdicts[i]!;
        const key = v.verdict === "retire" ? "retire" : `hold:${v.reason}`;
        const t = (tally[key] ??= { rows: 0, bytes: 0 });
        t.rows++; t.bytes += r.raw.length;
        if (v.verdict === "retire") leads.add(String(r.doc.entity.id));
      });
      scanned += rows.length;
      const last = rows.at(-1)!.doc;
      at = { entity_id: String(last.entity.id), revision_after: Number(last.revision_after) };
    }
    out = { ...out, review_until: until, cursor, scanned, call_leads_with_retirable_rows: leads.size, verdicts: tally };
  } else if (args.mode === "install") {
    out = { ...out, ...(await install(db, ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, ENTITY_CHANGE_ARCHIVE_PACK_INDEXES, config, scope)) };
  } else if (args.mode === "enable" || args.mode === "disable") {
    out = { ...out, control: await setSwitch(db, ENTITY_CHANGE_RETIREMENT_CONTROL_ID, args.mode === "enable",
      ENTITY_CHANGE_ARCHIVE_PACKS_COLLECTION, ENTITY_CHANGE_ARCHIVE_PACK_INDEXES, now) };
  } else if (args.mode === "run") {
    out = { ...out, ...(await supervise(args.batches, (max) => retireIncidentEntityChanges(db, { maxBatches: max, budgetMs: 120_000 }))) };
  } else if (args.id) {
    const found = await lookupArchivedEntityChange(db, args.id);
    const live = await db.collection(ENTITY_CHANGE_COLLECTION).findOne({ _id: new mongoose.Types.ObjectId(args.id) }, { projection: { _id: 1 } });
    out = { ...out, id: args.id, in_mongo: live !== null, archived: found ? { pack: found.pack, entity: found.doc.entity, revision_after: found.doc.revision_after,
      applied_at: found.doc.applied_at, changed_paths: found.doc.changed_paths, bytes: mongoose.mongo.BSON.calculateObjectSize(found.doc) } : null };
  } else {
    if (!args.entity || !/^[a-f0-9]{24}$/.test(args.entity)) throw new Error("lookup needs --id=<change _id> or --entity=<CallLead id>");
    const rows = await readArchivedEntityChanges(db, [{ model: "CallLead", id: args.entity }]);
    const revisions = rows.map((r) => Number(r.revision_after)).sort((a, b) => a - b);
    out = { ...out, entity: { model: "CallLead", id: args.entity }, archived_rows: rows.length, first_revision: revisions[0] ?? null, last_revision: revisions.at(-1) ?? null };
  }
  console.log(JSON.stringify(out, null, 2));
});
