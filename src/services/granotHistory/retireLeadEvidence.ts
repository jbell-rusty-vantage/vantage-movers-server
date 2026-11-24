import {
  BSON,
  type ClientSession,
  type Db,
  type Document,
  type ObjectId,
} from "mongodb";
import { isDeepStrictEqual } from "node:util";
import { archiveJobKey, digest, type ArchivedChain } from "./archiveCodec";
import { archiveCatalog } from "./archiveReads";
import { readArchiveObject, storeArchiveObject, type ArchiveRead } from "./archiveObjects";
import { readRetiredReceipt, RETIRED_CHANNELS, RETIRED_RECEIPT_FORMATS } from "./retiredRecords";
import { evidenceFormat, packEvidence, unpackEvidence } from "./evidencePage";
import { referencedChains } from "./retentionReferences";
import { supersededObservations } from "./supersededObservations";
import { provenWinners } from "./provenWinners";
import { currentReceiptReplay } from "../granotLifecycle/receiptReplay";

type Work = { chain: ArchivedChain; cold: boolean; header: Document };
const boundary = (db: Db) =>
  db.collection<{
    _id: string;
    cursor?: ObjectId;
    owner?: string;
    lease_until?: Date;
  }>("granot_retention_control");
const key = "lead-evidence-v1";
const pageSize = 192;
const byId = (rows: Document[]) => new Map(rows.map((r) => [String(r._id), r]));

function eligible(c: ArchivedChain, cold: boolean) {
  const { observation: o, receipt: r, decisions } = c;
  if (
    o.kind !== "lead_snapshot" ||
    !o.identity?.normalized_job_no ||
    o.priority?.valid !== true ||
    String(o.priority.canonical) === "5" ||
    o.booking_action?.normalized ||
    decisions.length > 1 ||
    r.processing?.state !== "completed" ||
    !(r.processing.completed_at instanceof Date) ||
    !r.processing.latest_decision_id ||
    String(o.receipt_id) !== String(r._id)
  )
    return false;
  const d = decisions[0];
  if (
    d &&
    (d.execution_mode !== "live" ||
      String(d._id) !== String(r.processing.latest_decision_id) ||
      String(d.observation_id) !== String(o._id))
  )
    return false;
  // A retired receipt (any channel) no longer needs its Observation and Decision in MongoDB.
  if (cold)
    return (
      !!d &&
      ((r.observation_channel === "granot_webhook" &&
        ["lead_created", "priority_updated"].includes(r.route_event_class)) ||
        ((RETIRED_CHANNELS as readonly string[]).includes(r.observation_channel) &&
          r.channel_operation_kind === "lead_snapshot_apply")) &&
      ["created", "applied", "linked", "already_current", "stale"].includes(
        d.outcome,
      ) &&
      d.target &&
      ["FormLead", "CallLead"].includes(d.target.model)
    );
  if (
    r.observation_channel !== "granot_http_automation" ||
    r.channel_operation_kind !== "lead_snapshot_apply" ||
    !r.channel_operation_id ||
    !r.payload_sha256
  )
    return false;
  const replay = currentReceiptReplay(
    r.processing.replay_result,
    r.processing.latest_decision_id,
  );
  if (
    !replay ||
    replay.observation_id !== String(o._id) ||
    !replay.target ||
    !["FormLead", "CallLead"].includes(replay.target.model) ||
    !["already_current", "stale"].includes(replay.outcome) ||
    replay.effects?.length !== 0
  )
    return false;
  return (
    !d ||
    (d.outcome === replay.outcome &&
      d.effects?.length === 0 &&
      isDeepStrictEqual(d.target, replay.target))
  );
}

async function loadPage(
  db: Db,
  observations: Document[],
  previous?: Map<string, Work>,
  session?: ClientSession,
  read: ArchiveRead = readArchiveObject,
) {
  const opts = { session, maxTimeMS: 5000 };
  const ids = observations.map((o) => o.receipt_id);
  const receipts = byId(
    await db
      .collection("granot_webhook_receipts")
      .find({ _id: { $in: ids } }, opts)
      .toArray(),
  );
  const missing = ids.filter((id) => !receipts.has(String(id)));
  const headers = byId(
    missing.length
      ? await db
          .collection("granot_archived_receipts")
          .find({ _id: { $in: missing }, format: { $in: [...RETIRED_RECEIPT_FORMATS] } }, opts)
          .toArray()
      : [],
  );
  const decisions = await db
    .collection("synchronization_decisions")
    .find({ observation_id: { $in: observations.map((o) => o._id) } }, opts)
    .toArray();
  const grouped = new Map<string, Document[]>();
  for (const d of decisions) {
    const k = String(d.observation_id);
    const list = grouped.get(k) ?? [];
    list.push(d);
    grouped.set(k, list);
  }
  const rows: Work[] = [];
  for (const o of observations) {
    const id = String(o.receipt_id),
      header = receipts.get(id) ?? headers.get(id);
    if (!header || header.evidence_archive) continue;
    const cold = !receipts.has(id);
    let receipt = header;
    if (cold) {
      const old = previous?.get(String(o._id));
      if (previous && (!old || !isDeepStrictEqual(old.header, header)))
        continue;
      const original =
        old?.chain.receipt ?? (await readRetiredReceipt(db, o.receipt_id, { read }));
      if (!original) continue;
      receipt = original;
    }
    const chain = {
      observation: o,
      receipt,
      decisions: grouped.get(String(o._id)) ?? [],
    };
    if (eligible(chain, cold)) rows.push({ chain, cold, header });
  }
  return rows;
}

/**
 * Unreferenced and superseded, or a proven winner (`provenWinners.ts`, Owner switch): the one case that
 * relaxes both the reference hold and the "a surviving Decision needs a later winner" rule.
 * `provenRelease` overrides the switch for read-only review only.
 */
async function releasable(db: Db, rows: Work[], session?: ClientSession, provenRelease?: boolean) {
  const chains = rows.map((r) => r.chain);
  const held = await referencedChains(db, chains, session);
  const advanced = await supersededObservations(
    db,
    chains.filter((c) => c.decisions.length),
    session,
  );
  const proven = await provenWinners(db, chains, new Date(), session, provenRelease);
  return rows.filter(
    ({ chain: c }) =>
      proven.has(String(c.observation._id)) ||
      (!held.has(String(c.observation._id)) &&
        (!c.decisions.length || advanced.has(String(c.observation._id)))),
  );
}

export async function selectLeadEvidence(db: Db, page: Document[], read: ArchiveRead = readArchiveObject) {
  return releasable(db, await loadPage(db, page, undefined, undefined, read));
}

/** Read-only: the eligible chains of one page and what the pass releases with the proven-winner switch off and on. */
export async function reviewLeadEvidence(db: Db, page: Document[], read: ArchiveRead = readArchiveObject) {
  const rows = await loadPage(db, page, undefined, undefined, read);
  return {
    eligible: rows,
    today: await releasable(db, rows, undefined, false),
    proven: await releasable(db, rows, undefined, true),
  };
}

export async function retireLeadEvidence(db: Db, store = storeArchiveObject, read: ArchiveRead = readArchiveObject) {
  const control = boundary(db),
    now = new Date(),
    owner = crypto.randomUUID();
  await control.updateOne(
    { _id: key },
    { $setOnInsert: { _id: key } },
    { upsert: true },
  );
  const state = await control.findOneAndUpdate(
    {
      _id: key,
      $or: [
        { lease_until: { $lte: now } },
        { lease_until: { $exists: false } },
      ],
    },
    { $set: { owner, lease_until: new Date(+now + 5 * 60000) } },
    { returnDocument: "after" },
  );
  if (!state)
    return { status: "busy", examined: 0, observations: 0, decisions: 0 };
  try {
    const observations = db.collection("granot_observations");
    const page = await observations
      .find(state.cursor ? { _id: { $gt: state.cursor } } : {})
      .sort({ _id: 1 })
      .limit(pageSize)
      .maxTimeMS(5000)
      .toArray();
    const selected = await selectLeadEvidence(db, page, read);
    // Bound the GCS object size independently of the Mongo page. Continue at the last row actually considered.
    let stop = page.at(-1)?._id,
      size = 0;
    const batch: Work[] = [];
    for (const row of selected) {
      const bytes = BSON.calculateObjectSize(row.chain) + 32;
      if (bytes > 7 * 1024 * 1024) continue;
      if (size + bytes > 7 * 1024 * 1024) {
        stop = batch.at(-1)!.chain.observation._id;
        break;
      }
      size += bytes;
      batch.push(row);
    }
    const originals = new Map(
      batch.map((r) => [String(r.chain.observation._id), r]),
    );
    const object = batch.length
      ? await store(db.databaseName, packEvidence(batch.map((r) => r.chain)))
      : null;
    if (
      object &&
      (!object.generation ||
        !Buffer.from(
          BSON.serialize({
            rows: unpackEvidence(object.persisted, object.hash),
          }),
        ).equals(BSON.serialize({ rows: batch.map((r) => r.chain) })))
    )
      throw new Error("Lead evidence archive restore mismatch");
    const session = db.client.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const progress = {
            status: "processed",
            examined: page.length,
            observations: 0,
            decisions: 0,
          };
          if (object) {
            const fresh = await observations
              .find(
                { _id: { $in: batch.map((r) => r.chain.observation._id) } },
                { session },
              )
              .toArray();
            const same = (await loadPage(db, fresh, originals, session)).filter(
              (r) =>
                isDeepStrictEqual(
                  r,
                  originals.get(String(r.chain.observation._id)),
                ),
            );
            const groups = new Map<string, ArchivedChain[]>();
            const moved = await releasable(db, same, session);
            for (const { chain } of moved) {
              const job = chain.observation.identity.normalized_job_no;
              const list = groups.get(job) ?? [];
              list.push(chain);
              groups.set(job, list);
            }
            const committed = Array.from(groups.values()).flat();
            if (committed.length) {
              for (const cold of [true, false]) {
                const sources = moved.filter((row) => row.cold === cold);
                if (!sources.length) continue;
                const result = await db
                  .collection(
                    cold
                      ? "granot_archived_receipts"
                      : "granot_webhook_receipts",
                  )
                  .bulkWrite(
                    sources.map(({ chain }) => {
                      const replay = currentReceiptReplay(
                        chain.receipt.processing.replay_result,
                        chain.receipt.processing.latest_decision_id,
                      );
                      const d = chain.decisions[0];
                      const locator = {
                        format: evidenceFormat,
                        hash: object.hash,
                        generation: object.generation,
                        job: chain.observation.identity.normalized_job_no,
                        ...(d && replay && !cold
                          ? {
                              decided_at: d.decided_at,
                              replay_hash: digest(BSON.serialize(replay)),
                            }
                          : {}),
                      };
                      return {
                        updateOne: {
                          filter: {
                            _id: chain.receipt._id,
                            evidence_archive: { $exists: false },
                          },
                          update: { $set: { evidence_archive: locator } },
                        },
                      };
                    }),
                    { session },
                  );
                if (result.modifiedCount !== sources.length)
                  throw new Error("Lead evidence receipt changed");
              }
              const removed = await observations.deleteMany(
                { _id: { $in: committed.map((c) => c.observation._id) } },
                { session },
              );
              const ids = committed.flatMap((c) =>
                c.decisions.map((d) => d._id),
              );
              const deleted = ids.length
                ? await db
                    .collection("synchronization_decisions")
                    .deleteMany({ _id: { $in: ids } }, { session })
                : { deletedCount: 0 };
              if (
                removed.deletedCount !== committed.length ||
                deleted.deletedCount !== ids.length
              )
                throw new Error("Lead evidence changed during retirement");
              progress.observations = removed.deletedCount;
              progress.decisions = deleted.deletedCount;
              await archiveCatalog(db).insertMany(
                Array.from(groups, ([job, rows]) => {
                  const dates = rows.map((c) => +c.observation.captured_at);
                  return {
                    _id: object.hash + ":" + digest(Buffer.from(job)),
                    format: evidenceFormat,
                    job,
                    job_key: archiveJobKey(job),
                    hash: object.hash,
                    generation: object.generation,
                    count: rows.length,
                    oldest: new Date(Math.min(...dates)),
                    newest: new Date(Math.max(...dates)),
                    evidence_ids: rows.flatMap((c) => [
                      c.observation._id,
                      ...c.decisions.map((d) => d._id),
                    ]),
                  };
                }),
                { session },
              );
            }
          }
          const end =
            page.length < pageSize && String(stop) === String(page.at(-1)?._id);
          const change = await control.updateOne(
            { _id: key, owner },
            end ? { $unset: { cursor: 1 } } : { $set: { cursor: stop } },
            { session },
          );
          if (!change.matchedCount)
            throw new Error("Lead evidence scan lease changed");
          return { ...progress, wrapped: end };
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
  } finally {
    await control.updateOne(
      { _id: key, owner },
      { $unset: { owner: 1, lease_until: 1 } },
    );
  }
}
