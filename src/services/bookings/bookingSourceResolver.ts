import type { ClientSession } from "mongoose";
import {
  resolveSourceCompany,
  type LeadModelName,
  type SourceCompany,
} from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import {
  findBestCallLeadMatchByPhone,
  getLinkedLead,
  hasFormFillForCallLead,
  type SourceLeadDocument,
} from "../leads";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  CreateBookedLeadFromSourceInput,
  CreateBookedLeadInput,
} from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import { resolveLeadCplSnapshot } from "../leads/leadCplResolution";
import { bestRelocationImportLeadFilter } from "./bestRelocationImportGuard";
import {
  applyLeadChangeStamp,
  BOOKING_SOURCE_RESOLVER_ACTOR_ID,
  emitLeadChange,
  loadLeadSnapshot,
  systemLeadChangeContext,
} from "../domainCommands/leadChangeEmission";

/**
 * Locates (or creates) the source lead a booked-from-source request points at.
 *
 * Owner Precise Booking Form Call Lead create does **not** use this resolver.
 * That path asks Exact Job Booking Attach (`evaluateEmployeeBookingMatch`)
 * and never phone-matches or mints an Unmatched Call Lead.
 *
 * This resolver remains for:
 *   - `FormLead` requests (Owner-selected Mongo ID).
 *   - Best Relocation import Call Lead (`ingestion_source=best_relocation_sheet`):
 *     job lookup (409 if 2+), then `findBestCallLeadMatchByPhone`, then mint
 *     `created_on_unmatched`.
 *
 * Every Call Lead write here (phone/job correction, the Unmatched mint) emits
 * its own Lead `EntityChange` (LP-03 / H4) in `options.session` when the caller
 * supplies one, and stamps the returned document's `domain_revision` so the
 * booking command's later Lead mutation uses the current CAS value. The
 * from-source booking planner passes its transaction session, so the write and
 * its change commit with the Booking. Without a session (legacy callers) the
 * Lead write and its change are two separate writes, not one atomic commit.
 */
export async function resolveBookingSourceLead(
  input: CreateBookedLeadFromSourceInput,
  options: { session?: ClientSession } = {},
): Promise<{ lead: SourceLeadDocument; leadModel: LeadModelName; jobNo?: string }> {
  const { session } = options;
  if (input.lead_type === "FormLead") {
    const lead = await getLinkedLead("FormLead", input.form_lead_id, session);
    return { lead, leadModel: "FormLead", jobNo: input.job_no };
  }

  const jobNo = input.call_job_no?.trim() || undefined;
  const submittedPhone = input.call_phone_number?.trim();
  const normalizedPhone = normalizePhoneNumberForMatch(submittedPhone);
  const importLeadFilter = bestRelocationImportLeadFilter(input.ingestion_source);

  const leads = jobNo
    ? await CallLead.find({ job_no: jobNo, ...importLeadFilter })
        .session(session ?? null)
        .sort({ createdAt: -1 })
        .limit(5)
    : [];

  if (leads.length > 1) {
    throw new V1ServiceError(
      `Multiple call leads matched job_no ${jobNo}: ${leads
        .map((lead) => lead._id.toString())
        .join(", ")}`,
      409,
    );
  }

  if (leads.length === 1) {
    const lead = leads[0];
    if (submittedPhone) {
      const before = await loadLeadSnapshot("CallLead", lead._id.toString(), session);
      lead.phone_number = submittedPhone;
      await lead.save({ session });
      await recordResolverLeadChange(lead, before, "correctBookingSourceCallLead", session);
    }
    return { lead, leadModel: "CallLead", jobNo };
  }

  const phoneMatchedLead = normalizedPhone
    ? await findBestCallLeadMatchByPhone(normalizedPhone, {
        sourceCompany: importLeadFilter.source_company,
      })
    : undefined;
  if (phoneMatchedLead) {
    const before = await loadLeadSnapshot(
      "CallLead",
      phoneMatchedLead._id.toString(),
      session,
    );
    if (jobNo) {
      phoneMatchedLead.job_no = jobNo;
    }
    if (submittedPhone) {
      phoneMatchedLead.phone_number = submittedPhone;
    }
    await phoneMatchedLead.save({ session });
    await recordResolverLeadChange(
      phoneMatchedLead,
      before,
      "correctBookingSourceCallLead",
      session,
    );
    return { lead: phoneMatchedLead, leadModel: "CallLead", jobNo };
  }

  const { assignment: sourceAssignment } = await resolveLeadSourceAssignment({
      value: input.source_company,
      channel: "call",
    });
  const form_fill = await hasFormFillForCallLead(
    {
      sourceCompany: sourceAssignment.source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    submittedPhone,
  );
  const timestamp = toFloridaTimestamp(input.timestamp);
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: timestamp,
    applicable: false,
  });
  const lead = new CallLead({
    ...(jobNo ? { job_no: jobNo } : {}),
    ...(submittedPhone ? { phone_number: submittedPhone } : {}),
    ...sourceAssignment,
    form_fill,
    created_on_unmatched: true,
    timestamp,
    ...cplSnapshot,
  });
  await lead.save({ session });
  await recordResolverLeadChange(lead, null, "createCallLead", session);

  return { lead, leadModel: "CallLead", jobNo };
}

async function recordResolverLeadChange(
  lead: SourceLeadDocument,
  before: Record<string, unknown> | null,
  command_name: string,
  session: ClientSession | undefined,
): Promise<void> {
  const leadId = lead._id.toString();
  const stamp = await emitLeadChange({
    model: "CallLead",
    id: leadId,
    before,
    session,
    now: new Date(),
    command_name,
    context: systemLeadChangeContext({
      actor_id: BOOKING_SOURCE_RESOLVER_ACTOR_ID,
      command_name,
      payload: { lead_model: "CallLead", lead_id: leadId },
    }),
  });
  applyLeadChangeStamp(lead, stamp);
}

/**
 * Resolves the effective `source_company` to persist on a booked lead.
 *
 * If the request explicitly overrides the source company, prefer the label
 * lookup (so display strings like "Vantage – Long Distance" still resolve
 * to their canonical key) and fall back to direct parsing. When no override
 * is supplied, parse the source lead's existing `source_company`.
 */
export function effectiveBookingSourceCompany(
  sourceCompanyOverride: string | undefined,
  lead: SourceLeadDocument,
): SourceCompany {
  const sourceCompanyOverrideText = sourceCompanyOverride?.trim();
  if (sourceCompanyOverrideText) {
    return sourceCompanyOverrideText as SourceCompany;
  }

  return String(lead.source_company ?? "not_provided") as SourceCompany;
}

/**
 * Decides whether the booking-driven write should overwrite the form lead's
 * `source_company`.
 *
 * Returns the canonical company only when the booking targets a `FormLead`
 * AND the lead's stored company differs from the canonical mapping derived
 * from `input.source`. Returns `undefined` for call leads (their company is
 * settled at booking-source-resolution time) and when the values already
 * agree.
 */
export function getFormLeadSourceCompanyForBooking(
  lead: SourceLeadDocument,
  input: Pick<CreateBookedLeadInput, "lead_model" | "source">,
): SourceCompany | undefined {
  if (input.lead_model !== "FormLead") {
    return undefined;
  }

  const mappedSourceCompany = resolveSourceCompany(input.source);
  if (!mappedSourceCompany || lead.source_company === mappedSourceCompany) {
    return undefined;
  }

  return mappedSourceCompany;
}
