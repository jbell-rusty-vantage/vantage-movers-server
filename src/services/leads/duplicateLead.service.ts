import mongoose, { type ClientSession } from "mongoose";
import type { SourceCompany } from "../../config/domain";
import { logger } from "../../logger";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { FullSheetSyncJob } from "../sheetSync";
import {
  emitLeadChange,
  FORM_FILL_DETECTOR_ACTOR_ID,
  systemLeadChangeContext,
} from "../domainCommands/leadChangeEmission";
import { buildPhoneRegex } from "./leadPhoneMatching";

export type DuplicateFormLeadMatch = {
  duplicate: boolean;
  matchedBy: "email" | "phone" | "both" | null;
  matchedLeadIds: string[];
};

export type LeadSourceMatchScope = {
  sourceCompany: SourceCompany | string;
  leadSourceCompany?: unknown;
};

export type ExactGranularityMatchScope = LeadSourceMatchScope & {
  sourceGranularityId: unknown;
};

const FORM_DUPLICATE_CUTOFF = new Date("2026-04-30T04:00:00.000Z");

/**
 * Classifies a Duplicate Form Lead: an earlier non-duplicate Form Lead with
 * the same exact Source Granularity, in the cutoff cohort, whose email or
 * phone matches. Returns the match basis and matched lead IDs.
 *
 * Missing contact returns a non-match before any read. Contact without
 * `sourceGranularityId` throws. This query does not filter on Source Company.
 *
 * Phone matching uses `buildPhoneRegex` as a Mongo-side sieve and then
 * re-verifies in memory via `normalizePhoneNumberForMatch`.
 */
export async function findDuplicateFormLeadMatch(
  sourceScope: ExactGranularityMatchScope,
  phoneNumber?: string | null,
  email?: string | null,
  eventTimestamp: Date = new Date(),
): Promise<DuplicateFormLeadMatch> {
  const FormLead = getFormLeadModel();
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  const normalizedEmail = email?.trim().toLowerCase();
  const duplicateClauses = [
    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ...(normalizedPhone ? [{ phone_number: buildPhoneRegex(normalizedPhone) }] : []),
  ];

  if (duplicateClauses.length === 0) {
    return { duplicate: false, matchedBy: null, matchedLeadIds: [] };
  }

  if (!sourceScope.sourceGranularityId) {
    throw new Error("Duplicate Form Lead classification requires an exact Source Granularity");
  }
  const cohortRange = eventTimestamp < FORM_DUPLICATE_CUTOFF
    ? { $lt: eventTimestamp }
    : { $gte: FORM_DUPLICATE_CUTOFF, $lt: eventTimestamp };

  // $and keeps the granularity, duplicate, cohort, and email/phone clauses
  // from overwriting one another.
  const candidates = await FormLead.find({
    $and: [
      { source_granularity_id: sourceScope.sourceGranularityId },
      { duplicate: { $ne: true } },
      { timestamp: cohortRange },
      { $or: duplicateClauses },
    ],
  })
    .sort({ timestamp: 1, _id: 1 })
    .exec();

  let emailMatch = false;
  let phoneMatch = false;
  let hasMatch = false;
  const matchedLeadIds: string[] = [];

  for (const lead of candidates) {
    const byEmail = normalizedEmail ? lead.email === normalizedEmail : false;
    const byPhone = normalizedPhone
      ? normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone
      : false;
    if (byEmail || byPhone) {
      hasMatch = true;
      emailMatch = emailMatch || byEmail;
      phoneMatch = phoneMatch || byPhone;
      if (lead._id) {
        matchedLeadIds.push(lead._id.toString());
      }
    }
  }

  const duplicate = hasMatch;
  const matchedBy = !duplicate
    ? null
    : emailMatch && phoneMatch
      ? "both"
      : emailMatch
        ? "email"
        : "phone";

  return { duplicate, matchedBy, matchedLeadIds };
}

/**
 * Boolean wrapper around `findDuplicateFormLeadMatch`. Same exact Source
 * Granularity rule. Returns whether that classification matched.
 */
export async function isDuplicateFormLead(
  sourceCompany: ExactGranularityMatchScope,
  phoneNumber?: string | null,
  email?: string | null,
  eventTimestamp?: Date,
): Promise<boolean> {
  const match = await findDuplicateFormLeadMatch(sourceCompany, phoneNumber, email, eventTimestamp);
  return match.duplicate;
}

/**
 * Returns true when a non-duplicate Form Lead in the source scope shares the
 * supplied phone. A string scope matches `source_company`. A scope object
 * with `leadSourceCompany` matches either `lead_source_company` or
 * `source_company`. Used to set `form_fill` on a newly created Call Lead.
 */
export async function hasFormFillForCallLead(
  sourceScope: SourceCompany | LeadSourceMatchScope,
  phoneNumber?: string | null,
): Promise<boolean> {
  const FormLead = getFormLeadModel();
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  if (!normalizedPhone) {
    return false;
  }

  const candidates = await FormLead.find({
    $and: [
      buildSourceMatchFilter(sourceScope),
      { duplicate: { $ne: true } },
      { phone_number: buildPhoneRegex(normalizedPhone) },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .exec();

  return candidates.some(
    (lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
  );
}

/**
 * Flips `form_fill = true` on matching Call Leads in the source scope when a
 * new (non-duplicate) Form Lead arrives. A string scope matches
 * `source_company`. A scope object with `leadSourceCompany` matches either
 * `lead_source_company` or `source_company`.
 *
 * Returns a `source_lead` sheet-sync job for every call lead it touched so the
 * caller can persist/finalize the syncs alongside the form-lead write (inside
 * the same transaction in queued mode). When a `session` is supplied the call
 * lead writes participate in that transaction.
 *
 * Each flipped Call Lead also gets a CallLead `EntityChange` (`form_fill`) in
 * the same session (LP-03 / E13), attributed to the fixed form-fill-detector
 * system actor; the flips of one Form Lead share one `command_execution_id`.
 */
export async function markMatchingCallLeadsWithFormFill(
  sourceScope: SourceCompany | LeadSourceMatchScope,
  phoneNumber: string,
  formLeadId: string,
  session?: ClientSession,
): Promise<FullSheetSyncJob[]> {
  const CallLead = getCallLeadModel();
  const sourceCompany = getSourceCompany(sourceScope);
  const normalizedPhone = normalizePhoneNumberForMatch(phoneNumber);
  if (!normalizedPhone) {
    return [];
  }

  const candidatesQuery = CallLead.find({
    $and: [
      buildSourceMatchFilter(sourceScope),
      { form_fill: { $ne: true } },
      {
        $or: [
          { normalized_phone_number: normalizedPhone },
          { phone_number: buildPhoneRegex(normalizedPhone) },
        ],
      },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(25);
  const candidates = await (session ? candidatesQuery.session(session) : candidatesQuery).exec();

  const matchedCallLeads = candidates.filter(
    (lead) => normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
  );

  const jobs: FullSheetSyncJob[] = [];
  const now = new Date();
  const commandExecutionId = new mongoose.Types.ObjectId();
  const context =
    matchedCallLeads.length > 0
      ? systemLeadChangeContext({
          actor_id: FORM_FILL_DETECTOR_ACTOR_ID,
          command_name: "markCallLeadFormFill",
          payload: { form_lead_id: formLeadId },
        })
      : null;
  for (const callLead of matchedCallLeads) {
    const before = callLead.toObject() as Record<string, unknown>;
    callLead.form_fill = true;
    await callLead.save({ session });
    await emitLeadChange({
      model: "CallLead",
      id: callLead._id.toString(),
      before,
      paths: ["form_fill"],
      session,
      now,
      command_name: "markCallLeadFormFill",
      command_execution_id: commandExecutionId,
      context: context!,
    });
    jobs.push({
      resource: "source_lead",
      operation: "call_lead.form_fill.update",
      leadModel: "CallLead",
      leadId: callLead._id.toString(),
    });
  }

  logger.info({
    msg: "form_lead.call_lead_form_fill.updated",
    formLeadId,
    sourceCompany,
    normalizedPhone,
    matchedCallLeadCount: matchedCallLeads.length,
  });

  return jobs;
}

function getSourceCompany(sourceScope: SourceCompany | LeadSourceMatchScope): SourceCompany | string {
  return typeof sourceScope === "string" ? sourceScope : sourceScope.sourceCompany;
}

function getLeadSourceCompany(sourceScope: SourceCompany | LeadSourceMatchScope): unknown {
  return typeof sourceScope === "string" ? undefined : sourceScope.leadSourceCompany;
}

function buildSourceMatchFilter(sourceScope: SourceCompany | LeadSourceMatchScope) {
  const sourceCompany = getSourceCompany(sourceScope);
  const leadSourceCompany = getLeadSourceCompany(sourceScope);
  if (!leadSourceCompany) {
    return { source_company: sourceCompany };
  }

  return {
    $or: [
      { lead_source_company: leadSourceCompany },
      { source_company: sourceCompany },
    ],
  };
}
