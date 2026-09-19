import type { ClientSession, Types } from "mongoose";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { assertTrustedActor, CsiError, type CsiActor, type RunClaims } from "../auth";

export type RunAuthorization = { actor: CsiActor; claims: RunClaims };
/** Revalidated in the transaction, then fenced again after evidence/intake writes. */
export async function loadAuthorizedRun(auth: RunAuthorization, session?: ClientSession) {
  assertTrustedActor(auth.actor, "intelligence");
  const claims = auth.claims;
  if (auth.actor.run_id !== claims.run_id || claims.exp <= Date.now() / 1000)
    throw new CsiError("RUN_SCOPE_DENIED");
  const run = await getIntelligenceRunModel().findOne({ _id: claims.run_id, ...csiDataset(),
    subject_key: claims.subject_key, token_nonce: claims.nonce, status: { $in: ["running", "submitted"] } }).session(session ?? null).lean();
  if (!run || claims.deployment !== run.deployment || claims.database !== run.database ||
      claims.tools.some(tool => !run.permitted_tools.includes(tool))) throw new CsiError("RUN_SCOPE_DENIED");
  const job = await getSalesIntelligenceJobModel().findOne({ _id: run.job_id, ...csiDataset(),
    subject_key: run.subject_key, status: "leased", lease_epoch: claims.lease_epoch, leased_until: { $gt: new Date() } }).session(session ?? null).lean();
  if (!job) throw new CsiError("RUN_SCOPE_DENIED");
  return run;
}
export async function fenceAuthorizedLease(auth: RunAuthorization, jobId: Types.ObjectId, session: ClientSession) {
  if (auth.claims.exp <= Date.now() / 1000) throw new CsiError("RUN_SCOPE_DENIED");
  const updated = await getSalesIntelligenceJobModel().updateOne({ _id: jobId, ...csiDataset(),
    subject_key: auth.claims.subject_key, status: "leased", lease_epoch: auth.claims.lease_epoch,
    leased_until: { $gt: new Date() } }, { $inc: { evidence_fence: 1 } }, { session });
  if (updated.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
}
