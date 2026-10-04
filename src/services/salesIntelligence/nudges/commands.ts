import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { getOwnerRepNudgeModel, OWNER_REP_NUDGE_INDEXES } from "../../../models/OwnerRepNudge";
import { getSalesIntelligencePolicyPointerModel } from "../../../models/SalesIntelligencePolicyPointer";
import { csiNudgeCommandSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, assertTrustedActor, type CsiActor, csiWorkerActor } from "../auth";
import { appendCsiAudit, assertIndexes, executeCsiCommand, payloadHash, type CsiTransactionContext } from "../transactions";
import { lockRepExtension } from "../repIdentity/propose";
import { enqueueCsiJob } from "../jobs";
import { ownerRead } from "../../numberActivity/coverage";
import { checkNudge, assertNudgesEnabled, type NudgeCommand } from "./eligibility";
import { createNudgeAdapter, assertDirectChat, NudgeProviderError, type NudgeAdapter, type NudgeSubmission } from "./adapters";
import { toNudgeDto, type NudgeRow } from "./reads";

export type NudgeCommandInput = { actor: CsiActor; idempotency_key: string; body: unknown };
export type NudgeDependencies = { adapter?: NudgeAdapter };
export type NudgePreviewDto = Awaited<ReturnType<typeof previewNudge>>["data"];
export type NudgeSendDto = Awaited<ReturnType<typeof sendNudge>>;
function validateInput(input: NudgeCommandInput) {
  assertTrustedActor(input.actor, "owner");
  if (!input.idempotency_key.trim() || input.idempotency_key.length > 200) throw new CsiError("INVALID_INPUT");
  return csiNudgeCommandSchema.parse(input.body);
}
/** Terminal outcome of one message for operators: a structured log, never a stored event. */
export function logNudgeOutcome(id: string, status: string, errorCode: string | null = null) {
  const entry = { msg: `sales_intelligence.nudge.${status}`, nudgeId: id, errorCode };
  if (["sent", "fallback_sent"].includes(status)) logger.info(entry);
  else logger.error(entry);
}
const directoryKey = (account: string, extension: string) => `directory:${account}:${extension}`;
function rateWindow(result: Awaited<ReturnType<typeof checkNudge>>, now: Date) {
  return { rc_account_id: result.recipient.account, rc_extension_id: result.recipient.extension, createdAt: { $gt: new Date(+now - 3_600_000) } };
}
export async function previewNudge(input: NudgeCommandInput) {
  const command = validateInput(input), now = new Date();
  const result = await checkNudge(command, now);
  if (await getOwnerRepNudgeModel().countDocuments(rateWindow(result, now)) >= result.config.hourlyLimit) throw new CsiError("RATE_LIMITED");
  return ownerRead({ body: result.body, template_key: command.nudge.template_key, template_version: command.nudge.template_version, purpose: command.nudge.purpose,
    expected_rep_revision: result.link?.revision ?? null,
    recipient: { rc_account_id: result.recipient.account, rc_extension_id: result.recipient.extension, directory_name: result.extension.name ?? null,
      agent_id: result.link ? String(result.link.agent_id) : null, agent_name: result.link?.agent_name_snapshot ?? null,
      rep_identity_link_id: result.link ? String(result.link._id) : null, channel: command.nudge.channel }, allowed_channels: result.channels,
    destination_evidence: "stored_checked" as const, provider_destination_verified: false, send_time_revalidation_required: true, authorizes_send: false });
}
/** Fence the policy pointer and the User extension, restoring values: no other aggregate is touched. */
async function fenceEligibility(result: Awaited<ReturnType<typeof checkNudge>>, session: ClientSession) {
  const pointer = await getSalesIntelligencePolicyPointerModel().findOneAndUpdate({ key: "active", version: result.policy.version }, { $inc: { revision: 1 } }, { session, returnDocument: "before", timestamps: false });
  if (!pointer) throw new CsiError("REVISION_CONFLICT");
  await getSalesIntelligencePolicyPointerModel().updateOne({ _id: pointer._id }, { $set: { revision: pointer.revision } }, { session, timestamps: false });
  await lockRepExtension(result.recipient.account, result.recipient.extension, session);
}
export async function scheduleNudgeRepair(id: string, session: ClientSession, at: Date, generation = 0) {
  return enqueueCsiJob({ stage: "nudge_repair", dedupe_key: `csi:nudge-repair:${id}:${generation}`, subject_key: `nudge:${id}`, input_revision: generation + 1, input_refs: [id] }, session, at);
}
/** Only the fresh explicit Owner invocation enters submit. Neither replay nor any worker calls this path. */
export async function sendNudge(input: NudgeCommandInput, deps: NudgeDependencies = {}) {
  const command = validateInput(input);
  assertNudgesEnabled();
  const operation = await executeCsiCommand({ actor: input.actor, idempotency_key: input.idempotency_key, command: "send_nudge", payload: command,
    operation: async context => {
      const result = await checkNudge(command, new Date(), context.session);
      await fenceEligibility(result, context.session);
      await assertIndexes(getOwnerRepNudgeModel().collection, OWNER_REP_NUDGE_INDEXES);
      // All persisted states reserve the User extension rolling hour, including failed and uncertain attempts.
      const count = await getOwnerRepNudgeModel().countDocuments(rateWindow(result, context.now)).session(context.session);
      if (count >= result.config.hourlyLimit) throw new CsiError("RATE_LIMITED");
      const row = new (getOwnerRepNudgeModel())({ idempotency_key: payloadHash([input.actor.id, input.idempotency_key]), actor: input.actor, command_id: context.command_id,
        authorized_command: command,
        rc_account_id: result.recipient.account, rc_extension_id: result.recipient.extension, rc_extension_number: result.extension.extension_number ?? null,
        rc_extension_name_snapshot: result.extension.name ?? null, rep_identity_link_id: result.link?._id ?? null, agent_id: result.link?.agent_id ?? null,
        channel: command.nudge.channel, destination: result.destination,
        recipient_person_id: result.recipient.person, sender_person_id: result.recipient.senderPerson, sender_extension_id: result.recipient.senderExtension, sender_extension_number: result.recipient.senderExtensionNumber, sender_did: result.recipient.senderDid, provider_account_id: result.recipient.account,
        template_key: command.nudge.template_key, template_version: command.nudge.template_version, purpose: command.nudge.purpose, body_as_sent: result.body,
        preconditions_snapshot: { outreach_state: "directory", overdue: false, attachment_certainty: "stored",
          rep_link_status: result.link?.status ?? "none", policy_version: result.policy.version }, status: "pending", send_expires_at: new Date(+context.now + 60_000) });
      await row.save({ session: context.session });
      await scheduleNudgeRepair(String(row._id), context.session, new Date(+context.now + 120_000));
      await appendCsiAudit(context, { subject_key: directoryKey(result.recipient.account, result.recipient.extension), event_kind: "nudge.authorized", kind: "nudge", target_id: String(row._id), revision: 1, prior: {}, current: { status: "pending" } });
      return { nudge_id: String(row._id) };
    } });
  const id = operation.response.nudge_id;
  if (!operation.replayed) await submitAuthorizedNudge(id, command, input.actor, deps.adapter ?? createNudgeAdapter());
  const row = await getOwnerRepNudgeModel().findById(id).lean().orFail();
  return { operation_id: String(row.command_id), replayed: operation.replayed, nudge: toNudgeDto(row) };
}
async function submitAuthorizedNudge(id: string, command: NudgeCommand, actor: CsiActor, adapter: NudgeAdapter) {
  let beganSubmission = false;
  try {
    const initial = await checkNudge(command, new Date());
    let channel = command.nudge.channel, destination = initial.destination, fallback = false;
    if (channel === "team_messaging") {
      try { destination = assertDirectChat(await adapter.resolveDirect(initial.recipient), initial.recipient); }
      catch (error) {
        if (!(error instanceof NudgeProviderError) || error.code !== "chat_rejected" || !error.definitive || !command.nudge.allow_pager_fallback || !initial.channels.includes("pager") || !initial.pager) throw error;
        channel = "pager"; destination = initial.pager; fallback = true;
      }
    }
    const submission = await withTransaction(async session => {
      const current = await getOwnerRepNudgeModel().findOne({ _id: id, status: "pending", submission_started_at: null, send_expires_at: { $gt: new Date() } }).session(session).lean();
      if (!current) throw new CsiError("LEASE_LOST");
      const check = await checkNudge(command, new Date(), session);
      await fenceEligibility(check, session);
      if (payloadHash(check.recipient) !== payloadHash(initial.recipient) || check.destination !== initial.destination || check.body !== current.body_as_sent ||
          (fallback && (!check.channels.includes("pager") || check.pager !== destination))) throw new CsiError("REVISION_CONFLICT");
      const changed = await getOwnerRepNudgeModel().updateOne({ _id: id, status: "pending", revision: current.revision, submission_started_at: null, send_expires_at: { $gt: new Date() } },
        { $set: { destination, channel, fallback_channel: fallback ? "pager" : null, submission_started_at: new Date() }, $inc: { revision: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
      await appendCsiAudit({ session, command_id: current.command_id!, now: new Date(), actor }, {
        subject_key: directoryKey(check.recipient.account, check.recipient.extension), event_kind: "nudge.submission_started", kind: "nudge", target_id: id, revision: current.revision + 1,
        prior: { status: "pending" }, current: { status: "pending", submission_started: true, channel, fallback } });
      return { ...check.recipient, channel, destination, body: current.body_as_sent } satisfies NudgeSubmission;
    });
    beganSubmission = true;
    const receipt = await adapter.submit(submission);
    // A separately durable receipt survives a crash before audit/status finalization.
    await getOwnerRepNudgeModel().updateOne({ _id: id, status: "pending" }, { $set: { provider_message_id: receipt.id, provider_response_status: receipt.status, provider_receipt_at: new Date() } });
    await finalizeNudge(id, fallback ? "fallback_sent" : "sent", null, actor);
  } catch (error) {
    const definitive = error instanceof NudgeProviderError && error.definitive;
    const status = beganSubmission && !definitive ? "unknown_delivery" : "failed";
    const code = error instanceof CsiError ? error.code : error instanceof NudgeProviderError ? error.code : beganSubmission ? "delivery_uncertain" : "pre_submission_failed";
    // If the provider receipt was stored, let reconciliation finish it rather than discard positive evidence.
    const row = await getOwnerRepNudgeModel().findById(id).lean();
    if (!row?.provider_message_id) await finalizeNudge(id, status, code, actor);
  }
}
/**
 * Terminal status under the row's revision fence. Rows written before this release may name an
 * Outreach record; their audit subject stays on the directory User, and nothing is read from it.
 */
export async function finishNudgeInTransaction(row: NudgeRow, status: "sent" | "failed" | "unknown_delivery" | "fallback_sent", error: string | null, context: CsiTransactionContext) {
  // CSI-01 rows predate this revision field; fence their absence and advance the DTO's virtual revision 1.
  const revision = (row.revision ?? 1) + 1;
  const change = await getOwnerRepNudgeModel().updateOne({ _id: row._id, status: "pending", revision: row.revision ?? { $exists: false } },
    { $set: { status, revision, error_code: error, sent_at: ["sent", "fallback_sent"].includes(status) ? row.provider_receipt_at ?? context.now : null } }, { session: context.session });
  if (change.modifiedCount !== 1) return false;
  await appendCsiAudit(context, { subject_key: directoryKey(row.rc_account_id, row.rc_extension_id), event_kind: ["sent", "fallback_sent"].includes(status) ? "nudge_sent" : `nudge.${status}`,
    kind: "nudge", target_id: String(row._id), revision, prior: { status: "pending" }, current: { status, error_code: error, nudge_id: String(row._id) } });
  return true;
}
export async function finalizeNudge(id: string, status: "sent" | "failed" | "unknown_delivery" | "fallback_sent", error: string | null, actor?: CsiActor) {
  const changed = await withTransaction(async session => {
    const row = await getOwnerRepNudgeModel().findById(id).session(session).lean();
    if (!row || row.status !== "pending") return false;
    return finishNudgeInTransaction(row, status, error, { session, command_id: row.command_id ?? new mongoose.Types.ObjectId(id), now: new Date(), actor: actor ?? csiWorkerActor(id) });
  });
  if (changed) logNudgeOutcome(id, status, error);
}
