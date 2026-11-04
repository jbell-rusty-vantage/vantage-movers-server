import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { IngestionRun } from "../../models/IngestionRun";
import type { BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import { canonicalJson, computeChecksum } from "../durableWork";
import { ConflictError } from "../errors";
import { BEST_RELOCATION_CUTOFF } from "../bestRelocationSheetIngest/sheets";
import { BEST_RELOCATION_TRACKER_ID, classifyExternalReview, externalSheetReviewSchema,
  EXTERNAL_REVIEW_POLICY_VERSION, REVIEW_SOURCE_TABS, type ExternalSheetReview } from "../leads/externalSheetReview";
import type { CanonicalCommandContext } from "./types";

type FrozenRun = {
  plan_snapshot?: any; plan_checksum?: string | null; source_read_through?: Date | null;
  initiator?: any; approval?: any;
};

/** The run's stored graph, financial action and Lead action are one released
 * artifact. A plausible match claim supplied only on a create is insufficient. */
export function assertFinalNormalLeadBookingMatch(action: BestRelocationPlanAction, run: FrozenRun): void {
  assertReleasedFinalLeadPlan(run);
  const snapshot = run.plan_snapshot;
  const matches = Array.isArray(snapshot.booking_matches)
    ? snapshot.booking_matches.filter((edge: any) => edge.lead_action_key === action.action_key) : [];
  if (matches.length !== 1 || action.matching?.method !== "definite_booking") {
    throw new ConflictError("Normal final Leads require a persisted definite Booking match");
  }
  const match = matches[0];
  const actions: BestRelocationPlanAction[] = snapshot.canonical_plan?.actions ?? [];
  const bookings = actions.filter(row => row.action_key === match.booking_action_key && row.dataset_key === "booked_deals" &&
    ["adopt_existing", "create_leadless_booking", "create_booked_from_source"].includes(row.command) &&
    ["adoption", "create", "leadless_booking"].includes(row.classification));
  if (bookings.length !== 1 || typeof match.booking_identity !== "string" || !match.booking_identity.trim() ||
      match.booking_identity !== bookings[0]!.stable_source_row_id ||
      !Array.isArray(match.evidence) || !match.evidence.length ||
      match.evidence.some((item: unknown) => typeof item !== "string" || !item.trim()) ||
      !action.matching.evidence.includes(`booking_action:${match.booking_action_key}`)) {
    throw new ConflictError("Normal final Lead Booking evidence is absent, ambiguous or unresolved");
  }
}

export function assertReleasedFinalLeadPlan(run: FrozenRun): void {
  const { checksum: _checksum, ...signed } = run.plan_snapshot ?? {};
  const checksum = createHash("sha256").update(JSON.stringify(signed)).digest("hex");
  if (!run.plan_checksum || run.plan_snapshot?.checksum !== run.plan_checksum || checksum !== run.plan_checksum ||
      run.approval?.owner_released_deferred_ingestion_checksum !== run.plan_checksum) {
    throw new ConflictError("Final Leads require the released frozen plan checksum");
  }
}

/** Form commands use the existing canonical create adapter. Its payload and
 * identity must still be literally present in the released final source plan. */
export function assertApprovedFinalFormCreate(input: { data: unknown; context: CanonicalCommandContext }, run: FrozenRun) {
  assertReleasedFinalLeadPlan(run);
  const { context } = input;
  const actions: BestRelocationPlanAction[] = run.plan_snapshot?.canonical_plan?.actions ?? [];
  const matches = actions.filter(row => row.action_key === context.idempotency_key);
  const action = matches[0];
  if (context.provenance.origin !== "external_sheet_ingestion" || context.provenance.source_connection_key !== "best_relocation" ||
      context.initiator.actor_type !== "owner" || !mongoose.isValidObjectId(context.provenance.run_id) ||
      !mongoose.isValidObjectId(context.provenance.source_receipt_id) || run.approval?.final_reconciliation !== true ||
      run.initiator?.actor_id !== context.initiator.actor_id || !run.plan_checksum || run.plan_snapshot?.checksum !== run.plan_checksum ||
      run.approval?.owner_released_deferred_ingestion_checksum !== run.plan_checksum || matches.length !== 1 ||
      action?.command !== "create_form_lead" || action.classification !== "create" ||
      !["forms", "local_forms"].includes(action.dataset_key) || "rows" in action.provenance ||
      action.provenance.workbook_id !== BEST_RELOCATION_TRACKER_ID ||
      action.provenance.tab !== (action.dataset_key === "forms" ? "Forms" : "Local Forms") ||
      !/^[a-f0-9]{64}$/.test(action.content_hash) || !action.stable_source_row_id.trim() ||
      canonicalJson(action.command_payload) !== canonicalJson(input.data) || context.payload_checksum !== computeChecksum({
        checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: action.schema_version, payload: input.data,
      })) throw new ConflictError("Final Form is absent from the released frozen plan");
  const arrival = new Date(String(action.command_payload?.timestamp)), through = run.source_read_through;
  if (!Number.isFinite(+arrival) || !through || !Number.isFinite(+through) || +arrival < +BEST_RELOCATION_CUTOFF || +arrival >= +through) {
    throw new ConflictError("Final Form is outside the supported source window");
  }
  return action;
}

export async function loadFinalFormCreateAuthorization(input: { data: unknown; context: CanonicalCommandContext }, session: ClientSession, now: Date) {
  const run = await IngestionRun.findById(input.context.provenance.run_id).session(session).lean();
  if (!run) throw new ConflictError("Final Form run is missing");
  return finalFormCreateAuthorization(input, run, now);
}

export function finalFormCreateAuthorization(input: { data: unknown; context: CanonicalCommandContext }, run: FrozenRun, now: Date) {
  const action = assertApprovedFinalFormCreate(input, run);
  const provenance = action.provenance as Exclude<BestRelocationPlanAction["provenance"], { rows: unknown[] }>;
  const classification = classifyExternalReview(provenance.raw["Bad Lead Checker"] ?? "", "FormLead");
  const review: ExternalSheetReview | undefined = classification ? externalSheetReviewSchema.parse({
    ...classification, source_workbook_id: provenance.workbook_id,
    source_sheet_id: REVIEW_SOURCE_TABS[provenance.tab as "Forms" | "Local Forms"], source_tab: provenance.tab,
    stable_source_row_id: action.stable_source_row_id,
    // This is the checker fact identity used by the independent review command,
    // rather than the source-owned business payload hash.
    source_content_hash: createHash("sha256").update(JSON.stringify([EXTERNAL_REVIEW_POLICY_VERSION, provenance.raw])).digest("hex"),
    policy_version: EXTERNAL_REVIEW_POLICY_VERSION, ingestion_run_id: input.context.provenance.run_id,
    source_row_receipt_id: input.context.provenance.source_receipt_id, applied_at: now,
  }) : undefined;
  return { review, assertCreate: (duplicate: boolean) => {
    if (!review && !duplicate) assertFinalNormalLeadBookingMatch(action, run);
  } };
}
