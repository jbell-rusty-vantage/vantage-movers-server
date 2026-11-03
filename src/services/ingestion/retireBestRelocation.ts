import mongoose from "mongoose";
import { ExternalDataConnection } from "../../models/ExternalDataConnection";
import { IngestionRun } from "../../models/IngestionRun";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { BEST_RELOCATION_COMPANY_SLUG, BEST_RELOCATION_RETIRED_LABELS } from "../../models/bestRelocationRetirement";
import { activeTokenFilter, MongoLeaseStore, type DurableActor } from "../durableWork";

/** Operator-only cutover after final reconciliation; never exposed through HTTP or queue. */
export async function retireBestRelocationConnectionAndSources(input: {
  company_id: string;
  source_ids: readonly string[];
  final_run_id: string;
  actor: DurableActor;
  reconciliation_status?: "complete" | "incomplete";
  now?: Date;
}): Promise<{ cancelled_runs: number; source_ids: string[] }> {
  if (!input.final_run_id.trim() || input.actor.actor_type !== "owner" ||
      input.actor.actor_role !== "owner" || input.actor.origin !== "vantage_admin" ||
      !input.actor.actor_id.trim() || !input.actor.request_id.trim()) {
    throw new Error("Retirement requires final-run evidence and a trusted human actor.");
  }
  if (!mongoose.isValidObjectId(input.company_id) || !input.source_ids.length ||
      input.source_ids.some((id) => !mongoose.isValidObjectId(id))) {
    throw new Error("Retirement requires inventoried canonical company/source IDs.");
  }
  const now = input.now ?? new Date();
  const reconciliationStatus = input.reconciliation_status ?? "incomplete";
  const store = new MongoLeaseStore(SheetSyncLease);
  const token = await store.acquire({ scope: "ingestion:best_relocation:apply", owner: `retire:${input.final_run_id}`,
    ttl_ms: 5 * 60_000, now });
  if (!token) throw new Error("An ingestion worker holds the lease; wait for its checkpoint/release before retirement.");
  const session = await mongoose.startSession();
  try {
    let result = { cancelled_runs: 0, source_ids: [] as string[] };
    await session.withTransaction(async () => {
      // Serialize against lease renewal/reclaim instead of guessing a worker's transaction state.
      const held = await SheetSyncLease.updateOne(activeTokenFilter(token, new Date()),
        { $set: { leased_until: token.leased_until } }, { session }).exec();
      if (held.matchedCount !== 1) throw new Error("Retirement lost its apply lease.");
      const active = await IngestionRun.exists({ adapter_key: "best_relocation",
        status: { $in: ["inspecting", "planning", "applying"] }, leased_until: { $gt: now } }).session(session);
      if (active) throw new Error("An old run still reports a live lease; inspect its checkpoint before cancelling it.");
      const company = await getLeadSourceCompanyModel().findById(input.company_id).session(session).lean().exec();
      if (!company || company.company_slug !== BEST_RELOCATION_COMPANY_SLUG) {
        throw new Error("Inventoried Source Company is not Best Relocation.");
      }
      const Source = getGranotCrmSourceModel();
      const rows = await Source.find({ $or: [
        { lead_source_company: input.company_id },
        { normalized_granot_label: { $in: BEST_RELOCATION_RETIRED_LABELS } },
      ] }).select("_id normalized_granot_label lead_source_company lifecycle_policy_version lifecycle_routes lead_created_policy granot_creation_retired_at")
        .session(session).lean().exec();
      const actualIds = rows.map((row) => String(row._id)).sort();
      const expectedIds = [...new Set(input.source_ids)].sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds) ||
          rows.some((row) => row.lead_source_company && String(row.lead_source_company) !== input.company_id)) {
        throw new Error("Best Relocation registry inventory changed or a label points to another company; recapture and review.");
      }
      await getLeadSourceCompanyModel().updateOne({ _id: company._id }, { $set: {
        granot_creation_retired_at: company.granot_creation_retired_at ?? now,
        granot_creation_retirement_run_id: input.final_run_id,
      } }, { session }).exec();
      // Older registry rows may store null rather than an SMS policy object.
      await Source.updateMany({ _id: { $in: actualIds }, outbound_sms: null },
        { $set: { outbound_sms: { enabled: false } } }, { session }).exec();
      await Source.updateMany({ _id: { $in: actualIds } }, { $set: {
        lead_created_policy: "link_only", granot_creation_retired_at: now,
        granot_creation_retirement_run_id: input.final_run_id,
        lifecycle_policy_version: "best-relocation-retired/v1",
        "outbound_sms.enabled": false, "outbound_sms.deactivated_at": now,
        "outbound_sms.deactivation_reason": "best_relocation_retired",
      } }, { session }).exec();
      await ExternalDataConnection.updateOne({ key: "best_relocation" }, { $set: {
        retired_at: now, retirement_final_run_id: input.final_run_id,
        retirement_reason: reconciliationStatus === "complete"
          ? "Recurring ingestion permanently retired; final reconciliation verified complete."
          : "Recurring ingestion permanently retired; final reconciliation incomplete; inspect final-run evidence.",
        retirement_reconciliation_status: reconciliationStatus,
        application_enabled: false, application_enabled_actor: null, next_due_at: null, updated_actor: input.actor,
      }, $setOnInsert: { provider: "google_sheets", created_actor: input.actor,
        workbook_env_keys: { leads: "archived_final_snapshot", booked: "archived_final_snapshot" } } },
      { session, upsert: true }).exec();
      const cancelled = await IngestionRun.updateMany({ adapter_key: "best_relocation",
        status: { $in: ["queued", "inspecting", "planning", "awaiting_approval", "applying", "failed"] } },
        { $set: { status: "skipped", skip_reason: { code: "BEST_RELOCATION_RETIRED", final_run_id: input.final_run_id },
          completed_at: now, lease_owner: null, leased_until: null } }, { session }).exec();
      result = { cancelled_runs: cancelled.modifiedCount, source_ids: actualIds };
    });
    return result;
  } finally {
    await session.endSession();
    await store.release({ token, now: new Date() });
  }
}
