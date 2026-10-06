/**
 * Read-only state snapshot of the Sales Outreach Desk (outreach lifecycle repair OPS-0): the operator's
 * pre-flight before every deploy/operator step and the source of every production acceptance number.
 *
 *   pnpm outreach:desk-state --target=<database> [--pretty] [--out=<closed.json>] [--compare=<closed.json>]
 *   node --env-file=.env --import tsx ops/sales-outreach/desk-state.ts --target=vantagemovers
 *
 * `--out` writes this run's closed-row `publication_revision` snapshot (subject id → revision) to a local
 * file; `--compare` diffs this run's closed rows against such a file (plan §6 midnight check: take one
 * before 00:00 ET with `--out`, one after with `--compare`; `wave2_acceptance.closed_publication.comparison`).
 * Both touch only the local file system, never the database.
 *
 * - The target is named, never inferred, and must equal the database this process resolves.
 * - Strictly read-only: no write mode exists. The collector reads through `DeskStateReader` (no write
 *   stage in any pipeline) and the driver guard exits (97) before any non-read command is sent; no
 *   model is compiled with a connection, so no index or collection is ever created.
 * - Prints one JSON summary on stdout (indented with `--pretty`): configuration revision/state and
 *   hash integrity, subjects, periods, projections by status, the `next_evaluation_at` histogram,
 *   jobs (open, dead letters, recent completions), watermarks (Call Log, contact calls/SMS, ISync
 *   lane, subscriptions), rep SMS mailbox lag, rep-day rows for NY today/yesterday with count scope
 *   and coverage plus the served `actual_basis` per rep (roster reps without a row included), calls
 *   freshness inputs (ISync lane success, reconcile sync success, newest call webhook), contact events
 *   by association, unconfirmed `call_interactions` by day and direction (Internal apart; the OPS-1
 *   acceptance split before CC-04), open subjects without a number by whether their Lead has a phone,
 *   enrollment runs, and the wave-2 acceptance reads (OPS-0c: read-time verification per channel,
 *   `distinct_overdue_leads` against the design count, `coverage_wait` against the current cadence
 *   coverage, closed rows' `publication_revision`; C8 other outbound per day). Counts, instants, run keys
 *   and id tails only: no customer content or tokens.
 */
import dns from "node:dns";
import { readFileSync, writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import {
  collectDeskStateWithSnapshot,
  installReadOnlyCommandGuard,
  parseClosedPublicationSnapshot,
  parseDeskStateArgs,
  readOnlyDeskStateReader,
} from "../lib/sales-outreach-desk-state";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

/** Same resolver rule as `src/db.ts` (local runs only), without its log line, so stdout stays one JSON document. */
function applyLocalDnsServers(): void {
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") return;
  const servers = (process.env.MONGO_DNS_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

async function main() {
  const args = parseDeskStateArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) throw new Error("MONGO_URI is not set");
  // Read (and validate) the previous snapshot before connecting: a bad file fails fast.
  const previous = args.compare ? parseClosedPublicationSnapshot(JSON.parse(readFileSync(args.compare, "utf8"))) : null;
  applyLocalDnsServers();

  const client = new MongoClient(uri, { monitorCommands: true, maxPoolSize: 2, serverSelectionTimeoutMS: 10_000, readPreference: "primary" });
  installReadOnlyCommandGuard(client);
  try {
    await client.connect();
    const { state, closed_snapshot } = await collectDeskStateWithSnapshot(readOnlyDeskStateReader(client.db(database)), {
      database,
      now: new Date(),
      previous_closed_snapshot: previous,
    });
    if (args.out) writeFileSync(args.out, `${JSON.stringify(closed_snapshot)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(state, null, args.pretty ? 2 : 0)}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "desk-state failed");
  process.exitCode = 1;
});
