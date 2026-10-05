import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { csiRepProposeSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, duplicateKey, executeCsiCommand, type CsiTransactionContext } from "../transactions";
import { loadRepDirectory, lockRepExtension, proposeRepCandidates } from "./propose";
import { toRepLinkDto } from "./reads";

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
