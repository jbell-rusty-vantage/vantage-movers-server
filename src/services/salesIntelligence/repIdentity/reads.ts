import { z } from "zod";
import type { InferSchemaType, Types } from "mongoose";
import { getRepIdentityLinkModel, RepIdentityLinkSchema } from "../../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { loadRepDirectory } from "./propose";

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
export type DirectoryUserSource = { id: string; type: string; name?: string | null; extension_number?: string | null; direct_numbers?: string[]; status?: string | null };
function directoryEvidenceStatus(snapshot: { extensions: DirectoryUserSource[]; counts?: { extensions?: number; users?: number } } | null) {
  if (!snapshot) return "missing" as const;
  const users = snapshot.extensions.filter(extension => extension.type === "User");
  const incomplete = snapshot.counts
    && (snapshot.counts.extensions !== snapshot.extensions.length || snapshot.counts.users !== users.length || new Set(snapshot.extensions.map(extension => extension.id)).size !== snapshot.extensions.length);
  return incomplete ? "incomplete" as const : "stored" as const;
}
export async function loadDirectoryAccounts(accountId?: string) {
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
