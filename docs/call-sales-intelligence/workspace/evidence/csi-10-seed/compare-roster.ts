import mongoose from "mongoose";
import { connectMongo } from "../../../../../src/db";
import { getMongoDatabaseName, isTestMode } from "../../../../../src/config/domain/runtime";
import { getRingCentralDirectorySnapshotModel } from "../../../../../src/models/RingCentralDirectorySnapshot";

/** First-pass map checks only. Live snapshot is authority; stop if these identities moved. */
const GUARDS = [
  { extension_id: "63212075023", extension_number: "121", first_token: "benjamin", label: "ext 121 must still be Benjamin, not Jason" },
  { extension_id: "63296320023", extension_number: "209", first_token: "tyler", label: "Tyler D ext 209" },
  { extension_id: "63235990023", extension_number: "129", first_token: "tyler", label: "Tyler S ext 129" },
] as const;

const UNIQUE_EXPECT = [
  { first: "austin", number: "224" },
  { first: "brian", number: "231" },
  { first: "dylan", number: "221" },
  { first: "jacob", number: "230" },
  { first: "jenna", number: "232" },
  { first: "joshua", number: "220" },
  { first: "mike", number: "216" },
  { first: "nick", number: "234" },
  { first: "patrick", number: "228" },
  { first: "roy", number: "111" },
  { first: "sean", number: "206" },
] as const;

function token(name: string | null | undefined) {
  return (name ?? "").normalize("NFKC").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

async function main() {
  if (isTestMode()) throw new Error("refusing TEST_MODE");
  await connectMongo();
  const database = getMongoDatabaseName();
  if (database !== "vantagemovers") throw new Error(`refusing database ${database}`);
  const snapshot = await getRingCentralDirectorySnapshotModel().findOne({}).sort({ taken_at: -1, _id: -1 }).lean();
  if (!snapshot) throw new Error("no directory snapshot");
  const users = snapshot.extensions.filter((e) => e.type === "User");
  const guards = GUARDS.map((guard) => {
    const user = users.find((e) => e.id === guard.extension_id);
    const observed = token(user?.name);
    const ok = Boolean(user && user.extension_number === guard.extension_number && observed === guard.first_token);
    return { label: guard.label, extension_id: guard.extension_id, observed_first_token: observed || null, ok };
  });
  const unique = UNIQUE_EXPECT.map((expect) => {
    const matches = users.filter((e) => token(e.name) === expect.first || (expect.first === "joshua" && token(e.name) === "josh") || (expect.first === "roy" && token(e.name) === "roys"));
    const user = users.find((e) => e.extension_number === expect.number);
    return {
      expected_first: expect.first,
      extension_number: expect.number,
      observed_first_token: token(user?.name) || null,
      match_count_for_token: matches.length,
      ok: Boolean(user && token(user.name).startsWith(expect.first.slice(0, 3))),
    };
  });
  const stopped = guards.some((g) => !g.ok);
  const report = {
    snapshot_id: String(snapshot._id),
    provider_account_id: snapshot.provider_account_id,
    taken_at: snapshot.taken_at,
    digest: snapshot.digest,
    counts: snapshot.counts,
    user_count: users.length,
    guards,
    unique_name_check: unique,
    stop: stopped,
  };
  console.log(JSON.stringify(report, null, 2));
  if (stopped) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "compare failed");
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
