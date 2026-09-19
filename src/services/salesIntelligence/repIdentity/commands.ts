import mongoose from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { csiRepCommandSchema, csiRepCreateSchema, csiRepProposeSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, duplicateKey, executeCsiCommand, type CsiTransactionContext } from "../transactions";
import { assertNoRepOverlap, loadRepDirectory, lockRepExtension, proposeRepCandidates } from "./propose";
import { toRepLinkDto } from "./reads";
import { scheduleRepIdentityReevaluation } from "./scheduling";

type CommandInput = { actor: CsiActor; idempotency_key: string; body: unknown };
function enabled() { if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED"); }
const Model = getRepIdentityLinkModel;
async function audit(row: Parameters<typeof toRepLinkDto>[0], prior: ReturnType<typeof toRepLinkDto> | null, context: CsiTransactionContext, event: string) {
  await appendCsiAudit(context, { kind: "rep", subject_key: `rep:${row._id}`, target_id: String(row._id), revision: row.revision,
    event_kind: event, prior: prior ?? {}, current: toRepLinkDto(row) });
}
async function execute(input: CommandInput, command: string, payload: unknown, operation: Parameters<typeof executeCsiCommand>[0]["operation"]) {
  enabled();
  try { return await executeCsiCommand({ actor: input.actor, idempotency_key: input.idempotency_key, command, payload,
    operation: async context => { enabled(); return operation(context); } }); }
  catch (error) { if (duplicateKey(error)) throw new CsiError("IDENTITY_BLOCKED"); throw error; }
}
/** Explicitly authored is still proposed. Only review establishes authority. */
export async function createRepLink(input: CommandInput) {
  const body = csiRepCreateSchema.parse(input.body);
  return execute(input, "create_rep", body, async context => {
    if (body.expected_revision !== 1) throw new CsiError("REVISION_CONFLICT");
    const { link } = body;
    await lockRepExtension(link.rc_account_id, link.rc_extension_id, context.session);
    const directory = await loadRepDirectory(link.rc_account_id, context.session);
    const extension = directory.snapshot?.extensions.find(e => e.id === link.rc_extension_id);
    const agent = directory.agents.find(a => String(a._id) === link.agent_id);
    if (!extension || extension.type !== "User" || !agent || directory.evidence.status !== "stored") throw new CsiError("IDENTITY_BLOCKED");
    await assertNoRepOverlap(link.rc_account_id, link.rc_extension_id, new Date(link.effective_from), link.effective_to ? new Date(link.effective_to) : null, context.session);
    const row = new (Model())({ ...link, agent_name_snapshot: agent.name, rc_extension_number: extension.extension_number,
      rc_extension_name_snapshot: extension.name, rc_direct_numbers: extension.direct_numbers, proposal_basis: "owner", status: "proposed",
      granot_username: agent.granot_identity?.username ?? agent.granot_crm_username ?? null,
      history: [{ at: context.now, by: context.actor.id, change: `Owner proposed: ${body.reason}` }] });
    await row.save({ session: context.session }); await audit(row, null, context, "rep.proposed");
    return { link: toRepLinkDto(row) };
  });
}
export async function proposeRepLinks(input: CommandInput) {
  const body = csiRepProposeSchema.parse(input.body);
  return execute(input, "propose_reps", body, async context => {
    if (body.expected_revision !== 1) throw new CsiError("REVISION_CONFLICT");
    const directory = await loadRepDirectory(body.rc_account_id, context.session);
    if (directory.evidence.snapshot_id !== body.directory_snapshot_id) throw new CsiError("REVISION_CONFLICT");
    if (directory.evidence.status !== "stored") throw new CsiError("IDENTITY_BLOCKED");
    const users = directory.snapshot!.extensions.filter(e => e.type === "User" && (!body.after_extension_id || e.id > body.after_extension_id))
      .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const results = [];
    for (const extension of users.slice(0,body.limit)) {
      const proposal = proposeRepCandidates(extension, directory.agents);
      await lockRepExtension(body.rc_account_id, extension.id, context.session);
      // Any prior Owner decision or retirement remains durable; reruns never replace it.
      const prior = await Model().findOne({ rc_account_id: body.rc_account_id, rc_extension_id: extension.id }).sort({ effective_from:-1,_id:-1 }).session(context.session).lean();
      if (prior || proposal.status !== "proposed") { results.push({ ...proposal, link_id: prior ? String(prior._id) : null, preserved: Boolean(prior) }); continue; }
      const candidate = proposal.candidates[0]!;
      const row = new (Model())({ agent_id: candidate.agent_id, agent_name_snapshot: candidate.agent_name, rc_account_id: body.rc_account_id,
        rc_extension_id: extension.id, rc_extension_number: extension.extension_number, rc_extension_name_snapshot: extension.name,
        rc_direct_numbers: extension.direct_numbers, role_kind: "sales_rep", status: "proposed", proposal_basis: candidate.basis,
        effective_from: directory.snapshot!.taken_at, nudge_channels_allowed: [],
        history: [{ at: context.now, by: context.actor.id, change: `Directory proposal ${body.directory_snapshot_id}` }] });
      await row.save({ session: context.session }); await audit(row, null, context, "rep.proposed");
      results.push({ ...proposal, link_id: String(row._id), preserved: false });
    }
    return { directory: directory.evidence, results, next_cursor: users.length > body.limit ? users[body.limit - 1]!.id : null };
  });
}
/** Reviewed changes create a successor interval; only its end is changed on the previous version. */
export async function reviewRepLink(input: CommandInput & { id: string }) {
  const body = csiRepCommandSchema.parse(input.body);
  return execute(input, "review_rep", { id: input.id, ...body }, async context => {
    const { link } = body;
    await lockRepExtension(link.rc_account_id, link.rc_extension_id, context.session);
    let row = await Model().findById(input.id).session(context.session);
    if (!row) throw new CsiError("INVALID_INPUT");
    if (row.revision !== body.expected_revision) throw new CsiError("REVISION_CONFLICT");
    if (row.rc_account_id !== link.rc_account_id || row.rc_extension_id !== link.rc_extension_id || row.status === "retired") throw new CsiError("ILLEGAL_TRANSITION");
    const prior = toRepLinkDto(row), from = new Date(link.effective_from), to = link.effective_to ? new Date(link.effective_to) : null;
    const recheckFrom = new Date(Math.min(+row.effective_from, +from, +context.now));
    if (body.status === "retired") {
      if (!to || to > context.now || (row.effective_to && to > row.effective_to) || +from !== +row.effective_from || link.agent_id !== String(row.agent_id) ||
        link.role_kind !== row.role_kind || JSON.stringify(link.nudge_channels_allowed) !== JSON.stringify(row.nudge_channels_allowed)) throw new CsiError("INVALID_INPUT");
      if (row.status === "reviewed") { row.reviewed_at ??= context.now; row.reviewed_by ??= context.actor.id; }
      row.effective_to = to; row.status = "retired"; row.revision++;
      row.history.push({ at: context.now, by: context.actor.id, change: `Retired: ${body.reason}` });
    } else {
      const directory = await loadRepDirectory(link.rc_account_id, context.session);
      const extension = directory.snapshot?.extensions.find(e => e.id === link.rc_extension_id);
      const agent = directory.agents.find(a => String(a._id) === link.agent_id);
      if (!extension || extension.type !== "User" || !agent || directory.evidence.status !== "stored") throw new CsiError("IDENTITY_BLOCKED");
      if (row.status === "reviewed") {
        if (from <= row.effective_from || (row.effective_to && from > row.effective_to)) throw new CsiError("IDENTITY_BLOCKED");
        row.effective_to = from; row.status = "retired"; row.revision++;
        // Legacy reviewed rows have status authority; pin the review before preserving them as retired history.
        row.reviewed_at ??= context.now; row.reviewed_by ??= context.actor.id;
        row.history.push({ at: context.now, by: context.actor.id, change: `Superseded: ${body.reason}` });
        await row.save({ session: context.session }); await audit(row, prior, context, "rep.superseded");
        row = new (Model())({ rc_account_id: link.rc_account_id, rc_extension_id: link.rc_extension_id, proposal_basis: "owner" });
      } else row.revision++;
      await assertNoRepOverlap(link.rc_account_id, link.rc_extension_id, from, to, context.session, String(row._id));
      row.set({ ...link, agent_id: new mongoose.Types.ObjectId(link.agent_id), agent_name_snapshot: agent.name,
        rc_extension_number: extension.extension_number, rc_extension_name_snapshot: extension.name, rc_direct_numbers: extension.direct_numbers,
        granot_username: agent.granot_identity?.username ?? agent.granot_crm_username ?? null,
        status: "reviewed", reviewed_at: context.now, reviewed_by: context.actor.id });
      row.history.push({ at: context.now, by: context.actor.id, change: `Reviewed: ${body.reason}` });
    }
    const createdSuccessor = row.isNew;
    await row.save({ session: context.session }); await audit(row, createdSuccessor ? null : prior, context, "rep.reviewed_or_retired");
    const job = await scheduleRepIdentityReevaluation({ account: link.rc_account_id, extension: link.rc_extension_id,
      from: recheckFrom, through: context.now, change_id: String(context.command_id) }, context.session);
    return { link: toRepLinkDto(row), reevaluation_job_id: String(job._id) };
  });
}
