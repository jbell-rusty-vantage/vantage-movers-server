import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import type { CsiTransactionContext } from "../transactions";
import { auditChange } from "../outreach/store";
import { openReview } from "./items";
import { lockNumber } from "../attachment/store";
import { assertTrustedActor, CsiError } from "../auth";
/** Shared by number-only and Outreach effect application. Stable source survives Owner resolution. */
export async function applySpokenRestriction(input: { number_id: string; interaction_id: string; channels: ("call" | "text")[]; until: Date | null; run_id: string; finding_id: string }, context: CsiTransactionContext) {
  assertTrustedActor(context.actor);
  if (!context.session.inTransaction()) throw new CsiError("INVALID_INPUT");
  const Model = getSalesIntelligenceContactRestrictionModel();
  await lockNumber(input.number_id, context.session);
  const existing = await Model.findOne({ contact_number_id: input.number_id, source_interaction_id: input.interaction_id }).session(context.session);
  if (existing) return { status: existing.resolution_actor ? "blocked_owner" as const : "no_change" as const, target_id: String(existing._id), reason: "existing_source_restriction" };
  const [row] = await Model.create([{ contact_number_id: input.number_id, source_interaction_id: input.interaction_id, channels: [...new Set(input.channels)], until: input.until,
    origin: "intelligence", actor: context.actor, run_id: input.run_id, finding_id: input.finding_id }], { session: context.session });
  await openReview(context, `number:${input.number_id}`, "restriction", String(row!._id), [input.finding_id]);
  await auditChange(context, "restriction", `number:${input.number_id}`, row!, {}, row!.toObject(), "channel_paused");
  return { status: "applied" as const, target_id: String(row!._id), reason: "clear_spoken_restriction" };
}
