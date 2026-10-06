/**
 * Outreach lifecycle repair C2a: why open desk subjects have no callable number (read-only).
 *
 *   pnpm outreach:subjects-without-numbers --target=<database> [--out=file.json] [--pretty]
 *
 * - The target is named, never inferred, and must equal the database this process resolves.
 * - Strictly read-only: there is no write mode. The collector reads through the OPS-0 `DeskStateReader`
 *   (bounded finds only) and the driver guard exits (97) before any non-read command is sent; no model is
 *   compiled with a connection, so no index or collection is ever created.
 * - Prints one JSON summary (`ops/lib/sales-outreach-subjects-without-numbers.ts`): open subjects with
 *   `contact_number_ids: []` by reason, subjects shadowed by another Lead by that Lead's state, the C2
 *   acceptance count `active_without_number_lead_has_phone`, and at most 200 rows of ids, received time,
 *   reason and the phone masked to its last four digits. `--out` writes the same JSON to a file.
 * - Run it before and after `pnpm numbers:mint-lead-numbers --apply` (C2b): `no_contact_number` should
 *   then be 0, with any remaining row attributable to its reason.
 */
import dns from "node:dns";
import { writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import { installReadOnlyCommandGuard, readOnlyDeskStateReader } from "../lib/sales-outreach-desk-state";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { collectSubjectsWithoutNumbers, parseDiagnosticArgs } from "../lib/sales-outreach-subjects-without-numbers";

/** Same resolver rule as `src/db.ts` (local runs only), without its log line, so stdout stays one JSON document. */
function applyLocalDnsServers(): void {
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") return;
  const servers = (process.env.MONGO_DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

async function main() {
  const args = parseDiagnosticArgs(process.argv.slice(2));
  const database = getMongoDatabaseName();
  assertTargetMatchesDatabase(args.target, database);
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) throw new Error("MONGO_URI is not set");
  applyLocalDnsServers();

  const client = new MongoClient(uri, { monitorCommands: true, maxPoolSize: 2, serverSelectionTimeoutMS: 10_000, readPreference: "primary" });
  installReadOnlyCommandGuard(client);
  try {
    await client.connect();
    const summary = await collectSubjectsWithoutNumbers(readOnlyDeskStateReader(client.db(database)),
      { database, now: new Date(), account: configuredRingCentralAccountId() });
    const json = JSON.stringify(summary, null, args.pretty ? 2 : 0);
    if (args.out) writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${json}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "subjects-without-numbers failed");
  process.exitCode = 1;
});
