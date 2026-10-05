/**
 * All Numbers v2 migration (all-numbers CONTRACT §5, phase A).
 *
 *   node --env-file=.env --import tsx ops/numbers-v2/migrate.ts --target=<database>            # dry run (default): reads only
 *   node --env-file=.env --import tsx ops/numbers-v2/migrate.ts --target=<database> --apply    # writes
 *
 * Options: `--limit=N` (stop after N numbers), `--after=<number id>` (resume after an id), `--all` (also
 * re-run numbers already stamped `summary_version: 1`), `--reseed` (with `--all`: re-apply the
 * attachment seed to stamped numbers too, overwriting link decisions made since).
 *
 * For each non-purged Contact Number without `summary_version: 1` (oldest id first), in one
 * transaction per number:
 *   1. seed the lead link from its retained attachments: the newest Owner-confirmed attached Lead
 *      becomes an Owner pin at its `decided_at`, Owner-rejected Leads become `excluded`;
 *   2. recompute the lead link (the automatic rule, or the pin until a newer Lead arrives);
 *   3. recompute the call summary from its calls;
 *   4. stamp `summary_version: 1`.
 * Apply first builds the three v2 `contact_numbers` indexes when missing. Idempotent and resumable:
 * a stamped number is skipped, so a rerun continues where an interrupted run stopped, and a second
 * full pass (`--all`) changes nothing on unchanged data. Production applies pass the production-writer
 * guard. Prints one JSON summary (and a progress line every 500 numbers).
 */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { CONTACT_NUMBER_INDEXES, CONTACT_NUMBER_SUMMARY_VERSION, getContactNumberModel } from "../../src/models/ContactNumber";
import { recomputeCallSummary } from "../../src/services/numberActivity/callSummary";
import {
  leadSnapshot,
  loadLeadRow,
  normalizeStoredLink,
  recomputeLeadLink,
  type NumberLeadSnapshot,
  type StoredLeadLink,
} from "../../src/services/numberActivity/leadLink";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { createIndexOptions, planIndexBuild, type ObservedIndex } from "../lib/sales-outreach-indexes";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { parseNumbersV2Args, seedLeadLinkFromAttachments, type SeedEdge } from "../lib/numbers-v2";

export const V2_INDEX_NAMES = ["contact_number_waiting", "contact_number_lead", "contact_number_other_leads"] as const;
const PAGE = 200;

type Counts = {
  scanned: number;
  summary_changed: number;
  link_changed: number;
  with_lead: number;
  with_other_leads: number;
  waiting: number;
  owner_pins_seeded: number;
  owner_pins_kept: number;
  owner_pins_reverted: number;
  excluded_seeded: number;
  stamped: number;
  failed: number;
};

type NumberRow = { _id: mongoose.Types.ObjectId; summary_version?: number | null; lead_link?: StoredLeadLink | null };

/** The link to plan with: the stored one, or the attachment seed for a number the migration has not reached. */
async function seededLink(number: NumberRow, reseed: boolean, db: mongoose.mongo.Db, session: mongoose.ClientSession | null) {
  const stored = normalizeStoredLink(number.lead_link);
  const seed = number.summary_version !== CONTACT_NUMBER_SUMMARY_VERSION || reseed;
  // An Owner pin made through the new command is newer than any attachment decision: keep it.
  if (!seed || stored?.source === "owner") return { link: stored ?? undefined, pin: undefined, seeded_pin: false, seeded_excluded: 0 };
  // Raw collection: the attachment model leaves the code in phase B; after the cleanup there is nothing to seed.
  const edges = (await db.collection("number_lead_attachments")
    .find({ contact_number_id: number._id }, { session: session ?? undefined, projection: { lead_ref: 1, state: 1, certainty: 1, decided_at: 1, decided_by: 1 } })
    .toArray()) as unknown as SeedEdge[];
  const { pin, excluded } = seedLeadLinkFromAttachments(edges);
  const known = new Set((stored?.excluded ?? []).map((e) => `${e.model}:${String(e.id)}`));
  const mergedExcluded = [...(stored?.excluded ?? []), ...excluded.filter((e) => !known.has(`${e.model}:${e.id}`))
    .map((e) => ({ model: e.model, id: new mongoose.Types.ObjectId(e.id) }))];
  let pinned: NumberLeadSnapshot | undefined;
  if (pin) {
    const row = await loadLeadRow(pin, session);
    if (row && row.duplicate !== true) pinned = leadSnapshot(pin.model, row);
  }
  const link: StoredLeadLink = pinned
    ? { source: "owner", set_at: pin!.set_at, set_by: pin!.set_by ?? "numbers-v2-migration", excluded: mergedExcluded }
    : { source: "automatic", set_at: stored?.set_at ?? null, set_by: null, excluded: mergedExcluded };
  return { link, pin: pinned, seeded_pin: Boolean(pinned), seeded_excluded: excluded.length };
}

async function processNumber(number: NumberRow, args: ReturnType<typeof parseNumbersV2Args>, db: mongoose.mongo.Db, counts: Counts, now: Date) {
  const work = async (session: mongoose.ClientSession | null) => {
    const seeded = await seededLink(number, args.reseed, db, session);
    const link = await recomputeLeadLink(number._id, session, { now, link: seeded.link, pin: seeded.pin, dry_run: !args.apply });
    const summaryChanged = await recomputeCallSummary(number._id, session, { dry_run: !args.apply });
    if (args.apply && number.summary_version !== CONTACT_NUMBER_SUMMARY_VERSION) {
      await getContactNumberModel().updateOne({ _id: number._id }, { $set: { summary_version: CONTACT_NUMBER_SUMMARY_VERSION } },
        { session: session ?? undefined, timestamps: false });
    }
    return { seeded, link, summaryChanged };
  };
  const { seeded, link, summaryChanged } = args.apply ? await withTransaction((session) => work(session)) : await work(null);
  counts.scanned += 1;
  if (summaryChanged) counts.summary_changed += 1;
  if (link?.changed) counts.link_changed += 1;
  if (link?.next.lead) counts.with_lead += 1;
  if (link?.next.other_leads.length) counts.with_other_leads += 1;
  if (seeded.seeded_pin) counts.owner_pins_seeded += 1;
  if (seeded.seeded_pin && link?.next.lead_link.source === "owner") counts.owner_pins_kept += 1;
  if (seeded.seeded_pin && link?.next.lead_link.source === "automatic") counts.owner_pins_reverted += 1;
  if (seeded.seeded_excluded) counts.excluded_seeded += 1;
  if (args.apply && number.summary_version !== CONTACT_NUMBER_SUMMARY_VERSION) counts.stamped += 1;
}

async function ensureIndexes(db: mongoose.mongo.Db, apply: boolean) {
  const declared = [{ collection: "contact_numbers", indexes: CONTACT_NUMBER_INDEXES.filter((index) => (V2_INDEX_NAMES as readonly string[]).includes(index.name)) }];
  const observed = new Map<string, ObservedIndex[]>([["contact_numbers", (await db.collection("contact_numbers").indexes()) as ObservedIndex[]]]);
  const actions = planIndexBuild(declared, observed);
  const conflicts = actions.filter((action) => action.action === "conflict");
  if (conflicts.length) throw new Error(`Index conflicts: ${JSON.stringify(conflicts)}`);
  const create = actions.filter((action) => action.action === "create");
  if (apply) for (const action of create) if (action.action === "create")
    await db.collection("contact_numbers").createIndex(action.spec.key as Record<string, 1 | -1>, createIndexOptions(action.spec));
  return { create: create.map((action) => action.name), exists: actions.filter((action) => action.action === "exists").map((action) => action.name) };
}

export async function runNumbersV2Migration(argv: readonly string[], log: (line: string) => void = console.log) {
  const args = parseNumbersV2Args(argv);
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const db = mongoose.connection.useDb(args.target, { useCache: true }).db;
  if (!db) throw new Error("database handle unavailable");
  if (args.apply) await assertProductionWriterMatchesDeployment();
  const indexes = await ensureIndexes(db, args.apply);
  const counts: Counts = { scanned: 0, summary_changed: 0, link_changed: 0, with_lead: 0, with_other_leads: 0, waiting: 0,
    owner_pins_seeded: 0, owner_pins_kept: 0, owner_pins_reverted: 0, excluded_seeded: 0, stamped: 0, failed: 0 };
  const failures: Array<{ number_id: string; error: string }> = [];
  const now = new Date();
  let after = args.after ? new mongoose.Types.ObjectId(args.after) : null;
  let last: string | null = null;
  const ContactNumber = getContactNumberModel();
  for (;;) {
    const remaining = args.limit === null ? PAGE : Math.min(PAGE, args.limit - counts.scanned - counts.failed);
    if (remaining <= 0) break;
    const filter: Record<string, unknown> = { purged_at: null,
      ...(args.all ? {} : { summary_version: { $ne: CONTACT_NUMBER_SUMMARY_VERSION } }), ...(after ? { _id: { $gt: after } } : {}) };
    const page = (await ContactNumber.find(filter, { summary_version: 1, lead_link: 1 }).sort({ _id: 1 }).limit(remaining).lean()) as unknown as NumberRow[];
    if (!page.length) break;
    for (const number of page) {
      try {
        await processNumber(number, args, db, counts, now);
      } catch (error) {
        counts.failed += 1;
        failures.push({ number_id: String(number._id), error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : "Error" });
      }
      last = String(number._id);
      if ((counts.scanned + counts.failed) % 500 === 0) log(JSON.stringify({ progress: counts.scanned + counts.failed, last_number_id: last }));
    }
    after = page.at(-1)!._id;
  }
  counts.waiting = await ContactNumber.countDocuments({ purged_at: null, waiting_since: { $type: "date" } });
  const remaining = await ContactNumber.countDocuments({ purged_at: null, summary_version: { $ne: CONTACT_NUMBER_SUMMARY_VERSION } });
  const summary = { mode: args.apply ? "apply" : "dry_run", database: args.target, indexes, counts, unstamped_after: remaining,
    last_number_id: last, failures: failures.slice(0, 20), failures_total: failures.length };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("ops/numbers-v2/migrate.ts")) {
  runNumbersV2Migration(process.argv.slice(2))
    .then((summary) => { if (summary.failures_total) process.exitCode = 1; })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "All Numbers v2 migration failed");
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
