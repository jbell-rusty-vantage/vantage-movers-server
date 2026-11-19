import { isDeepStrictEqual } from "node:util";
import { readRetiredWebhook, webhookReceiptFormat } from "./completedWebhooks";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { easternDayKey } from "../dailyOperations/dayDocument";
import { currentReceiptReplay } from "../granotLifecycle/receiptReplay";
import { decodeChains, type ArchivedChain } from "./archiveCodec";
import { readArchiveObject } from "./archiveObjects";

export type ReceiptArchiveLocator = { job: string; hash: string; generation?: string };

const completion = new Set(["already_current", "applied", "linked", "created", "stale"]);

/** Positive set of completed, unambiguous Lead snapshots. Booking actions, unresolved work and pairing evidence stay hot. */
export function settledLeadSnapshot(c: ArchivedChain, cutoff: Date) {
  const { receipt: r, observation: o, decisions } = c;
  const d = decisions[0];
  if (decisions.length !== 1 || d.execution_mode !== "live" || !completion.has(d.outcome) ||
      (d.outcome === "stale" && d.reason_code !== "older_than_temporal_winner") ||
      !["FormLead", "CallLead"].includes(d.target?.model) || !Array.isArray(d.effects) ||
      String(r.processing?.latest_decision_id) !== String(d._id) || r.processing?.state !== "completed" ||
      String(d.observation_id) !== String(o._id) || String(o.receipt_id) !== String(r._id) ||
      o.kind !== "lead_snapshot" || !o.identity?.normalized_job_no || o.priority?.valid !== true ||
      String(o.priority.canonical) === "5" || o.booking_action?.normalized ||
      [r.captured_at, o.captured_at, d.decided_at, r.processing.completed_at].some(at => !(at instanceof Date) || +at >= +cutoff)) return false;
  if (r.observation_channel === "granot_webhook") {
    return r.webhook_day_counted === true && r.route_event_class === o.route_event_class &&
      ["lead_created", "priority_updated"].includes(r.route_event_class);
  }
  if (o.route_event_class || r.channel_operation_kind !== "lead_snapshot_apply") return false;
  if (r.observation_channel === "granot_http_automation") return true;
  if (r.observation_channel !== "browser_extension" || !r.channel_operation_id || !/^[a-f0-9]{64}$/.test(r.payload_sha256)) return false;
  const saved = currentReceiptReplay(r.processing.replay_result, r.processing.latest_decision_id);
  return !!saved && saved.outcome === d.outcome && saved.decision_id === String(d._id) && saved.observation_id === String(o._id)
    && isDeepStrictEqual(saved.effects, d.effects) && isDeepStrictEqual(saved.target, d.target);
}

export async function verifiedWebhookDays(db: Db, chains: ArchivedChain[], session?: ClientSession) {
  const days = [...new Set(chains.filter(c => c.receipt.observation_channel === "granot_webhook").map(c => easternDayKey(c.receipt.captured_at)))];
  if (!days.length) return new Set<string>();
  const rows = await db.collection(getDailyOperationsCollectionName("days")).find({
    day: { $in: days }, $or: [{ webhook_counts_version: 1 }, { status: "closed", closed_at: { $type: "date" } }],
  }, { session, projection: { day: 1 }, maxTimeMS: 3000 }).toArray();
  return new Set(rows.map(row => String(row.day)));
}

export function hasDailyEvidence(c: ArchivedChain, days: Set<string>) {
  return c.receipt.observation_channel !== "granot_webhook" || days.has(easternDayKey(c.receipt.captured_at));
}

/** The original unique channel-operation key fences late extension captures even after the source data leaves Mongo. */
export async function preserveReceiptLocator(db: Db, chain: ArchivedChain, locator: ReceiptArchiveLocator, session: ClientSession) {
  const r = chain.receipt;
  if (r.observation_channel === "browser_extension") {
    const saved = await db.collection("granot_webhook_receipts").updateOne({
      _id: r._id, "processing.state": "completed", "processing.latest_decision_id": r.processing.latest_decision_id,
      channel_operation_id: r.channel_operation_id, payload_sha256: r.payload_sha256,
    }, { $set: { history_archive: locator }, $unset: { payload: "", headers: "", initiator: "", "processing.retention_review_at": "" } }, { session });
    if (saved.matchedCount !== 1) throw new Error("Granot extension replay identity changed");
  } else {
    await db.collection("granot_archived_receipts").updateOne({ _id: r._id, job: locator.job, hash: locator.hash }, { $setOnInsert: locator }, { upsert: true, session });
  }
}

/** On-demand diagnostics for archived webhooks and extension operations. A corrupt locator must fail visibly. */
export async function readArchivedReceipt(db: Db, receiptId: ObjectId, read = readArchiveObject) {
  const recorded = await db.collection<ReceiptArchiveLocator>("granot_archived_receipts").findOne({ _id: receiptId });
  if ((recorded as { format?: string } | null)?.format === webhookReceiptFormat) {
    const receipt = await readRetiredWebhook(db, receiptId, undefined, read);
    const observation = await db.collection("granot_observations").findOne({ receipt_id: receiptId });
    if (!receipt || !observation) throw new Error("Archived webhook evidence missing");
    const decisions = await db.collection("synchronization_decisions").find({ observation_id: observation._id }).sort({ attempt: 1 }).toArray();
    return { receipt, observation, decisions };
  }
  const locator = recorded ?? (await db.collection("granot_webhook_receipts").findOne(
    { _id: receiptId }, { projection: { history_archive: 1 } }))?.history_archive as ReceiptArchiveLocator | undefined;
  if (!locator) return null;
  const bytes = await read(db.databaseName, locator.hash, locator.generation);
  const chain = decodeChains(bytes, locator.hash, locator.job).find(c => String(c.receipt._id) === String(receiptId));
  if (!chain) throw new Error("Granot archived receipt missing from its verified page");
  return chain;
}
