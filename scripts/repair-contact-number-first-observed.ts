/**
 * LP-06 (Lead progress spec §14.2): bounded, resumable repair of
 * `contact_numbers.first_observed_at` to the earliest canonical Call
 * Interaction (`merged_into_id: null`). Dry run unless `--apply`.
 *
 *   node --import tsx scripts/repair-contact-number-first-observed.ts [--limit=500] [--after=<id>] [--apply]
 *
 * Scans `--limit` Contact Numbers in `_id` order after `--after`, prints
 * `{scanned, changed, unchanged, errors, next_after}` and never writes
 * `last_activity_at`, rollups or search terms. Resume with `--after=<next_after>`
 * until `next_after` is null. Each write is a revision CAS plus a
 * `number.first_observed_repaired` audit row; rerun to pick up errors.
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { repairFirstObservedAt } from "../src/services/numberActivity/rebuild";

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  // Operational runs must not build application indexes as a connection side effect.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  const apply = process.argv.includes("--apply");
  const limit = Number(argValue("limit") ?? 500);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) throw new Error("--limit must be an integer 1..5000");
  const after = argValue("after") ?? null;
  if (after !== null && !/^[a-f\d]{24}$/i.test(after)) throw new Error("--after must be a Contact Number id");
  await connectMongo();
  const summary = await repairFirstObservedAt({ limit, after, apply });
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      database: mongoose.connection.name,
      scanned: summary.scanned,
      changed: summary.changed,
      unchanged: summary.unchanged,
      no_evidence: summary.no_evidence,
      errors: summary.errors,
      lowered: summary.changes.filter((c) => c.direction === "lowered").length,
      raised: summary.changes.filter((c) => c.direction === "raised").length,
      next_after: summary.next_after,
      error_ids: summary.error_ids,
    }),
  );
  if (summary.errors) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "First observed repair failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
