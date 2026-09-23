/**
 * B15 / A17 (S4-TIMELINE): timeline v2 latency on the replica for a subject with 50 calls and a
 * realistic mix of every other source (the S4 seed's N2 / record M). Read only; run the seed first
 * (`node --import tsx scripts/dev_ops/test-si-timeline.ts`).
 *
 *   node --import tsx scripts/dev_ops/measure-si-timeline.ts [--reads 120] [--db testvantagemovers_s4timeline]
 *
 * For each of scope `number`, scope `outreach` and the Calls tab (`kinds[]=call`) it measures the
 * first page (`limit=50`) and a later page (the cursor after the first page), `--reads` times each after
 * 5 warm-up reads, and prints p50 / p95 / max. Coverage is read live on every call (as the route does).
 * Target: p95 < 300 ms.
 */
const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1]! : fallback; };
const DATABASE = arg("--db", "testvantagemovers_s4timeline");
const READS = Math.max(100, Number(arg("--reads", "120")));
if (!/^testvantagemovers_[a-z0-9]+$/.test(DATABASE)) throw new Error(`refusing database ${DATABASE}`);
Object.assign(process.env, { CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: REPLICA, MONGODB_URI: REPLICA,
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "false", AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "",
  RINGCENTRAL_ACCOUNT_ID: "" });

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

async function main() {
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { readNumberTimelineV2, readOutreachTimeline } = await import("../../src/services/salesIntelligence/outreach/timelineRead");
  const { S4_AS_OF, S4_IDS } = await import("./lib/si-timeline-seed");
  const mongoose = (await import("mongoose")).default;
  await connectMongo();
  if (getMongoDatabaseName() !== DATABASE) throw new Error("wrong database");
  const calls = await mongoose.connection.useDb(DATABASE, { useCache: true }).db!.collection("call_interactions").countDocuments({ contact_number_id: S4_IDS.n2, merged_into_id: null });
  const now = () => S4_AS_OF;
  type Read = (cursor?: string) => Promise<{ data: { items: unknown[]; cursor: string | null } } | null>;
  const cases: Array<[string, Read]> = [
    ["number", cursor => readNumberTimelineV2(String(S4_IDS.n2), { limit: 50, cursor }, { now })],
    ["outreach", cursor => readOutreachTimeline(String(S4_IDS.recordM), { limit: 50, cursor }, { now })],
    ["calls tab", cursor => readNumberTimelineV2(String(S4_IDS.n2), { limit: 50, cursor, kinds: ["call"] }, { now })],
  ];
  const rows: string[] = [];
  let worst = 0;
  for (const [label, read] of cases) {
    const first = await read();
    if (!first) throw new Error(`${label}: subject missing; run the seed first`);
    const later = first.data.cursor ?? undefined;
    for (const [page, cursor] of [["first", undefined], ["later", later]] as const) {
      if (page === "later" && !cursor) { rows.push(`${label.padEnd(9)} ${page.padEnd(5)} (single page: ${first.data.items.length} events)`); continue; }
      for (let i = 0; i < 5; i++) await read(cursor);
      const times: number[] = [];
      let items = 0;
      for (let i = 0; i < READS; i++) {
        const started = process.hrtime.bigint();
        const result = await read(cursor);
        times.push(Number(process.hrtime.bigint() - started) / 1e6);
        items = result!.data.items.length;
      }
      times.sort((a, b) => a - b);
      worst = Math.max(worst, pct(times, 95));
      rows.push(`${label.padEnd(9)} ${page.padEnd(5)} items=${String(items).padStart(3)} reads=${READS} p50=${pct(times, 50).toFixed(1)}ms p95=${pct(times, 95).toFixed(1)}ms max=${times[times.length - 1]!.toFixed(1)}ms`);
    }
  }
  console.log(`B15/A17 timeline v2 on ${DATABASE} (replica csi01), subject with ${calls} calls, as_of ${S4_AS_OF.toISOString()}`);
  for (const row of rows) console.log(`  ${row}`);
  console.log(`worst p95 ${worst.toFixed(1)} ms → ${worst < 300 ? "PASS" : "FAIL"} (target < 300 ms)`);
  if (worst >= 300) process.exitCode = 1;
  await mongoose.disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
