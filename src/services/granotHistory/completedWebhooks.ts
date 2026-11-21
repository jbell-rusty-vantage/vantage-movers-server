import type { Db, ObjectId } from "mongodb";
import { retireReceipt, type RetireStorage } from "./retireOnUse";

const routes = ["lead_created", "priority_updated"] as const;
const hot = (db: Db) => db.collection("granot_webhook_receipts");

/** Retires one inbound webhook receipt through the shared retire-on-use path. */
export async function retireWebhookReceipt(db: Db, id: ObjectId, storage: RetireStorage = {}) {
  return (await retireReceipt(db, id, storage, { channels: ["granot_webhook"] })).status;
}

/**
 * Backstop scan for inbound Lead webhooks, newest first per route, for receipts that have no
 * retire-on-use review date (completed before the drainer stamped one, or before the pass was
 * enabled). A held receipt is reviewed again after a day.
 */
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
