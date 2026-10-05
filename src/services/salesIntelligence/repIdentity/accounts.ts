import mongoose from "mongoose";
import { csiFlag, csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { Agent } from "../../../models/Agent";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import {
  accountsDtoSchema,
  type AccountAgentCommand,
  type AccountDto,
  type AccountsDto,
} from "../../../validation/v1/allNumbers";
import { displayPhone } from "../../numberActivity/phone";
import { CsiError, type CsiActor } from "../auth";
import { resolvePolicy } from "../policy";
import { appendCsiAudit, duplicateKey, executeCsiCommand, payloadHash } from "../transactions";
import { publishOutreachLive } from "../../salesOutreach/live/publish";
import { enqueueDeskResyncForAgents } from "../../salesOutreach/subjects/agentWake";
import { proposeRepLinks } from "./commands";
import { assertNoRepOverlap, loadRepDirectory, lockRepExtension, proposeRepCandidates } from "./propose";
import { loadDirectoryAccounts, toRepLinkDto, type DirectoryUserSource } from "./reads";

/**
 * Accounts (all-numbers CONTRACT §4.5–§4.7): every RingCentral directory User and the Agent its
 * current reviewed Rep Identity Link connects it to. The Owner connects, changes or disconnects an
 * Agent in one step; the link is reviewed at once (no separate review), and a change retires the
 * current link through the existing successor rule (the old interval keeps its calls). Reads never
 * write; the commands run through the CSI command ledger with the extension's write fence.
 */
type LinkRow = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  agent_id: mongoose.Types.ObjectId;
  agent_name_snapshot: string;
  rc_account_id: string;
  rc_extension_id: string;
  rc_extension_number?: string | null;
  rc_extension_name_snapshot?: string | null;
  rc_direct_numbers?: string[];
  rc_sms_sender_number?: string | null;
  rc_team_messaging_person_id?: string | null;
  rc_direct_chat_id?: string | null;
  role_kind: AccountDto["role"] & string;
  status: "proposed" | "reviewed" | "retired";
  effective_from: Date;
  effective_to?: Date | null;
  nudge_channels_allowed?: string[];
};
type CandidateAgent = { _id: unknown; name: string; name_aliases?: string[] };

const BASIS_STRENGTH = ["exact_full_name", "alias", "first_token"] as const;

/** The strongest unique name candidate: one exact full name, else one alias, else one first token. */
export function strongestCandidate(extension: { id: string; type: string; name?: string | null }, agents: readonly CandidateAgent[]) {
  const { candidates } = proposeRepCandidates(extension, agents);
  for (const basis of BASIS_STRENGTH) {
    const level = candidates.filter((candidate) => candidate.basis === basis);
    if (level.length === 1) return { agent_id: level[0]!.agent_id, agent_name: level[0]!.agent_name };
    if (level.length > 1) return null;
  }
  return null;
}

type MessageInput = {
  extension: { id: string; type: string; status?: string | null; extension_number?: string | null } | null;
  link: Pick<LinkRow, "status" | "role_kind" | "nudge_channels_allowed" | "rc_team_messaging_person_id"> | null;
  account: string;
  nudgesOn: boolean;
  config: ReturnType<typeof csiNudgeConfiguration> | null;
};

/**
 * Mirrors `nudges/eligibility.ts` without its per-send checks: the channels the Owner's Message can
 * use for this User now (Team Messaging first), empty when it cannot reach the User.
 */
export function messageChannels(input: MessageInput): Array<"team_messaging" | "pager"> {
  const { extension, link, config } = input;
  if (!input.nudgesOn || !config || !extension || extension.type !== "User" || extension.status !== "Enabled") return [];
  if (!config.account || config.account !== input.account || !config.senderExtension || !config.senderPerson || config.senderExtension === extension.id) return [];
  const reviewedSalesRep = link?.status === "reviewed" && link.role_kind === "sales_rep" ? link : null;
  const person = reviewedSalesRep?.rc_team_messaging_person_id ?? null;
  const pager = Boolean(extension.extension_number && /^\d{1,7}$/.test(extension.extension_number) && /^\d{1,7}$/.test(config.senderExtensionNumber));
  let channels: Array<"team_messaging" | "pager"> = [];
  if (person && config.channels.team_messaging) channels.push("team_messaging");
  if (pager && config.channels.pager) channels.push("pager");
  if (reviewedSalesRep) channels = channels.filter((channel) => (reviewedSalesRep.nudge_channels_allowed ?? []).includes(channel));
  return channels;
}

/** Could the Owner's Message reach this User now? */
export const canMessage = (input: MessageInput): boolean => messageChannels(input).length > 0;

async function nudgeContext() {
  const nudgesOn = csiFlag("ENABLED") && csiFlag("NUDGE_ENABLED");
  if (!nudgesOn) return { nudgesOn, config: null };
  try {
    const policy = await resolvePolicy();
    return { nudgesOn: policy.enabled_capabilities.includes("nudges"), config: csiNudgeConfiguration() };
  } catch {
    return { nudgesOn: false, config: null };
  }
}

const accountSort = (a: AccountDto, b: AccountDto) =>
  (a.name ?? "￿").localeCompare(b.name ?? "￿", "en", { sensitivity: "base" }) || a.extension_id.localeCompare(b.extension_id);

/** §4.5. */
export async function readAccounts(): Promise<AccountsDto> {
  const directory = await loadDirectoryAccounts();
  const accountIds = directory.map((entry) => entry.rc_account_id);
  const links = (accountIds.length
    ? await getRepIdentityLinkModel().find({ rc_account_id: { $in: accountIds }, effective_to: null }).lean()
    : []) as unknown as LinkRow[];
  const agents = (await Agent.find({ active: true }).select({ name: 1, name_aliases: 1 }).lean()) as unknown as CandidateAgent[];
  const { nudgesOn, config } = await nudgeContext();
  const accounts: AccountDto[] = [];
  const seen = new Set<string>();
  for (const entry of directory) {
    const users = (entry.snapshot?.extensions ?? []).filter((extension: DirectoryUserSource) => extension.type === "User");
    for (const extension of users) {
      seen.add(`${entry.rc_account_id}:${extension.id}`);
      const current = links.find((link) => link.rc_account_id === entry.rc_account_id && link.rc_extension_id === extension.id) ?? null;
      const reviewed = current?.status === "reviewed" ? current : null;
      const proposed = current?.status === "proposed" ? current : null;
      accounts.push({
        rc_account_id: entry.rc_account_id,
        extension_id: extension.id,
        extension_number: extension.extension_number ?? null,
        name: extension.name ?? null,
        direct_numbers: (extension.direct_numbers ?? []).map((number) => displayPhone(number) ?? number),
        status: extension.status ?? null,
        in_directory: true,
        agent: reviewed ? { id: String(reviewed.agent_id), name: reviewed.agent_name_snapshot } : null,
        role: reviewed?.role_kind ?? null,
        link_id: reviewed ? String(reviewed._id) : null,
        link_revision: reviewed?.revision ?? null,
        suggestion: reviewed ? null : proposed ? { agent_id: String(proposed.agent_id), agent_name: proposed.agent_name_snapshot } : strongestCandidate(extension, agents),
        ...(() => {
          const channels = messageChannels({ extension, link: reviewed, account: entry.rc_account_id, nudgesOn, config });
          return { can_message: channels.length > 0, message_channels: channels };
        })(),
      });
    }
  }
  // A reviewed link whose extension is no longer in the directory stays visible, flagged, so it can be disconnected.
  for (const link of links) {
    if (link.status !== "reviewed" || seen.has(`${link.rc_account_id}:${link.rc_extension_id}`)) continue;
    accounts.push({
      rc_account_id: link.rc_account_id,
      extension_id: link.rc_extension_id,
      extension_number: link.rc_extension_number ?? null,
      name: link.rc_extension_name_snapshot ?? null,
      direct_numbers: (link.rc_direct_numbers ?? []).map((number) => displayPhone(number) ?? number),
      status: null,
      in_directory: false,
      agent: { id: String(link.agent_id), name: link.agent_name_snapshot },
      role: link.role_kind,
      link_id: String(link._id),
      link_revision: link.revision,
      suggestion: null,
      can_message: false,
      message_channels: [],
    });
  }
  const takenAt = directory.map((entry) => entry.evidence.taken_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return accountsDtoSchema.parse({
    directory_at: takenAt,
    accounts: accounts.sort(accountSort),
    agents: agents.map((agent) => ({ id: String(agent._id), name: agent.name })).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
  });
}

/** The RingCentral account an extension belongs to: its directory account, else its current link's. */
async function accountOf(extensionId: string): Promise<string | null> {
  const directory = await loadDirectoryAccounts();
  const inDirectory = directory.filter((entry) => entry.snapshot?.extensions.some((extension: DirectoryUserSource) => extension.id === extensionId));
  if (inDirectory.length === 1) return inDirectory[0]!.rc_account_id;
  if (inDirectory.length > 1) throw new CsiError("INVALID_INPUT", [{ path: "extension_id", code: "ambiguous_account" }]);
  const linked = await getRepIdentityLinkModel().distinct("rc_account_id", { rc_extension_id: extensionId, effective_to: null });
  if (linked.length > 1) throw new CsiError("INVALID_INPUT", [{ path: "extension_id", code: "ambiguous_account" }]);
  return linked[0] ?? null;
}

export const ACCOUNT_AGENT_COMMAND = "account_agent";
type DeskWake = { subject_ids: string[]; agent_ids: string[] };
const NO_DESK_WAKE: DeskWake = { subject_ids: [], agent_ids: [] };
const DEFAULT_NUDGE_CHANNELS = ["team_messaging", "pager"];

/**
 * §4.6 Connect, change or disconnect. Returns the refreshed Account, or null when the extension is
 * neither in the directory nor linked.
 * - Connect/change: a reviewed link effective now, for the Agent and role (`role` defaults to the
 *   current role, else `sales_rep`). A reviewed current link is retired at the same instant (its
 *   interval keeps the earlier calls); a proposal is retired unreviewed. The successor keeps the
 *   extension's contact fields: direct numbers and the SMS sender from the directory (the SMS sender
 *   falls back to the previous link's), and the previous link's Team Messaging person and chat ids and
 *   Message channels. The same Agent and role is a no-op.
 * - Disconnect (`agent_id: null`): the current link ends now.
 * `link_revision`, when given, must be the current reviewed link's revision.
 * - Desk side effect (IMPL-01): in the same transaction, every open desk subject the old or the new
 *   Agent receives or is assigned is re-synced (`salesOutreach/subjects/agentWake.ts`), so its desk
 *   assignment follows the link at once; after commit the desk live stream is told.
 */
export async function commandAccountAgent(input: { actor: CsiActor; extension_id: string; body: AccountAgentCommand; idempotency_key?: string }) {
  if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
  const extensionId = input.extension_id.trim();
  if (!extensionId || extensionId.length > 64) throw new CsiError("INVALID_INPUT", [{ path: "extension_id", code: "invalid" }]);
  const account = await accountOf(extensionId);
  if (!account) return null;
  const { scope: _scope, ...body } = input.body;
  const latest = await getRepIdentityLinkModel().findOne({ rc_account_id: account, rc_extension_id: extensionId }, { revision: 1 })
    .sort({ effective_from: -1, _id: -1 }).lean();
  const idempotency_key = input.idempotency_key
    ?? `accounts-agent:${account}:${extensionId}:${latest ? `${String(latest._id)}:${latest.revision}` : "none"}:${payloadHash(body).slice(0, 32)}`;
  let desk: DeskWake = NO_DESK_WAKE;
  try {
    const { response } = await executeCsiCommand({
      actor: input.actor,
      command: ACCOUNT_AGENT_COMMAND,
      idempotency_key,
      payload: { rc_account_id: account, rc_extension_id: extensionId, ...body },
      operation: async (context) => {
        const { session, now, actor } = context;
        const Model = getRepIdentityLinkModel();
        await lockRepExtension(account, extensionId, session);
        const current = await Model.findOne({ rc_account_id: account, rc_extension_id: extensionId, effective_to: null }).session(session);
        const reviewed = current?.status === "reviewed" ? current : null;
        if (body.link_revision !== undefined && reviewed?.revision !== body.link_revision) throw new CsiError("REVISION_CONFLICT");
        const audit = async (row: NonNullable<typeof current>, prior: ReturnType<typeof toRepLinkDto> | null, event: string) =>
          appendCsiAudit(context, { kind: "rep", subject_key: `rep:${row._id}`, target_id: String(row._id), revision: row.revision,
            event_kind: event, prior: prior ?? {}, current: toRepLinkDto(row) });
        const end = async (reason: string) => {
          if (!current) return;
          const prior = toRepLinkDto(current);
          current.effective_to = now;
          current.status = "retired";
          current.revision += 1;
          current.history.push({ at: now, by: actor.id, change: reason });
          await current.save({ session });
          await audit(current, prior, "rep.account_ended");
        };
        // The desk assigns a Lead only while its receiver has a reviewed sales_rep link: re-sync the Agents' subjects.
        const resync = async (agentIds: Array<string | null>): Promise<DeskWake> => {
          const ids = agentIds.filter((id): id is string => Boolean(id));
          return { subject_ids: await enqueueDeskResyncForAgents(ids, `account:${String(context.command_id)}`, session, now), agent_ids: ids };
        };
        if (body.agent_id === null) {
          await end("Disconnected by the Owner");
          return { action: current ? "disconnected" : "unchanged", link_id: null, desk: current ? await resync([String(current.agent_id)]) : NO_DESK_WAKE };
        }
        const role = body.role ?? reviewed?.role_kind ?? "sales_rep";
        if (reviewed && String(reviewed.agent_id) === body.agent_id && reviewed.role_kind === role) return { action: "unchanged", link_id: String(reviewed._id), desk: NO_DESK_WAKE };
        const directory = await loadRepDirectory(account, session);
        const extension = directory.snapshot?.extensions.find((e) => e.id === extensionId);
        const agent = directory.agents.find((a) => String(a._id) === body.agent_id);
        if (!extension || extension.type !== "User" || directory.evidence.status !== "stored")
          throw new CsiError("IDENTITY_BLOCKED", [{ path: "extension_id", code: "not_a_directory_user" }]);
        if (!agent) throw new CsiError("INVALID_INPUT", [{ path: "agent_id", code: "agent_not_active" }]);
        // Contact fields belong to the extension, not the Agent: carry them from the newest link of the extension.
        const carry = current ?? await Model.findOne({ rc_account_id: account, rc_extension_id: extensionId }).sort({ effective_from: -1, _id: -1 }).session(session);
        await end(reviewed ? `Changed by the Owner to ${agent.name}` : "Replaced by the Owner's connection");
        await assertNoRepOverlap(account, extensionId, now, null, session);
        const row = new Model({
          agent_id: new mongoose.Types.ObjectId(String(agent._id)), agent_name_snapshot: agent.name,
          rc_account_id: account, rc_extension_id: extensionId, rc_extension_number: extension.extension_number,
          rc_extension_name_snapshot: extension.name, rc_direct_numbers: extension.direct_numbers,
          rc_sms_sender_number: extension.sms_sender_numbers?.[0] ?? carry?.rc_sms_sender_number ?? null,
          rc_team_messaging_person_id: carry?.rc_team_messaging_person_id ?? null,
          rc_direct_chat_id: carry?.rc_direct_chat_id ?? null, nudge_channels_allowed: carry ? [...carry.nudge_channels_allowed] : DEFAULT_NUDGE_CHANNELS,
          granot_username: agent.granot_identity?.username ?? agent.granot_crm_username ?? null,
          role_kind: role, status: "reviewed", proposal_basis: "owner", effective_from: now, effective_to: null,
          reviewed_at: now, reviewed_by: actor.id,
          history: [{ at: now, by: actor.id, change: `Connected by the Owner (${role})` }],
        });
        await row.save({ session });
        await audit(row, null, "rep.account_connected");
        // Call attribution reads the effective link at each call's time; only the desk assignment needs a re-sync.
        return { action: reviewed ? "changed" : "connected", link_id: String(row._id), desk: await resync([current ? String(current.agent_id) : null, String(agent._id)]) };
      },
    });
    desk = (response as { desk?: DeskWake }).desk ?? NO_DESK_WAKE;
  } catch (error) {
    if (duplicateKey(error)) throw new CsiError("IDENTITY_BLOCKED");
    throw error;
  }
  if (desk.subject_ids.length || desk.agent_ids.length)
    await publishOutreachLive({ topic: "outreach_desk", subject_ids: desk.subject_ids, agent_ids: desk.agent_ids, cause: "command" });
  const accounts = await readAccounts();
  return accounts.accounts.find((entry) => entry.extension_id === extensionId) ?? null;
}

/** §4.7: today's `/reps/propose` over every stored directory, page by page; returns §4.5. */
export async function suggestAccountMatches(input: { actor: CsiActor; idempotency_key?: string }): Promise<AccountsDto> {
  if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
  for (const entry of await loadDirectoryAccounts()) {
    if (entry.evidence.status !== "stored" || !entry.evidence.snapshot_id) continue;
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const body = { expected_revision: 1, rc_account_id: entry.rc_account_id, directory_snapshot_id: entry.evidence.snapshot_id,
        ...(after ? { after_extension_id: after } : {}), limit: 100, reason: "Owner asked for suggested matches" };
      const key = `${input.idempotency_key ?? "accounts-suggest"}:${entry.rc_account_id}:${entry.evidence.snapshot_id}:${after ?? "start"}`;
      const { response } = await proposeRepLinks({ actor: input.actor, idempotency_key: key, body });
      const next = (response as { next_cursor?: string | null }).next_cursor ?? null;
      if (!next) break;
      after = next;
    }
  }
  return readAccounts();
}
