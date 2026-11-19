import {
  BSON,
  ObjectId,
  type ClientSession,
  type Db,
  type Document,
} from "mongodb";
import { gzipSync, gunzipSync } from "node:zlib";
import type { GranotObservationReceiptDocument } from "../../models/GranotObservationReceipt";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { easternDayKey } from "../dailyOperations/dayDocument";
import { digest } from "./archiveCodec";
import { readArchiveObject, storeArchiveObject } from "./archiveObjects";

export const webhookReceiptFormat = "completed-webhook-bson-v1";
const routes = ["lead_created", "priority_updated"] as const;
const hot = (db: Db) => db.collection("granot_webhook_receipts");
export const archivedReceipts = (db: Db) =>
  db.collection("granot_archived_receipts");

function restore(bytes: Buffer, hash: string, id: ObjectId) {
  if (digest(bytes) !== hash)
    throw new Error("Webhook archive checksum mismatch");
  const raw = gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
  const receipt = BSON.deserialize(raw) as GranotObservationReceiptDocument;
  if (
    !id.equals(receipt._id) ||
    receipt.observation_channel !== "granot_webhook" ||
    !routes.some((route) => route === receipt.route_event_class) ||
    receipt.processing.state !== "completed"
  ) {
    throw new Error("Webhook archive identity mismatch");
  }
  return { raw, receipt };
}

export async function readRetiredWebhook(
  db: Db,
  id: ObjectId,
  session?: ClientSession,
  read = readArchiveObject,
) {
  const locator = await archivedReceipts(db).findOne(
    { _id: id, format: webhookReceiptFormat },
    { session },
  );
  if (!locator) return null;
  if (!locator.generation)
    throw new Error("Webhook archive generation missing");
  const bytes = await read(db.databaseName, locator.hash, locator.generation);
  const { receipt } = restore(bytes, locator.hash, id);
  // Reconciliation can replace the latest Decision after the original receipt was archived.
  receipt.processing.latest_decision_id = locator.processing.latest_decision_id;
  receipt.processing.certified_lead = locator.processing.certified_lead;
  return receipt;
}

async function fulfilled(db: Db, r: Document, session?: ClientSession) {
  if (
    r.observation_channel !== "granot_webhook" ||
    !routes.some((route) => route === r.route_event_class) ||
    r.webhook_day_counted !== true ||
    r.processing?.state !== "completed" ||
    !(r.processing.completed_at instanceof Date) ||
    !(r.processing.latest_decision_id instanceof ObjectId)
  )
    return false;
  const opts = { session, maxTimeMS: 3000 };
  const observation = await db
    .collection("granot_observations")
    .findOne(
      {
        receipt_id: r._id,
        route_event_class: r.route_event_class,
        kind: "lead_snapshot",
      },
      { ...opts, projection: { _id: 1 } },
    );
  if (!observation) return false;
  const d = await db
    .collection("synchronization_decisions")
    .findOne(
      {
        _id: r.processing.latest_decision_id,
        observation_id: observation._id,
        execution_mode: "live",
      },
      opts,
    );
  if (!d) return false;
  const day = await db
    .collection(getDailyOperationsCollectionName("days"))
    .findOne(
      {
        day: easternDayKey(r.captured_at),
        webhook_counts_version: 1,
      },
      { ...opts, projection: { _id: 1 } },
    );
  if (!day) return false;
  const scope = d.source_scope ?? d.source_policy;
  const observationOnly =
    ["policy_blocked", "unmatched"].includes(d.outcome) &&
    d.reason_code === "creation_policy_observation_only";
  const matchExpired =
    d.outcome === "unmatched" && d.reason_code === "match_window_expired";
  if (
    r.route_event_class === "lead_created" &&
    (observationOnly || matchExpired)
  ) {
    if (!scope?.granot_crm_source_id || !scope.policy_version) return false;
    return !!(await db
      .collection("granot_crm_sources")
      .findOne(
        {
          _id: scope.granot_crm_source_id,
          lifecycle_policy_version: scope.policy_version,
          lead_created_policy: { $in: ["link_only", "observation_only"] },
        },
        { ...opts, projection: { _id: 1 } },
      ));
  }
  const { model, id } = d.target ?? {};
  if (!["CallLead", "FormLead"].includes(model) || !ObjectId.isValid(id ?? ""))
    return false;
  const effect = (kind: string) =>
    d.effects?.some(
      (e: Document) =>
        e.kind === kind &&
        e.ref?.model === model &&
        String(e.ref.id) === String(id),
    );
  const accepted =
    (d.outcome === "applied" && effect("lead_updated")) ||
    (d.outcome === "created" &&
      r.route_event_class === "lead_created" &&
      model === "FormLead" &&
      effect("lead_created")) ||
    (d.outcome === "already_current" &&
      d.reason_code === "desired_state_already_current") ||
    (d.outcome === "linked" && d.reason_code === "record_link_established") ||
    (d.outcome === "stale" && d.reason_code === "older_than_temporal_winner");
  return (
    accepted &&
    !!(await db
      .collection(model === "FormLead" ? "form_leads" : "call_leads")
      .findOne(
        {
          _id: new ObjectId(id),
          ...(d.outcome === "created"
            ? { ingestion_origin: "granot_lead_created" }
            : {}),
        },
        { ...opts, projection: { _id: 1 } },
      ))
  );
}

type Storage = { store: typeof storeArchiveObject };
export async function retireWebhookReceipt(
  db: Db,
  id: ObjectId,
  storage: Storage = { store: storeArchiveObject },
) {
  const original = await hot(db).findOne({ _id: id }, { raw: true });
  if (!Buffer.isBuffer(original)) return "absent";
  const r = BSON.deserialize(original);
  if (!(await fulfilled(db, r))) return "held";
  const object = await storage.store(db.databaseName, gzipSync(original));
  if (
    !object.generation ||
    !restore(object.persisted, object.hash, id).raw.equals(original)
  )
    throw new Error("Webhook receipt restore mismatch");
  const session = db.client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const fresh = await hot(db).findOne(
          { _id: id },
          { raw: true, session },
        );
        if (
          !Buffer.isBuffer(fresh) ||
          !fresh.equals(original) ||
          !(await fulfilled(db, r, session))
        )
          return "changed";
        await archivedReceipts(db).insertOne(
          {
            _id: id,
            format: webhookReceiptFormat,
            archived_at: new Date(),
            hash: object.hash,
            generation: object.generation,
            route_event_class: r.route_event_class,
            observation_channel: r.observation_channel,
            captured_at: r.captured_at,
            createdAt: r.createdAt,
            processing: {
              state: "completed",
              latest_decision_id: r.processing.latest_decision_id,
              ...(r.processing.certified_lead
                ? { certified_lead: r.processing.certified_lead }
                : {}),
            },
          },
          { session },
        );
        const removed = await hot(db).deleteOne({ _id: id }, { session });
        if (removed.deletedCount !== 1)
          throw new Error("Webhook receipt retirement lost source");
        return "retired";
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
}

export async function retireCompletedWebhooks(db: Db, now = new Date()) {
  const counts = { examined: 0, retired: 0, held: 0, failures: 0 };
  for (const route of routes) {
    const candidates = await hot(db)
      .find(
        {
          route_event_class: route,
          observation_channel: "granot_webhook",
          webhook_day_counted: true,
          "processing.state": "completed",
          $or: [
            { "processing.webhook_archive_review_at": { $exists: false } },
            { "processing.webhook_archive_review_at": { $lte: now } },
          ],
        },
        { projection: { _id: 1 }, maxTimeMS: 4000 },
      )
      .hint("granot_observation_receipt_route_event_captured")
      .sort({ captured_at: -1 })
      .limit(8)
      .toArray();
    for (const { _id } of candidates) {
      counts.examined++;
      let retryMs = 0;
      try {
        const result = await retireWebhookReceipt(db, _id);
        if (result === "retired") counts.retired++;
        if (result === "held") {
          counts.held++;
          retryMs = 86400000;
        }
      } catch {
        counts.failures++;
        break;
      }
      if (retryMs)
        await hot(db).updateOne(
          { _id, "processing.state": "completed" },
          {
            $set: {
              "processing.webhook_archive_review_at": new Date(+now + retryMs),
            },
          },
        );
    }
  }
  return counts;
}
