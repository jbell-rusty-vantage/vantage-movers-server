import { z } from "zod";
import type { InferSchemaType, Types } from "mongoose";
import { getOwnerRepNudgeModel, type OwnerRepNudgeSchema } from "../../../models/OwnerRepNudge";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";

export type NudgeRow = InferSchemaType<typeof OwnerRepNudgeSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const nudgeHistoryQuerySchema = z.object({ scope: z.literal("production").optional(), outreach_record_id: csiIdSchema.optional(),
  rep_identity_link_id: csiIdSchema.optional(), cursor: csiIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const nudgeDtoSchema = z.object({ id: csiIdSchema, revision: z.number().int().positive(), outreach_record_id: csiIdSchema, rep_identity_link_id: csiIdSchema,
  agent_id: csiIdSchema, actor_id: z.string(), channel: z.enum(["team_messaging", "sms_to_rep", "pager"]), purpose: z.enum(["call_suggestion", "review_context"]),
  template_key: z.string(), template_version: z.number(), body_as_sent: z.string(), status: z.enum(["pending", "sent", "failed", "unknown_delivery", "fallback_sent"]),
  fallback_channel: z.literal("pager").nullable(), error_code: z.string().nullable(), created_at: z.iso.datetime(), sent_at: z.iso.datetime().nullable(),
  delivery_note: z.string(), automatic_resend: z.literal(false) });
export type NudgeDto = z.infer<typeof nudgeDtoSchema>;
export function toNudgeDto(row: NudgeRow): NudgeDto {
  return nudgeDtoSchema.parse({ id: String(row._id), revision: row.revision ?? 1, outreach_record_id: String(row.outreach_record_id), rep_identity_link_id: String(row.rep_identity_link_id),
    agent_id: String(row.agent_id), actor_id: row.actor.id, channel: row.channel, purpose: row.purpose ?? "review_context", template_key: row.template_key, template_version: row.template_version,
    body_as_sent: row.body_as_sent, status: row.status, fallback_channel: row.fallback_channel, error_code: row.error_code, created_at: row.createdAt.toISOString(), sent_at: row.sent_at?.toISOString() ?? null,
    delivery_note: row.status === "unknown_delivery" ? "Delivery could not be established. Do not retry automatically." : row.status === "pending" ? "Authorized intent; delivery is not established." :
      row.status === "failed" ? "Message submission failed or did not begin." : "Provider accepted the message; this is not evidence of customer work.", automatic_resend: false });
}
/** Read only: no provider resolution, repair, dispatch, or status writes. */
export async function nudgeHistoryPage(query: z.infer<typeof nudgeHistoryQuerySchema>) {
  const rows = await getOwnerRepNudgeModel().find({ ...(query.outreach_record_id ? { outreach_record_id: query.outreach_record_id } : {}),
    ...(query.rep_identity_link_id ? { rep_identity_link_id: query.rep_identity_link_id } : {}), ...(query.cursor ? { _id: { $lt: query.cursor } } : {}) }).sort({ _id: -1 }).limit(query.limit + 1).lean();
  return { items: rows.slice(0, query.limit).map(toNudgeDto), next_cursor: rows.length > query.limit ? String(rows[query.limit - 1]!._id) : null };
}
export async function listNudges(query: z.infer<typeof nudgeHistoryQuerySchema>) { return ownerRead(await nudgeHistoryPage(nudgeHistoryQuerySchema.parse(query))); }
