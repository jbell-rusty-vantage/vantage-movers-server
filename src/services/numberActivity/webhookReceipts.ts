import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getRingCentralCollectionName } from "../ringcentral/ringcentral-config";
import { ensureRingCentralWebhookEventIndexes } from "../ringcentral/webhook-capture";

/**
 * Read-only access to the existing raw webhook receipt store
 * (`ringcentral_webhook_events`, `_test`-suffixed in test collection mode).
 * The receipt is the durable provider evidence the capture-projection job
 * loads; this module never writes it and never trusts a queue payload for it.
 */
export type WebhookReceipt = {
  _id: mongoose.Types.ObjectId;
  provider: "ringcentral";
  receivedAt: Date;
  uuid?: string | null;
  telephonySessionId?: string | null;
  rawBody: unknown;
};

/** Keyset position of the last processed receipt: `(receivedAt, _id)`. */
export type ReceiptCursor = { receivedAt: Date; _id: mongoose.Types.ObjectId };

const PROJECTION = { provider: 1, receivedAt: 1, uuid: 1, telephonySessionId: 1, rawBody: 1 } as const;

export async function webhookReceiptsCollection() {
  await connectMongo();
  // Same index set the capture path maintains; the scan index is part of it.
  await ensureRingCentralWebhookEventIndexes();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("MongoDB connection is not ready");
  return db.collection<WebhookReceipt>(getRingCentralCollectionName("webhookEvents"));
}

export async function findWebhookReceiptById(id: string): Promise<WebhookReceipt | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const collection = await webhookReceiptsCollection();
  return collection.findOne({ _id: new mongoose.Types.ObjectId(id) }, { projection: PROJECTION });
}

/**
 * Telephony receipts received in `[from, to]`, oldest first, bounded, in
 * `(receivedAt, _id)` order. With `after`, returns only receipts strictly
 * after that keyset position so same-millisecond clusters page correctly.
 * Used only by the watermark recovery scan. Receipts without a
 * `telephonySessionId` (validation handshakes, non-telephony bodies) carry no
 * party evidence and are excluded here and in the route fan-out alike.
 */
export async function listWebhookReceiptsBetween(
  from: Date,
  to: Date,
  limit: number,
  after: ReceiptCursor | null = null,
): Promise<Array<Pick<WebhookReceipt, "_id" | "receivedAt" | "uuid">>> {
  const collection = await webhookReceiptsCollection();
  const range: Record<string, unknown> = {
    provider: "ringcentral",
    receivedAt: { $gte: from, $lte: to },
    telephonySessionId: { $type: "string" },
  };
  const filter = after
    ? {
        $and: [
          range,
          { $or: [{ receivedAt: { $gt: after.receivedAt } }, { receivedAt: after.receivedAt, _id: { $gt: after._id } }] },
        ],
      }
    : range;
  return collection
    .find(filter, { projection: { _id: 1, receivedAt: 1, uuid: 1 } })
    .sort({ receivedAt: 1, _id: 1 })
    .limit(limit)
    .toArray();
}
