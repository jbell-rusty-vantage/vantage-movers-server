import type { ClientSession, Types } from "mongoose";
import { getGranotObservationModel, type GranotObservationDocument } from "../../models/GranotObservation";
import { OBSERVATION_KINDS } from "../../models/granotLifecycleSchemas";

export const observationReadFacts = () => getGranotObservationModel().db.collection<{
  _id: string; captured_at?: Date; complete?: boolean; cursor?: Types.ObjectId; until?: Types.ObjectId;
}>("granot_observation_read_facts");
export const caseObservations = () => getGranotObservationModel().db.collection<GranotObservationDocument>("granot_case_observations");

export const pairingFilter = {
  route_event_class: "priority_updated" as const,
  "priority.valid": true,
  "priority.canonical": "5",
};
export const invalidFilter = {
  "priority.valid": false,
  "priority.raw": { $exists: true, $ne: null },
};
const invalidKey = (job: string) => `invalid:${job}`;
type ObservationFields = Pick<GranotObservationDocument, "priority" | "route_event_class" | "identity" | "captured_at">;

export function isPairingCandidate(row: ObservationFields) {
  return Boolean(row.identity.normalized_job_no) && row.route_event_class === "priority_updated"
    && row.priority.valid && row.priority.canonical === "5";
}

export function hasInvalidPriority(row: ObservationFields) {
  return Boolean(row.identity.normalized_job_no) && row.priority.valid === false && row.priority.raw != null;
}

export async function recordObservationReadFacts(row: GranotObservationDocument, session: ClientSession, updateLatest: boolean) {
  if (updateLatest) await observationReadFacts().updateOne({ _id: "latest" }, { $max: { captured_at: row.captured_at } }, { upsert: true, session });
  if (hasInvalidPriority(row)) await observationReadFacts().updateOne({ _id: invalidKey(row.identity.normalized_job_no!) },
    { $max: { captured_at: row.captured_at } }, { upsert: true, session });
  if (isPairingCandidate(row)) await caseObservations().updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true, session });
}

async function backfillComplete(session?: ClientSession) {
  return Boolean(await observationReadFacts().findOne({ _id: "historical-v1", complete: true }, { session, projection: { _id: 1 } }));
}

export async function readLatestCapture() {
  const complete = await backfillComplete();
  const latest = await observationReadFacts().findOne({ _id: "latest" });
  if (complete) return latest?.captured_at ?? null;
  const hot = await getGranotObservationModel().findOne({ kind: { $in: [...OBSERVATION_KINDS] } }, { captured_at: 1 })
    .sort({ captured_at: -1 }).lean();
  return latest?.captured_at && (!hot || latest.captured_at > hot.captured_at) ? latest.captured_at : hot?.captured_at ?? null;
}

export async function readInvalidPriorityTimes(jobs: string[], session: ClientSession | null) {
  const complete = await backfillComplete(session ?? undefined);
  const rows = await observationReadFacts().find({ _id: { $in: jobs.map(invalidKey) } }, { session: session ?? undefined }).toArray();
  const times = new Map(rows.flatMap(row => row.captured_at ? [[row._id.slice("invalid:".length), row.captured_at] as const] : []));
  if (complete) return times;
  const legacy = await getGranotObservationModel().aggregate<{ _id: string; captured_at: Date }>([
    { $match: { "identity.normalized_job_no": { $in: jobs }, ...invalidFilter } },
    { $group: { _id: "$identity.normalized_job_no", captured_at: { $max: "$captured_at" } } },
  ]).session(session);
  for (const row of legacy) if (!times.has(row._id) || times.get(row._id)! < row.captured_at) times.set(row._id, row.captured_at);
  return times;
}

export async function readPairingObservations(jobs: string[], session?: ClientSession) {
  const filter = { "identity.normalized_job_no": { $in: jobs }, ...pairingFilter };
  const complete = await backfillComplete(session);
  const rows = await caseObservations().find(filter, { session }).toArray();
  if (complete) return rows;
  const legacy = await getGranotObservationModel().find(filter).session(session ?? null).lean();
  const byId = new Map(rows.map(row => [String(row._id), row]));
  for (const row of legacy) byId.set(String(row._id), row);
  return [...byId.values()];
}
