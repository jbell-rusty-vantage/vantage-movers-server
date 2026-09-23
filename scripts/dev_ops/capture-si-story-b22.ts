/**
 * B22 (S4-TIMELINE): the model's Subject Story page must be byte-identical before and after the
 * timeline reader changes when the readers are called without the timeline options.
 *
 *   node --import tsx scripts/dev_ops/capture-si-story-b22.ts --db <testvantagemovers_x> --out <file.json> --as-of <iso>
 *   node --import tsx scripts/dev_ops/capture-si-story-b22.ts --compare <before.json> <after.json>
 *
 * Capture: for every Contact Number and every Lead-subject Outreach record in the database, runs
 * `resolveStorySubject` + `assembleSubjectStory` + `storyToReadContent` at a fixed `as_of` and writes
 * one JSON file. It imports only modules that exist at the S4 baseline, so the same file runs in a
 * HEAD worktree (before) and in the working tree (after). Loopback replica only; read only.
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

function compare(beforePath: string, afterPath: string) {
  const before = readFileSync(beforePath, "utf8"), after = readFileSync(afterPath, "utf8");
  const b = JSON.parse(before) as { subjects: Array<{ key: string }> }, a = JSON.parse(after) as { subjects: Array<{ key: string }> };
  if (before === after) { console.log(`B22 identical: ${b.subjects.length} subjects, ${before.length} bytes`); return; }
  for (let i = 0; i < Math.max(a.subjects.length, b.subjects.length); i++) {
    const x = JSON.stringify(b.subjects[i]), y = JSON.stringify(a.subjects[i]);
    if (x !== y) {
      let at = 0; while (at < Math.min(x.length, y.length) && x[at] === y[at]) at++;
      console.error(`B22 DIFFERENT at subject ${b.subjects[i]?.key ?? a.subjects[i]?.key}: before …${x?.slice(Math.max(0, at - 120), at + 120)}… after …${y?.slice(Math.max(0, at - 120), at + 120)}…`);
      break;
    }
  }
  process.exitCode = 1;
}

async function capture(database: string, out: string, asOf: Date) {
  if (!/^testvantagemovers_[a-z0-9]+$/.test(database)) throw new Error(`refusing database ${database}`);
  Object.assign(process.env, { CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, MONGO_URI: REPLICA, MONGODB_URI: REPLICA,
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "false",
    AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", RINGCENTRAL_ACCOUNT_ID: "" });
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { assembleSubjectStory, resolveStorySubject } = await import("../../src/services/salesIntelligence/story/assemble");
  const { storyToReadContent } = await import("../../src/services/salesIntelligence/story/page");
  const mongoose = (await import("mongoose")).default;
  await connectMongo();
  if (getMongoDatabaseName() !== database) throw new Error("wrong database");
  const coverage = { known_through: asOf.toISOString(), gaps: [], capabilities: {}, ai_paused: false };
  const numbers = await getContactNumberModel().find({ purged_at: null }).select("_id").sort({ _id: 1 }).limit(200).lean();
  const records = await getOutreachRecordModel().find({ "subject.kind": "lead" }).select("subject").sort({ _id: 1 }).limit(200).lean();
  const inputs: Array<{ key: string; input: Parameters<typeof resolveStorySubject>[0] }> = [
    ...numbers.map((n: { _id: unknown }) => ({ key: `number:${n._id}`, input: { contact_number_id: String(n._id), as_of: asOf } })),
    ...records.map((r: { subject: { model?: string | null; id?: unknown } }) => ({ key: `lead:${r.subject.model}:${r.subject.id}`, input: { lead: { model: r.subject.model as "FormLead" | "CallLead", id: String(r.subject.id) }, as_of: asOf } })),
  ];
  const subjects: unknown[] = [];
  for (const { key, input } of inputs) {
    const subject = await resolveStorySubject(input);
    if (!subject) { subjects.push({ key, story: null }); continue; }
    const story = await assembleSubjectStory(subject);
    subjects.push({ key, story, page: storyToReadContent(story, coverage) });
  }
  writeFileSync(out, JSON.stringify({ database, as_of: asOf.toISOString(), subjects }, null, 1));
  console.log(`captured ${subjects.length} subjects from ${database} at ${asOf.toISOString()} → ${out}`);
  await mongoose.disconnect();
}

const compareIndex = process.argv.indexOf("--compare");
if (compareIndex >= 0) compare(process.argv[compareIndex + 1]!, process.argv[compareIndex + 2]!);
else capture(arg("--db") ?? "", arg("--out") ?? "b22.json", new Date(arg("--as-of") ?? "2026-09-23T12:00:00.000Z")).catch(error => { console.error(error); process.exitCode = 1; });
