import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";

/**
 * Backfills `lead_conversations.contact_number_id` from the recording link
 * (14 §9).
 *
 * Recording discovery has stamped the Contact Number on every conversation it
 * writes since CSI-11; rows written before that carry the link only through
 * `call_interactions.recordings[].lead_conversation_id` (or, failing that, the
 * account-scoped `provider_recording_id`). The number timeline reads
 * conversations straight off `contact_number_id`, so this migration is what
 * retires the per-page recording scan for historical rows.
 *
 * Idempotent: it only ever writes rows whose `contact_number_id` is unset, and
 * only from an interaction that has one. Never invents a link — a conversation
 * whose interaction has no Contact Number is reported as `unresolved`, not
 * guessed at from a phone number.
 */
export type ConversationLinkReport = {
  version: "csi-conversation-contact-number-v1";
  database: string;
  mode: "verify" | "apply";
  scanned: number;
  resolvable: number;
  written: number;
  unresolved: number;
};

export async function backfillConversationContactNumbers(
  mode: "verify" | "apply",
  options: { batch?: number } = {},
): Promise<ConversationLinkReport> {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("Mongo unavailable");
  const conversations = db.collection("lead_conversations");
  const interactions = db.collection("call_interactions");
  const batch = options.batch ?? 500;
  const report: ConversationLinkReport = {
    version: "csi-conversation-contact-number-v1",
    database: db.databaseName,
    mode,
    scanned: 0,
    resolvable: 0,
    written: 0,
    unresolved: 0,
  };

  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const rows = await conversations
      .find(
        {
          $or: [{ contact_number_id: null }, { contact_number_id: { $exists: false } }],
          ...(after ? { _id: { $gt: after } } : {}),
        },
        {
          projection: { call_interaction_id: 1, provider: 1, provider_account_id: 1, provider_recording_id: 1 },
          sort: { _id: 1 },
          limit: batch,
        },
      )
      .toArray();
    if (!rows.length) break;
    report.scanned += rows.length;
    after = rows.at(-1)!._id as mongoose.Types.ObjectId;

    const byId = new Map<string, mongoose.Types.ObjectId>();
    const directIds = rows.flatMap((row) => (row.call_interaction_id ? [row.call_interaction_id] : []));
    if (directIds.length) {
      for (const interaction of await interactions
        .find({ _id: { $in: directIds }, contact_number_id: { $ne: null } }, { projection: { contact_number_id: 1 } })
        .toArray()) {
        byId.set(String(interaction._id), interaction.contact_number_id as mongoose.Types.ObjectId);
      }
    }
    // Rows with no `call_interaction_id` are matched through the recording id
    // within their own provider account; a recording id alone never crosses an
    // account boundary.
    const recordingRows = rows.filter((row) => !row.call_interaction_id && row.provider_account_id);
    const byRecording = new Map<string, mongoose.Types.ObjectId>();
    if (recordingRows.length) {
      for (const interaction of await interactions
        .find(
          {
            merged_into_id: null,
            contact_number_id: { $ne: null },
            provider_account_id: { $in: [...new Set(recordingRows.map((row) => row.provider_account_id))] },
            "recordings.provider_recording_id": { $in: recordingRows.map((row) => row.provider_recording_id) },
          },
          { projection: { contact_number_id: 1, provider_account_id: 1, "recordings.provider_recording_id": 1 } },
        )
        .toArray()) {
        for (const recording of (interaction.recordings ?? []) as Array<{ provider_recording_id: string }>) {
          byRecording.set(
            `${interaction.provider_account_id}:${recording.provider_recording_id}`,
            interaction.contact_number_id as mongoose.Types.ObjectId,
          );
        }
      }
    }

    const writes: Array<{ _id: mongoose.Types.ObjectId; contact_number_id: mongoose.Types.ObjectId }> = [];
    for (const row of rows) {
      const resolved = row.call_interaction_id
        ? byId.get(String(row.call_interaction_id))
        : byRecording.get(`${row.provider_account_id}:${row.provider_recording_id}`);
      if (!resolved) {
        report.unresolved += 1;
        continue;
      }
      report.resolvable += 1;
      writes.push({ _id: row._id as mongoose.Types.ObjectId, contact_number_id: resolved });
    }
    if (mode === "apply" && writes.length) {
      const result = await conversations.bulkWrite(
        writes.map((write) => ({
          updateOne: {
            filter: {
              _id: write._id,
              $or: [{ contact_number_id: null }, { contact_number_id: { $exists: false } }],
            },
            update: { $set: { contact_number_id: write.contact_number_id } },
          },
        })),
        { ordered: false },
      );
      report.written += result.modifiedCount ?? 0;
    }
    if (rows.length < batch) break;
  }
  return report;
}
