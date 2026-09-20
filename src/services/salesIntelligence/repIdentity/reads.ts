import { z } from "zod";
import type { InferSchemaType, Types } from "mongoose";
import { csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { getRepIdentityLinkModel, RepIdentityLinkSchema } from "../../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { csiIdSchema, csiTextSchema } from "../../../validation/v1/salesIntelligence";
import { loadRepDirectory } from "./propose";
import { getSalesIntelligenceCommandExecutionModel } from "../../../models/SalesIntelligenceCommandExecution";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { coverageDtoSchema } from "../dto";

export const repListQuerySchema = z.object({ scope: z.literal("production").optional(), rc_account_id: csiTextSchema.optional(),
  cursor: csiIdSchema.optional(), directory_cursor: csiTextSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const repLinkDtoSchema = z.object({
  id: csiIdSchema, revision: z.number().int().positive(), agent_id: csiIdSchema, agent_name: z.string(),
  rc_account_id: z.string(), rc_extension_id: z.string(), rc_extension_number: z.string().nullable(), rc_extension_name: z.string().nullable(),
  role_kind: z.enum(["sales_rep", "shared", "service", "manager", "dialer", "excluded"]), status: z.enum(["proposed", "reviewed", "retired"]),
  effective_from: z.iso.datetime(), effective_to: z.iso.datetime().nullable(), reviewed_at: z.iso.datetime().nullable(), reviewed_by: z.string().nullable(),
  proposal_basis: z.string().nullable(), nudge_channels_allowed: z.array(z.string()),
  rc_direct_numbers: z.array(z.string()),
  rc_team_messaging_person_id: z.string().nullable().optional(),
  history: z.array(z.object({ at: z.iso.datetime().nullable(), by: z.string().nullable(), change: z.string().nullable() }).strict()),
  metrics: z.object({ status: z.literal("unknown"), reason: z.literal("rep_metrics_not_available"), interactions_total: z.null() }).strict(),
}).strict();
export const attachedAgentDtoSchema = z.object({ id: csiIdSchema, name: z.string() }).strict();
export const repProposalDtoSchema = z.object({ extension_id:z.string(), extension_name:z.string().nullable(),
  status:z.enum(["not_proposed","non_user","ambiguous","proposed","unmatched"]),
  candidates:z.array(z.object({ agent_id:csiIdSchema,agent_name:z.string(),basis:z.enum(["exact_full_name","alias","first_token"]) }).strict()),
  extension_number:z.string().nullable().optional(), direct_numbers:z.array(z.string()).optional(), directory_status:z.string().optional(),
  rc_account_id: z.string().optional(), attached_agent: attachedAgentDtoSchema.nullable().optional() }).strict();
export const repDirectoryEvidenceSchema = z.object({ status:z.enum(["missing","incomplete","stored"]),snapshot_id:csiIdSchema.nullable(),
  taken_at:z.iso.datetime().nullable(),completeness:z.literal("provider_completeness_unverified") }).strict();
export const repDirectoryAccountSchema = z.object({ rc_account_id: z.string(), snapshot_id: csiIdSchema.nullable(),
  taken_at: z.iso.datetime().nullable(), status: z.enum(["missing","incomplete","stored"]) }).strict();
export const repListDtoSchema = z.object({ as_of:z.iso.datetime(),coverage:coverageDtoSchema,items:z.array(repLinkDtoSchema),next_cursor:csiIdSchema.nullable(),
  directory:repDirectoryEvidenceSchema.extend({
    accounts: z.array(repDirectoryAccountSchema).optional(),
    users:z.array(repProposalDtoSchema),next_cursor:z.string().nullable(),
  }).strict() }).strict();
export const repDetailDtoSchema = z.object({ as_of:z.iso.datetime(),coverage:coverageDtoSchema,link:repLinkDtoSchema }).strict();
export type DirectoryUserSource = { id: string; type: string; name?: string | null; extension_number?: string | null; direct_numbers?: string[]; status?: string | null };
export type DirectoryAccountSource = { rc_account_id: string; snapshot: { extensions: DirectoryUserSource[] } | null };
export function directoryUserKey(account: string, extensionId: string) {
  return `${account}:${extensionId}`;
}
export function collectDirectoryUsers(
  sources: readonly DirectoryAccountSource[],
  cursor?: string,
  limit = 50,
  excludeExtensionIds: readonly string[] = [],
) {
  const excluded = new Set(excludeExtensionIds.filter(Boolean));
  const users = sources.flatMap(source => (source.snapshot?.extensions ?? [])
    .filter(extension => extension.type === "User" && !excluded.has(extension.id))
    .map(extension => ({ ...extension, rc_account_id: source.rc_account_id })))
    .sort((left, right) => directoryUserKey(left.rc_account_id, left.id).localeCompare(directoryUserKey(right.rc_account_id, right.id)));
  const after = cursor ? users.filter(user => directoryUserKey(user.rc_account_id, user.id) > cursor) : users;
  return { page: after.slice(0, limit), next_cursor: after.length > limit ? directoryUserKey(after[limit - 1]!.rc_account_id, after[limit - 1]!.id) : null };
}
export function attachedAgentForUser(
  links: ReadonlyArray<{ rc_account_id: string; rc_extension_id: string; status: string; effective_to?: Date | null; agent_id: unknown; agent_name_snapshot: string }>,
  account: string,
  extensionId: string,
) {
  const current = links.filter(link => link.rc_account_id === account && link.rc_extension_id === extensionId && link.status === "reviewed" && !link.effective_to);
  return current.length === 1 ? { id: String(current[0]!.agent_id), name: current[0]!.agent_name_snapshot } : null;
}
function ownerSenderExtensions() {
  try {
    const sender = csiNudgeConfiguration().senderExtension;
    return sender ? [sender] : [];
  } catch {
    return [];
  }
}
function directoryEvidenceStatus(snapshot: { extensions: DirectoryUserSource[]; counts?: { extensions?: number; users?: number } } | null) {
  if (!snapshot) return "missing" as const;
  const users = snapshot.extensions.filter(extension => extension.type === "User");
  const incomplete = snapshot.counts
    && (snapshot.counts.extensions !== snapshot.extensions.length || snapshot.counts.users !== users.length || new Set(snapshot.extensions.map(extension => extension.id)).size !== snapshot.extensions.length);
  return incomplete ? "incomplete" as const : "stored" as const;
}
async function loadDirectoryAccounts(accountId?: string) {
  if (accountId) {
    const loaded = await loadRepDirectory(accountId, undefined, false);
    return [{ rc_account_id: accountId, snapshot: loaded.snapshot, evidence: loaded.evidence }];
  }
  const latest = await getRingCentralDirectorySnapshotModel().aggregate<{ _id: string; snapshot: { _id: unknown; taken_at: Date; extensions: DirectoryUserSource[]; counts?: { extensions?: number; users?: number } } }>([
    { $sort: { taken_at: -1, _id: -1 } },
    { $group: { _id: "$provider_account_id", snapshot: { $first: "$$ROOT" } } },
    { $limit: 50 },
  ]);
  const accounts = latest.map(row => ({
    rc_account_id: row._id,
    snapshot: row.snapshot,
    evidence: {
      status: directoryEvidenceStatus(row.snapshot),
      snapshot_id: row.snapshot?._id ? String(row.snapshot._id) : null,
      taken_at: row.snapshot?.taken_at?.toISOString?.() ?? null,
      completeness: "provider_completeness_unverified" as const,
    },
  }));
  if (accounts.length) return accounts;
  const configured = process.env.RINGCENTRAL_ACCOUNT_ID?.trim() ?? "";
  if (!configured) return [];
  const loaded = await loadRepDirectory(configured, undefined, false);
  return [{ rc_account_id: configured, snapshot: loaded.snapshot, evidence: loaded.evidence }];
}
type RepRow = InferSchemaType<typeof RepIdentityLinkSchema> & { _id: Types.ObjectId };
export function toRepLinkDto(row: Pick<RepRow, "_id" | "revision" | "agent_id" | "agent_name_snapshot" | "rc_account_id" | "rc_extension_id" |
  "rc_extension_number" | "rc_extension_name_snapshot" | "role_kind" | "status" | "effective_from" | "effective_to" | "reviewed_at" | "reviewed_by" |
  "proposal_basis" | "nudge_channels_allowed" | "rc_direct_numbers" | "history"> & { rc_team_messaging_person_id?: string | null }) {
  return repLinkDtoSchema.parse({ id: String(row._id), revision: row.revision, agent_id: String(row.agent_id), agent_name: row.agent_name_snapshot,
    rc_account_id: row.rc_account_id, rc_extension_id: row.rc_extension_id, rc_extension_number: row.rc_extension_number ?? null,
    rc_extension_name: row.rc_extension_name_snapshot ?? null, role_kind: row.role_kind, status: row.status,
    effective_from: row.effective_from.toISOString(), effective_to: row.effective_to?.toISOString() ?? null,
    reviewed_at: row.reviewed_at?.toISOString() ?? null, reviewed_by: row.reviewed_by ?? null, proposal_basis: row.proposal_basis ?? null,
    nudge_channels_allowed: row.nudge_channels_allowed, rc_direct_numbers: row.rc_direct_numbers ?? [],
    rc_team_messaging_person_id: row.rc_team_messaging_person_id ?? null, history: row.history.map(h => ({ at: h.at?.toISOString() ?? null, by: h.by ?? null, change: h.change ?? null })),
    metrics: { status: "unknown", reason: "rep_metrics_not_available", interactions_total: null } });
}
export async function listRepLinks(query: z.infer<typeof repListQuerySchema>) {
  const accounts = await loadDirectoryAccounts(query.rc_account_id);
  const accountIds = accounts.map(account => account.rc_account_id);
  const rows = await getRepIdentityLinkModel().find({
    ...(query.rc_account_id ? { rc_account_id: query.rc_account_id } : accountIds.length ? { rc_account_id: { $in: accountIds } } : {}),
    ...(query.cursor ? { _id: { $gt: query.cursor } } : {}),
  }).sort({ _id: 1 }).limit(query.limit + 1).lean();
  const cursor = query.directory_cursor && query.rc_account_id && !query.directory_cursor.includes(":")
    ? directoryUserKey(query.rc_account_id, query.directory_cursor)
    : query.directory_cursor;
  const { page, next_cursor } = collectDirectoryUsers(accounts, cursor, query.limit, ownerSenderExtensions());
  const snapshotIds = accounts.flatMap(account => account.snapshot && "_id" in account.snapshot && account.snapshot._id ? [String(account.snapshot._id)] : []);
  const stored: Array<{ _id:string; proposal:unknown }> = snapshotIds.length && page.length ? await getSalesIntelligenceCommandExecutionModel().aggregate([
    { $match:{ command:"propose_reps","response.directory.snapshot_id":{ $in: snapshotIds } } },
    { $unwind:"$response.results" }, { $match:{ "response.results.extension_id":{ $in:page.map(user => user.id) } } },
    { $sort:{ executed_at:-1,_id:-1 } }, { $group:{ _id:"$response.results.extension_id",proposal:{ $first:"$response.results" } } },
    { $limit:query.limit },
  ]) : [];
  const proposalEvidence = new Map(stored.map(item => [item._id, repProposalDtoSchema.strip().parse(item.proposal)]));
  const storedAccount = accounts.length === 1 ? accounts[0]!.evidence : {
    status: accounts.some(account => account.evidence.status === "stored") ? "stored" as const
      : accounts.some(account => account.evidence.status === "incomplete") ? "incomplete" as const : "missing" as const,
    snapshot_id: accounts.length === 1 ? accounts[0]!.evidence.snapshot_id : null,
    taken_at: accounts.map(account => account.evidence.taken_at).filter(Boolean).sort().at(-1) ?? null,
    completeness: "provider_completeness_unverified" as const,
  };
  return repListDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), items: rows.slice(0,query.limit).map(toRepLinkDto),
    next_cursor: rows.length > query.limit ? String(rows[query.limit - 1]!._id) : null,
    directory: { ...storedAccount, accounts: accounts.map(account => ({
      rc_account_id: account.rc_account_id, snapshot_id: account.evidence.snapshot_id, taken_at: account.evidence.taken_at, status: account.evidence.status,
    })), users: page.map(user => ({
      ...(proposalEvidence.get(user.id) ?? { extension_id: user.id, extension_name: user.name ?? null, status: "not_proposed" as const, candidates: [] }),
      extension_number: user.extension_number ?? null, direct_numbers: user.direct_numbers ?? [], directory_status: user.status ?? "Unknown",
      rc_account_id: user.rc_account_id,
      attached_agent: attachedAgentDtoSchema.safeParse(attachedAgentForUser(rows, user.rc_account_id, user.id)).data ?? null,
    })),
      next_cursor } });
}
export async function readRepLink(id: string) {
  const row = await getRepIdentityLinkModel().findById(id).lean();
  return row ? repDetailDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), link: toRepLinkDto(row) }) : null;
}
