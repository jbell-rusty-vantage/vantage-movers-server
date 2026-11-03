/** Backfill only current Lead winners. Each transaction rechecks the receipt and Lead. */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getCallLeadModel } from "../src/models/CallLead";
import { getFormLeadModel } from "../src/models/FormLead";
import { getGranotObservationModel } from "../src/models/GranotObservation";
import { getGranotObservationReceiptModel } from "../src/models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../src/models/SynchronizationDecision";
import { acceptedEvidence } from "../src/services/granotLifecycle/acceptedLeadEvidence";

async function main() {
  const args = process.argv.slice(2);
  const [mode, kind, after = "", limitText = "100"] = args;
  const limit = Number(limitText);
  if (
    !["--review", "--apply"].includes(mode) ||
    !["FormLead", "CallLead"].includes(kind) ||
    args.length > 4 ||
    (after && !/^[0-9a-f]{24}$/i.test(after)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    throw new Error(
      "Usage: --review|--apply FormLead|CallLead [afterObjectId] [limit 1..500]",
    );
  }
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  if (mongoose.connection.name !== getMongoDatabaseName())
    throw new Error("Unexpected database");
  const leads =
    kind === "FormLead"
      ? getFormLeadModel().collection
      : getCallLeadModel().collection;
  const filter = after
    ? { _id: { $gt: new mongoose.Types.ObjectId(after) } }
    : {};
  const { rows, counts } = await withTransaction(async (session) => {
    const rows = await leads
      .find(filter, {
        session,
        projection: { last_accepted_granot_observation: 1 },
      })
      .sort({ _id: 1 })
      .limit(limit)
      .maxTimeMS(3000)
      .toArray();
    const ids = rows.flatMap((l) =>
      l.last_accepted_granot_observation?.observation_id
        ? [l.last_accepted_granot_observation.observation_id]
        : [],
    );
    const observations = await getGranotObservationModel()
      .find({ _id: { $in: ids } })
      .select(
        "receipt_id captured_at identity.normalized_job_no priority.valid priority.canonical normalization_result",
      )
      .session(session)
      .lean();
    const receipts = await getGranotObservationReceiptModel()
      .collection.find(
        { _id: { $in: observations.map((o) => o.receipt_id) } },
        {
          session,
          projection: {
            "processing.state": 1,
            "processing.latest_decision_id": 1,
            "processing.certified_lead": 1,
          },
        },
      )
      .toArray();
    const decisions = await getSynchronizationDecisionModel()
      .find({ observation_id: { $in: ids } })
      .select(
        "observation_id attempt execution_mode source_scope outcome target",
      )
      .session(session)
      .lean();
    const obsById = new Map(observations.map((o) => [String(o._id), o]));
    const receiptById = new Map(receipts.map((r) => [String(r._id), r]));
    const latest = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) {
      const id = String(d.observation_id);
      if ((latest.get(id)?.attempt ?? -1) < d.attempt) latest.set(id, d);
    }
    const counts: Record<string, number> = {};
    const leadWrites = [],
      receiptWrites = [];
    for (const lead of rows) {
      const winner = lead.last_accepted_granot_observation,
        id = String(winner?.observation_id);
      const o = obsById.get(id),
        r = o ? receiptById.get(String(o.receipt_id)) : null,
        d = latest.get(id);
      let state;
      if (!winner?.observation_id) state = "no_winner";
      else if (!o || +o.captured_at !== +winner.captured_at)
        state = "observation_unavailable";
      else if (r?.processing?.state !== "completed")
        state = "incomplete_receipt";
      else if (
        !d?.source_scope ||
        d.execution_mode !== "live" ||
        String(d._id) !== String(r.processing.latest_decision_id) ||
        d.target?.model !== kind ||
        d.target.id !== String(lead._id) ||
        !["created", "applied", "linked", "already_current"].includes(d.outcome)
      )
        state = "no_accepted_decision";
      else if (
        winner.evidence?.version === 2 &&
        String(winner.evidence.decision_id) === String(d._id) &&
        String(r.processing.certified_lead?.decision_id) === String(d._id) &&
        String(r.processing.certified_lead?.id) === String(lead._id) &&
        r.processing.certified_lead?.model === kind
      )
        state = "already_certified";
      else if (mode === "--review") state = "certifiable_at_read";
      else {
        leadWrites.push({
          updateOne: {
            filter: {
              _id: lead._id,
              "last_accepted_granot_observation.observation_id": o._id,
              "last_accepted_granot_observation.captured_at": o.captured_at,
            },
            update: {
              $set: {
                "last_accepted_granot_observation.evidence": acceptedEvidence(
                  r._id,
                  o,
                  d,
                ),
              },
            },
          },
        });
        receiptWrites.push({
          updateOne: {
            filter: {
              _id: r._id,
              "processing.state": "completed",
              "processing.latest_decision_id": d._id,
            },
            update: {
              $set: {
                "processing.certified_lead": {
                  model: kind,
                  id: lead._id,
                  decision_id: d._id,
                },
              },
            },
          },
        });
        state = "certified";
      }
      counts[state] = (counts[state] ?? 0) + 1;
    }
    if (leadWrites.length) {
      const a = await leads.bulkWrite(leadWrites, { session });
      const b = await getGranotObservationReceiptModel().collection.bulkWrite(
        receiptWrites,
        { session },
      );
      if (
        a.matchedCount !== leadWrites.length ||
        b.matchedCount !== receiptWrites.length
      )
        throw new Error("Certification changed during backfill");
    }
    return { rows, counts };
  });
  console.log(
    JSON.stringify({
      mode,
      kind,
      database: getMongoDatabaseName(),
      scanned: rows.length,
      counts,
      next: rows.length === limit ? String(rows.at(-1)!._id) : null,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error.name, error.code ?? "backfill_failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
