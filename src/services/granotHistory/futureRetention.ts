import mongoose from "mongoose";
import type { DeskLeadRef } from "../salesOutreach/subjects/leadFacts";
import { canPromoteFuture, type ShadowDay } from "./shadowWeek";
import { inspectPoolCandidates } from "../salesOutreach/pool/admission";
import { type ClientSession, type Db, type ObjectId } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import {
  archivalChain,
  matchesClosedReplay,
  routineAutomationChain,
} from "./retentionEligibility";
import {
  automationRunId,
  readClosedRun,
  type ClosedOperation,
} from "./closedAutomationRun";
import { publishClosedRun } from "./prepareClosedRun";
import { appendHistoryMonth } from "./monthArchive";
import type { ArchivedChain } from "./archiveCodec";
import { referencedChains } from "./retentionReferences";
import { supersededObservations } from "./supersededObservations";

export type RetentionPolicy = {
  _id: string;
  mode: "shadow" | "future";
  new_data_from: Date;
  armed_at?: Date;
  lease_until?: Date;
  owner?: string;
};
export const policies = (db: Db) =>
  db.collection<RetentionPolicy>("granot_retention_control");
const day = 86400000;
async function readChains(db: Db, ids: ObjectId[], session?: ClientSession) {
  const options = { session, maxTimeMS: 3000 };
  const receipts = await db
    .collection("granot_webhook_receipts")
    .find({ _id: { $in: ids } }, options)
    .toArray();
  const observations = await db
    .collection("granot_observations")
    .find({ receipt_id: { $in: ids } }, options)
    .toArray();
  const decisions = await db
    .collection("synchronization_decisions")
    .find({ observation_id: { $in: observations.map((o) => o._id) } }, options)
    .toArray();
  const byId = new Map(receipts.map((r) => [String(r._id), r]));
  return observations.flatMap((o) => {
    const r = byId.get(String(o.receipt_id));
    return r
      ? [
          archivalChain({
            observation: o,
            receipt: r,
            decisions: decisions.filter(
              (d) => String(d.observation_id) === String(o._id),
            ),
          }),
        ]
      : [];
  });
}

async function comparePoolEvidence(
  db: Db,
  ref: DeskLeadRef,
  session: ClientSession,
) {
  if (mongoose.connection.db !== db)
    throw new Error("Granot shadow comparison requires the same database");
  const result = (items: Awaited<ReturnType<typeof inspectPoolCandidates>>) =>
    items.map((c) => ({
      eligible: c.eligible,
      reason: c.reason,
      anchor: c.anchor,
    }));
  const current = await inspectPoolCandidates([ref], session, "current");
  const legacy = await inspectPoolCandidates([ref], session, "history");
  return isDeepStrictEqual(result(current), result(legacy));
}

export async function runFutureRetention(
  db: Db,
  now = new Date(),
  compare = comparePoolEvidence,
) {
  const policy = await policies(db).findOne({ _id: "v1" });
  if (
    !policy ||
    !(policy.new_data_from instanceof Date) ||
    !["shadow", "future"].includes(policy.mode)
  )
    return { status: "not_configured" };
  const owner = crypto.randomUUID();
  const acquired = await policies(db).updateOne(
    {
      _id: "v1",
      $or: [
        { lease_until: { $exists: false } },
        { lease_until: { $lte: now } },
      ],
    },
    { $set: { owner, lease_until: new Date(+now + 10 * 60000) } },
  );
  if (!acquired.matchedCount) return { status: "busy" };
  try {
    if (
      policy.mode === "shadow" &&
      policy.armed_at instanceof Date &&
      (await canPromoteFuture(
        db,
        now,
        new Date(Math.max(+policy.armed_at, +policy.new_data_from + 7 * day)),
      ))
    ) {
      const promoted = await policies(db).updateOne(
        {
          _id: "v1",
          owner,
          mode: "shadow",
          armed_at: policy.armed_at,
          new_data_from: policy.new_data_from,
        },
        { $set: { mode: "future" } },
      );
      // Release the lease and let the next tick reread the committed mode and the same cutoff.
      return {
        status: promoted.modifiedCount ? "future_qualified" : "policy_changed",
      };
    }
    const source = db.collection("granot_webhook_receipts");
    const lower = policy.new_data_from,
      cutoff = new Date(+now - 7 * day);
    // The ingestion timestamp AND capture time fence historic documents out of automatic expiration.
    const due = await source
      .find(
        {
          "processing.retention_review_at": { $lte: now },
          createdAt: { $gte: lower },
          captured_at: { $gte: lower },
        },
        { projection: { _id: 1 }, maxTimeMS: 3000 },
      )
      .hint("granot_retention_review_v1")
      .sort({ "processing.retention_review_at": 1 })
      .limit(64)
      .toArray();
    if (!due.length) return { status: "idle" };
    const ids = due.map((x) => x._id);
    // Defer the claimed page before network I/O. A failed archive must not starve later pages.
    const retryAt = new Date(+now + 30 * 60000);
    await source.updateMany(
      { _id: { $in: ids }, "processing.retention_review_at": { $lte: now } },
      { $set: { "processing.retention_review_at": retryAt } },
    );
    const all = await readChains(db, ids);
    const routine = all.filter((c) => routineAutomationChain(c, cutoff));
    const held = await referencedChains(db, routine);
    const superseded = await supersededObservations(db, routine);
    const replays = new Map<string, ClosedOperation[] | null>();
    const groups = new Map<string, ArchivedChain[]>();
    for (const c of routine) {
      const id = String(c.observation._id),
        run = automationRunId(c.receipt.channel_operation_id);
      if (!run || held.has(id) || !superseded.has(id)) continue;
      if (!replays.has(run)) {
        const result = await publishClosedRun(db, run, cutoff);
        replays.set(
          run,
          ["closed", "previously_closed"].includes(result)
            ? await readClosedRun(db, run)
            : null,
        );
      }
      if (
        !matchesClosedReplay(
          c,
          replays
            .get(run)
            ?.find((r) => r.operation === c.receipt.channel_operation_id),
        )
      )
        continue;
      const key = JSON.stringify([
        c.observation.identity.normalized_job_no,
        c.observation.captured_at.toISOString().slice(0, 7),
      ]);
      const bucket = groups.get(key) ?? [];
      bucket.push(c);
      groups.set(key, bucket);
    }
    const verified = new Map<string, ArchivedChain>();
    for (const [key, group] of groups) {
      const [job, month] = JSON.parse(key);
      await appendHistoryMonth(db, job, month, group);
      for (const c of group) verified.set(String(c.observation._id), c);
    }
    const session = db.client.startSession();
    try {
      const count = await session.withTransaction(async () => {
        const active = await policies(db).findOne(
          { _id: "v1", owner, mode: policy.mode, new_data_from: lower },
          { session },
        );
        if (!active || !active.lease_until || +active.lease_until <= Date.now())
          throw new Error("Retention lease changed");
        let stamped = 0,
          qualified = 0,
          comparisons = 0;
        const fresh = await readChains(db, ids, session);
        const eligible = fresh.filter((c) =>
          isDeepStrictEqual(verified.get(String(c.observation._id)), c),
        );
        const holds = await referencedChains(db, eligible, session),
          advanced = await supersededObservations(db, eligible, session);
        for (const c of eligible) {
          const id = String(c.observation._id);
          if (
            holds.has(id) ||
            !advanced.has(id) ||
            c.receipt.createdAt < lower ||
            c.receipt.captured_at < lower
          )
            continue;
          qualified++;
          if (policy.mode === "shadow") continue;
          const set = { $set: { retention_purge_at: now } };
          await source.updateOne(
            { _id: c.receipt._id },
            { ...set, $unset: { "processing.retention_review_at": 1 } },
            { session },
          );
          await db
            .collection("granot_observations")
            .updateOne({ _id: c.observation._id }, set, { session });
          await db
            .collection("synchronization_decisions")
            .updateOne({ _id: c.decisions[0]._id }, set, { session });
          stamped++;
        }
        let poolCursor: ObjectId | undefined;
        if (policy.mode === "shadow" && qualified) {
          const daily = await db
            .collection<{
              _id: string;
              last_pool_cursor?: ObjectId;
            }>("granot_retention_days")
            .findOne(
              { _id: now.toISOString().slice(0, 10) },
              { session, projection: { last_pool_cursor: 1 } },
            );
          const work = db.collection("sales_outreach_pool_work");
          const opts = {
            session,
            sort: { _id: 1 as const },
            projection: { lead_model: 1, lead_id: 1 },
          };
          const sample =
            (daily?.last_pool_cursor
              ? await work.findOne(
                  { active: true, _id: { $gt: daily.last_pool_cursor } },
                  opts,
                )
              : null) ?? (await work.findOne({ active: true }, opts));
          if (
            sample &&
            (sample.lead_model === "FormLead" ||
              sample.lead_model === "CallLead")
          ) {
            poolCursor = sample._id;
            const lead = await db
              .collection(
                sample.lead_model === "FormLead" ? "form_leads" : "call_leads",
              )
              .findOne(
                {
                  _id: sample.lead_id,
                  "last_accepted_granot_observation.evidence.version": 2,
                },
                { session, projection: { _id: 1 } },
              );
            if (lead) {
              if (
                !(await compare(
                  db,
                  { model: sample.lead_model, id: String(sample.lead_id) },
                  session,
                ))
              )
                throw new Error("Granot shadow Pool mismatch");
              comparisons++;
            }
          }
        }
        await source.updateMany(
          {
            _id: { $in: ids },
            "processing.retention_review_at": retryAt,
          },
          { $set: { "processing.retention_review_at": new Date(+now + day) } },
          { session },
        );
        await db.collection<{ _id: string }>("granot_retention_days").updateOne(
          { _id: now.toISOString().slice(0, 10) },
          {
            $inc: {
              reviewed: ids.length,
              qualified,
              read_comparisons: comparisons,
              archived_reviews: verified.size,
              ttl_stamped: stamped,
            },
            $set: {
              last_review_at: now,
              mode: policy.mode,
              ...(poolCursor ? { last_pool_cursor: poolCursor } : {}),
            },
          },
          { session, upsert: true },
        );
        return stamped;
      });
      return {
        status: policy.mode,
        examined: ids.length,
        archived: verified.size,
        stamped: count,
      };
    } finally {
      await session.endSession();
    }
  } catch (error) {
    await db.collection<ShadowDay>("granot_retention_days").updateOne(
      { _id: now.toISOString().slice(0, 10) },
      {
        $inc: {
          failures: 1,
          mismatches:
            error instanceof Error &&
            error.message === "Granot shadow Pool mismatch"
              ? 1
              : 0,
        },
        $set: { mode: policy.mode },
      },
      { upsert: true },
    );
    throw error;
  } finally {
    await policies(db).updateOne(
      { _id: "v1", owner },
      { $unset: { owner: 1, lease_until: 1 } },
    );
  }
}
