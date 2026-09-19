import { z } from "zod";
import type { InferSchemaType, Types } from "mongoose";
import { getRepIdentityLinkModel, RepIdentityLinkSchema } from "../../../models/RepIdentityLink";
import { csiIdSchema, csiTextSchema } from "../../../validation/v1/salesIntelligence";
import { loadRepDirectory } from "./propose";
import { getSalesIntelligenceCommandExecutionModel } from "../../../models/SalesIntelligenceCommandExecution";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { coverageDtoSchema } from "../dto";

export const repListQuerySchema = z.object({ scope: z.literal("production").optional(), rc_account_id: csiTextSchema,
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
export const repProposalDtoSchema = z.object({ extension_id:z.string(), extension_name:z.string().nullable(),
  status:z.enum(["not_proposed","non_user","ambiguous","proposed","unmatched"]),
  candidates:z.array(z.object({ agent_id:csiIdSchema,agent_name:z.string(),basis:z.enum(["exact_full_name","alias","first_token"]) }).strict()),
  extension_number:z.string().nullable().optional(), direct_numbers:z.array(z.string()).optional(), directory_status:z.string().optional() }).strict();
export const repDirectoryEvidenceSchema = z.object({ status:z.enum(["missing","incomplete","stored"]),snapshot_id:csiIdSchema.nullable(),
  taken_at:z.iso.datetime().nullable(),completeness:z.literal("provider_completeness_unverified") }).strict();
export const repListDtoSchema = z.object({ as_of:z.iso.datetime(),coverage:coverageDtoSchema,items:z.array(repLinkDtoSchema),next_cursor:csiIdSchema.nullable(),
  directory:repDirectoryEvidenceSchema.extend({ users:z.array(repProposalDtoSchema),next_cursor:z.string().nullable() }).strict() }).strict();
export const repDetailDtoSchema = z.object({ as_of:z.iso.datetime(),coverage:coverageDtoSchema,link:repLinkDtoSchema }).strict();
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
  const rows = await getRepIdentityLinkModel().find({ rc_account_id: query.rc_account_id, ...(query.cursor ? { _id: { $gt: query.cursor } } : {}) }).sort({ _id: 1 }).limit(query.limit + 1).lean();
  const { snapshot, evidence } = await loadRepDirectory(query.rc_account_id, undefined, false);
  const users = (snapshot?.extensions ?? []).filter(e => e.type === "User" && (!query.directory_cursor || e.id > query.directory_cursor)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const page = users.slice(0, query.limit);
  // Proposal evidence already lives in the durable Owner command response, including unmatched Users.
  // GET reads that evidence; it never invokes the matcher or invents a required Agent reference.
  const stored: Array<{ _id:string; proposal:unknown }> = snapshot && page.length ? await getSalesIntelligenceCommandExecutionModel().aggregate([
    { $match:{ command:"propose_reps","response.directory.snapshot_id":String(snapshot._id) } },
    { $unwind:"$response.results" }, { $match:{ "response.results.extension_id":{ $in:page.map(e=>e.id) } } },
    { $sort:{ executed_at:-1,_id:-1 } }, { $group:{ _id:"$response.results.extension_id",proposal:{ $first:"$response.results" } } },
    { $limit:query.limit },
  ]) : [];
  const proposalEvidence = new Map(stored.map(item => [item._id, repProposalDtoSchema.strip().parse(item.proposal)]));
  return repListDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), items: rows.slice(0,query.limit).map(toRepLinkDto),
    next_cursor: rows.length > query.limit ? String(rows[query.limit - 1]!._id) : null,
    directory: { ...evidence, users: page.map(e => ({
      ...(proposalEvidence.get(e.id) ?? { extension_id:e.id,extension_name:e.name ?? null,status:"not_proposed" as const,candidates:[] }),
      extension_number:e.extension_number ?? null, direct_numbers:e.direct_numbers ?? [], directory_status:e.status ?? "Unknown",
    })),
      next_cursor: users.length > query.limit ? page.at(-1)!.id : null } });
}
export async function readRepLink(id: string) {
  const row = await getRepIdentityLinkModel().findById(id).lean();
  return row ? repDetailDtoSchema.parse({ as_of: new Date().toISOString(), coverage: await readCaptureCoverage(), link: toRepLinkDto(row) }) : null;
}
