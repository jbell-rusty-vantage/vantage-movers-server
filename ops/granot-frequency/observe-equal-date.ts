/** W1 aggregate-only release observation. No application models, hooks or writes.
 * node --env-file=<operator environment> --import tsx ops/granot-frequency/observe-equal-date.ts <from ISO> <to ISO>
 * Counts newly allocated ObjectIds in [from,to), not every update or physical byte written.
 */
import { MongoClient, ObjectId, type Document } from "mongodb";

async function main() {
  const from = new Date(process.argv[2] ?? "");
  const to = new Date(process.argv[3] ?? "");
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to - +from > 2 * 60 * 60 * 1000) {
    throw new Error("Supply an explicit positive window of at most two hours.");
  }
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, maxPoolSize: 1 });
  try {
    await client.connect();
    const db = client.db("vantagemovers");
    const window = { _id: { $gte: ObjectId.createFromTime(Math.floor(+from / 1000)), $lt: ObjectId.createFromTime(Math.floor(+to / 1000)) } };
    const aggregate = (collection: string, pipeline: Document[]) => db.collection(collection)
      .aggregate(pipeline, { maxTimeMS: 15000, hint: "_id_", allowDiskUse: false }).toArray();
    const result: Record<string, unknown> = { observed_at: new Date(), from, to, database: db.databaseName,
      basis: "ObjectId creation window; counts of new rows, not disk savings or all queue updates" };
    result.deployment = await db.collection("sales_intelligence_sync_state").findOne({ scope: "deployment" },
      { projection: { _id: 0, deployment_commit: 1, recorded_at: 1, vercel_deployment_id: 1 }, maxTimeMS: 15000 });
    result.call_changes = await aggregate("entity_changes", [
      { $match: { ...window, command_name: "synchronizeLeadFromGranot", "entity.model": "CallLead" } },
      { $group: { _id: null, total: { $sum: 1 }, provenance_only: { $sum: { $cond: [
        { $setEquals: ["$fields.path", ["current_move_provenance", "last_accepted_granot_observation"]] }, 1, 0,
      ] } } } }, { $project: { _id: 0 } },
    ]);
    result.call_decisions = await aggregate("synchronization_decisions", [
      { $match: { ...window, execution_mode: "live", "target.model": "CallLead" } },
      { $group: { _id: "$outcome", count: { $sum: 1 }, sheet_requests: { $sum: { $cond: [
        { $in: ["sheet_sync_requested", { $ifNull: ["$effects.kind", []] }] }, 1, 0,
      ] } } } }, { $sort: { _id: 1 } },
    ]);
    result.recent_equal_call_sample = await aggregate("synchronization_decisions", [
      { $match: { ...window, execution_mode: "live", "target.model": "CallLead", outcome: "already_current" } },
      { $sort: { _id: -1 } }, { $limit: 20 },
      { $set: { lead_id: { $convert: { input: "$target.id", to: "objectId", onError: null, onNull: null } } } },
      { $lookup: { from: "call_leads", localField: "lead_id", foreignField: "_id", as: "lead" } },
      { $lookup: { from: "granot_observations", localField: "observation_id", foreignField: "_id", as: "observation" } },
      { $unwind: "$lead" }, { $unwind: "$observation" },
      { $group: { _id: null, inspected: { $sum: 1 }, no_effects: { $sum: { $cond: [{ $eq: [{ $size: "$effects" }, 0] }, 1, 0] } },
        equal_date: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: "$observation.move.move_date" }, "date"] },
          { $eq: ["$observation.move.move_date", "$lead.move_date"] }] }, 1, 0] } },
        still_current_winner: { $sum: { $cond: [{ $and: [
          { $eq: ["$lead.last_accepted_granot_observation.observation_id", "$observation_id"] },
          { $eq: ["$lead.last_accepted_granot_observation.captured_at", "$observation.captured_at"] },
        ] }, 1, 0] } },
      } }, { $project: { _id: 0 } },
    ]);
    result.call_sheet_jobs = await aggregate("sheet_sync_jobs", [
      { $match: { ...window, operation: "call_lead.update" } },
      { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]);
    result.daily_facts = await aggregate("daily_operations_events", [
      { $match: { ...window, kind: { $in: ["granot.linked", "sheet_sync.completed"] } } },
      { $group: { _id: "$kind", count: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]);
    result.recent_receipts = await aggregate("granot_webhook_receipts", [
      { $match: window }, { $group: { _id: "$processing.state", count: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]);
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Read-only W1 observation failed:", error.code ?? error.name); process.exitCode = 1; });
