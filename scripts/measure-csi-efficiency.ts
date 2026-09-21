/**
 * Read-only Sales Intelligence efficiency aggregates (17 §11).
 *
 * Reproduces the baseline in `docs/call-sales-intelligence-new/17-efficiency-baseline-2026-09-21.json`
 * so a before/after comparison uses the same measurements: durable jobs by
 * stage, status and key family; hourly job growth; Intelligence Runs by status
 * and processing reason; admission pauses; unresolved provider reservations;
 * Outreach inventory. No document bodies, transcripts or identifiers are
 * printed. Runs against whatever `MONGO_URI` / `TEST_MODE` select, exactly like
 * the other `scripts/dev_ops` inspectors.
 *
 *   node --env-file=.env --import tsx scripts/measure-csi-efficiency.ts [--hours 24] [--json]
 */
import { connectMongo } from "../src/db";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceEffectModel } from "../src/models/IntelligenceEffect";
import { getSalesIntelligenceAiReservationModel } from "../src/models/SalesIntelligenceAiReservation";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { csiDataset } from "../src/config/domain/salesIntelligence";

const args = process.argv.slice(2);
const hours = Number(args[args.indexOf("--hours") + 1] || 24);
const json = args.includes("--json");

function family(key: string) {
  return key.replace(/[a-f0-9]{24}/g, "<id>").replace(/[a-f0-9]{40,64}/g, "<hash>").replace(/\d{12,}/g, "<ts>").replace(/:\d+(?=:|$)/g, ":<n>");
}

async function main() {
  await connectMongo();
  const dataset = csiDataset();
  const Jobs = getSalesIntelligenceJobModel();
  const since = new Date(Date.now() - hours * 3_600_000);

  const byStageStatus = await Jobs.aggregate<{ _id: { stage: string; status: string }; count: number }>([
    { $match: dataset }, { $group: { _id: { stage: "$stage", status: "$status" }, count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  const keys = await Jobs.find({ ...dataset, createdAt: { $gte: since } }, { dedupe_key: 1, stage: 1, status: 1, createdAt: 1, _id: 0 }).lean();
  const families = new Map<string, number>();
  const perHour = new Map<string, number>();
  for (const row of keys) {
    const f = `${row.stage} ${family(row.dedupe_key)}`;
    families.set(f, (families.get(f) ?? 0) + 1);
    const hour = new Date(row.createdAt).toISOString().slice(0, 13);
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
  }
  const stats = await Jobs.collection.aggregate([{ $collStats: { storageStats: {} } }]).toArray().catch(() => []);
  const storage = stats[0]?.storageStats ? { documents: stats[0].storageStats.count, data_bytes: stats[0].storageStats.size, index_bytes: stats[0].storageStats.totalIndexSize } : null;

  const runs = await getIntelligenceRunModel().aggregate<{ _id: { status: string; reason: string | null; mode: string }; count: number }>([
    { $match: dataset }, { $group: { _id: { status: "$status", reason: "$processing_reason", mode: "$mode" }, count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  const paused = await Jobs.aggregate<{ _id: { stage: string; reason: string | null; detail: string | null }; count: number }>([
    { $match: { ...dataset, status: "paused" } }, { $group: { _id: { stage: "$stage", reason: "$reason", detail: "$result.reason" }, count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  const admissionSample = await Jobs.findOne({ ...dataset, status: "paused", "result.admission": { $exists: true } }, { "result.admission": 1, reason: 1, _id: 0 }).sort({ updatedAt: -1 }).lean();
  const reservations = await getSalesIntelligenceAiReservationModel().aggregate<{ _id: { status: string; started: boolean; complete: boolean }; count: number; estimated: number; actual: number }>([
    { $group: { _id: { status: "$status", started: "$provider_started", complete: "$usage_complete" }, count: { $sum: 1 }, estimated: { $sum: "$estimated_cents" }, actual: { $sum: { $ifNull: ["$actual_cents", 0] } } } },
  ]);
  const effects = await getIntelligenceEffectModel().aggregate<{ _id: { status: string; reason: string | null }; count: number }>([
    { $group: { _id: { status: "$status", reason: "$reason" }, count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  const outreach = await getOutreachRecordModel().aggregate<{ _id: { kind: string; state: string }; count: number }>([
    { $match: { purged_at: null } }, { $group: { _id: { kind: "$subject.kind", state: "$state" }, count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  const expiredWaits = await getOutreachFollowupModel().countDocuments({ status: "open", kind: "wait", due_at: { $lte: new Date() }, wait_expired_at: null });
  const edges = await getNumberLeadAttachmentModel().aggregate<{ _id: { state: string; certainty: string }; count: number }>([
    { $group: { _id: { state: "$state", certainty: "$certainty" }, count: { $sum: 1 } } },
  ]);

  const report = {
    measured_at: new Date().toISOString(), window_hours: hours, dataset,
    jobs: { storage, by_stage_status: byStageStatus.map(r => ({ ...r._id, count: r.count })),
      created_in_window: keys.length, per_hour: [...perHour].sort().map(([hour, count]) => ({ hour, count })),
      families_in_window: [...families].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([key, count]) => ({ key, count })) },
    runs: runs.map(r => ({ ...r._id, count: r.count })),
    paused_jobs: paused.map(r => ({ ...r._id, count: r.count })), admission_sample: admissionSample ?? null,
    reservations: reservations.map(r => ({ ...r._id, count: r.count, estimated_cents: r.estimated, actual_cents: r.actual })),
    effects: effects.map(r => ({ ...r._id, count: r.count })),
    outreach: { records: outreach.map(r => ({ ...r._id, count: r.count })), expired_waits_unstamped: expiredWaits },
    attachment_edges: edges.map(r => ({ ...r._id, count: r.count })),
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`CSI efficiency ${report.measured_at} (${dataset.database}, last ${hours}h)`);
    console.log(`jobs: ${storage ? `${storage.documents} docs, ${(storage.data_bytes / 1048576).toFixed(1)} MiB data, ${(storage.index_bytes / 1048576).toFixed(1)} MiB index` : "storage unavailable"}; created in window ${keys.length}`);
    for (const f of report.jobs.families_in_window.slice(0, 15)) console.log(`  ${String(f.count).padStart(7)}  ${f.key}`);
    console.log("runs:"); for (const r of report.runs) console.log(`  ${String(r.count).padStart(7)}  ${r.mode} ${r.status} ${r.reason ?? ""}`);
    console.log("paused jobs:"); for (const r of report.paused_jobs) console.log(`  ${String(r.count).padStart(7)}  ${r.stage} ${r.reason ?? ""} ${r.detail ?? ""}`);
    console.log("reservations:"); for (const r of report.reservations) console.log(`  ${String(r.count).padStart(7)}  ${r.status} started=${r.started} complete=${r.complete} est=${r.estimated_cents}c actual=${r.actual_cents}c`);
    console.log("effects:"); for (const r of report.effects) console.log(`  ${String(r.count).padStart(7)}  ${r.status} ${r.reason ?? ""}`);
    console.log(`outreach: ${report.outreach.records.map(r => `${r.kind}/${r.state}=${r.count}`).join(" ")}; expired waits not yet stamped ${expiredWaits}`);
  }
  process.exit(0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
