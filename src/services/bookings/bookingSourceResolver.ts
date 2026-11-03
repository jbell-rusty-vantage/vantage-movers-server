import type { ClientSession } from "mongoose";
import {
  resolveSourceCompany,
  type LeadModelName,
  type SourceCompany,
} from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import {
  findBestCallLeadMatchByPhone,
  getLinkedLead,
  type SourceLeadDocument,
} from "../leads";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  CreateBookedLeadFromSourceInput,
  CreateBookedLeadInput,
} from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";
import { bestRelocationImportLeadFilter } from "./bestRelocationImportGuard";
import {
  applyLeadChangeStamp,
  BOOKING_SOURCE_RESOLVER_ACTOR_ID,
  emitLeadChange,
  loadLeadSnapshot,
  systemLeadChangeContext,
} from "../domainCommands/leadChangeEmission";

/** Resolve an existing booking source by ID or import job/phone. A missing Call Lead requires reconciliation. */
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

  throw new V1ServiceError("No existing Call Lead matched; reconcile the booking without creating a Call Lead", 409);
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
