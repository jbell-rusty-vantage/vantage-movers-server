import dns from "node:dns";
import { MongoClient } from "mongodb";
import { writeFile } from "node:fs/promises";

async function main() {
  const dest = process.argv[2];
  if (!dest) throw new Error("Supply an unused JSON destination");
  if (process.env.MONGO_DNS_SERVERS)
    dns.setServers(
      process.env.MONGO_DNS_SERVERS.split(",").map((x) => x.trim()),
    );
  const client = new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 1,
    appName: "granot-retention-capacity",
  });
  try {
    const db = client.db("vantagemovers"),
      stats = await db.stats(),
      capturedAt = new Date();
    const collections = [];
    for (const name of [
      "granot_webhook_receipts",
      "granot_observations",
      "synchronization_decisions",
      "granot_automation_runs",
      "sales_intelligence_jobs",
      "sales_intelligence_audit_events",
      "daily_operations_events",
      "granot_case_observations",
      "granot_case_statements",
      "granot_case_decisions",
      "granot_history_archive_chunks",
      "granot_closed_automation_runs",
    ]) {
      const s = await db.command({ collStats: name });
      const ttl = Object.hasOwn(
        s.indexSizes ?? {},
        "granot_retention_purge_v1",
      );
      const pendingTTL = ttl
        ? await db
            .collection(name)
            .countDocuments(
              { retention_purge_at: { $type: "date" } },
              { hint: "granot_retention_purge_v1", maxTimeMS: 3000 },
            )
        : null;
      collections.push({
        name,
        rows: s.count,
        logical: s.size,
        data: s.storageSize,
        index: s.totalIndexSize,
        reusable: s.freeStorageSize ?? 0,
        pendingTTL,
      });
    }
    const snapshots = await db
      .collection("capacity_snapshots")
      .find(
        { "database.data_bytes": { $type: "number" } },
        {
          projection: { _id: 0, day: 1, taken_at: 1, "database.data_bytes": 1 },
        },
      )
      .sort({ day: -1 })
      .limit(30)
      .toArray();
    const week = snapshots.slice(0, 8);
    const diff =
      week.length > 1
        ? (week[0].database.data_bytes - week.at(-1)!.database.data_bytes) /
          ((+week[0].taken_at - +week.at(-1)!.taken_at) / 86400000)
        : null;
    const freeToWarning = stats.fsTotalSize * 0.75 - stats.fsUsedSize;
    const report = {
      capturedAt,
      filesystemUsed: stats.fsUsedSize,
      filesystemTotal: stats.fsTotalSize,
      applicationAllocated: stats.totalSize,
      remainingTo75Percent: freeToWarning,
      maximumDailyNetGrowthTo75Percent: {
        twoYears: freeToWarning / 730,
        fourYears: freeToWarning / 1460,
      },
      recentDailyApplicationAllocationChange: diff,
      preRetentionTrendWindow: week.map((s) => s.day),
      twoAndFourYearRunwayQualified: false,
      qualification:
        "Measure actual filesystem growth after rolling classes mature, including the Daily Operations ramp, indexes, backlog and oplog.",
      collections,
    };
    await writeFile(dest, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(
      JSON.stringify({
        filesystemUsed: stats.fsUsedSize,
        filesystemTotal: stats.fsTotalSize,
        dailyCeilingFourYears: freeToWarning / 1460,
        dailyCeilingTwoYears: freeToWarning / 730,
        recentDailyAllocationChange: diff,
        applicationAllocated: stats.totalSize,
        queuedTTLDates: collections.reduce(
          (s, r) => s + (r.pendingTTL ?? 0),
          0,
        ),
      }),
    );
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e.name, e.code ?? "capacity_failed");
  process.exitCode = 1;
});
