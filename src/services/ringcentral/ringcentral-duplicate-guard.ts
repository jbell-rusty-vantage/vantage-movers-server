import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { SourceCompany } from "../../config/domain";
import type { ClientSession, Types } from "mongoose";

export const RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Business duplicate rule for RingCentral call leads.
 *
 * Criteria from the owner: a successful (qualified) inbound call should be
 * flagged `duplicate: true` when the *same caller phone* for the *same source
 * company* already produced a call lead within 90 days of the current call's
 * persisted lead timestamp. Duplicates are still recorded for visibility but
 * are zero-CPL so the owner avoids paying twice for the same caller.
 *
 * This is distinct from idempotency: the unique `telephony_session_id` index
 * prevents the *same call* from creating two leads. This guard prevents a
 * *different call from the same caller/source* inflating lead spend.
 */
export type RingCentralDuplicateClassification = {
  isDuplicate: boolean;
  reason:
    | "no_caller_phone"
    | "unique"
    | "same_source_phone_within_window";
  existingLeadId: string | null;
  windowDays: number;
  matchCount: number;
};

export type RingCentralDuplicateInput = {
  sourceCompany: SourceCompany;
  leadSourceCompany?: unknown;
  sourceGranularityId: string | Types.ObjectId;
  callerPhoneNumber: string | null;
  /** The current call's session id, excluded from the match (it is itself). */
  telephonySessionId?: string | null;
  sessionId?: string | null;
  callLogId?: string | null;
  /** Adopted target Lead, excluded so the physical call cannot duplicate itself. */
  callLeadIdToExclude?: string | null;
  /** Business timestamp for the current call, before CallLead persistence normalization. */
  callTimestamp?: Date;
  session?: ClientSession;
};

type RecentCallLead = {
  _id: { toString(): string };
  phone_number?: string | null;
  ingestion_origin?: string | null;
  ringcentral_convergence?: { state?: string | null } | null;
  ringcentral?: {
    telephony_session_id?: string | null;
    session_id?: string | null;
    call_log_id?: string | null;
  } | null;
};

export type RingCentralDuplicateDeps = {
  findRecentCallLeads: (params: {
    sourceCompany: SourceCompany;
    sourceGranularityId: string | Types.ObjectId;
    normalizedPhone: string;
    from: Date;
    to: Date;
    callLeadIdToExclude?: string | null;
    session?: ClientSession;
  }) => Promise<RecentCallLead[]>;
};

const defaultDeps: RingCentralDuplicateDeps = {
  async findRecentCallLeads({
    sourceGranularityId,
    normalizedPhone,
    from,
    to,
    callLeadIdToExclude,
    session,
  }) {
    return CallLead.find({
      source_granularity_id: sourceGranularityId,
      duplicate: { $ne: true },
      normalized_phone_number: normalizedPhone,
      timestamp: { $gte: from, $lt: to },
      ...(callLeadIdToExclude
        ? { _id: { $ne: callLeadIdToExclude } }
        : {}),
      $nor: [
        {
          ingestion_origin: "granot_lead_created",
          "ringcentral_convergence.state": { $in: ["pending", "conflict"] },
          "ringcentral.telephony_session_id": { $in: [null, ""] },
          "ringcentral.session_id": { $in: [null, ""] },
          "ringcentral.call_log_id": { $in: [null, ""] },
        },
      ],
    })
      .session(session ?? null)
      .sort({ timestamp: -1 })
      .lean()
      .exec() as unknown as Promise<RecentCallLead[]>;
  },
};

export async function classifyRingCentralCallLeadDuplicate(
  input: RingCentralDuplicateInput,
  deps: RingCentralDuplicateDeps = defaultDeps,
): Promise<RingCentralDuplicateClassification> {
  if (!input.sourceGranularityId) {
    throw new Error("Call Lead duplicate classification requires an exact Source Granularity");
  }
  const normalizedPhone = normalizePhoneNumberForMatch(input.callerPhoneNumber);
  if (!normalizedPhone) {
    return {
      isDuplicate: false,
      reason: "no_caller_phone",
      existingLeadId: null,
      windowDays: RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS,
      matchCount: 0,
    };
  }

  const callTimestamp = toFloridaTimestamp(input.callTimestamp ?? new Date());
  const windowMs = RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS * MS_PER_DAY;
  const from = new Date(callTimestamp.getTime() - windowMs);
  const to = callTimestamp;
  const candidates = await deps.findRecentCallLeads({
    sourceCompany: input.sourceCompany,
    sourceGranularityId: input.sourceGranularityId,
    normalizedPhone,
    from,
    to,
    callLeadIdToExclude: input.callLeadIdToExclude,
    session: input.session,
  });

  const matches = candidates.filter(
    (lead) =>
      normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone &&
      lead._id.toString() !== input.callLeadIdToExclude &&
      !isUnresolvedGranotCandidate(lead) &&
      (input.telephonySessionId
        ? lead.ringcentral?.telephony_session_id !== input.telephonySessionId
        : true) &&
      (input.sessionId
        ? lead.ringcentral?.session_id !== input.sessionId
        : true) &&
      (input.callLogId
        ? lead.ringcentral?.call_log_id !== input.callLogId
        : true),
  );

  if (matches.length === 0) {
    return {
      isDuplicate: false,
      reason: "unique",
      existingLeadId: null,
      windowDays: RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS,
      matchCount: 0,
    };
  }

  return {
    isDuplicate: true,
    reason: "same_source_phone_within_window",
    existingLeadId: matches[0]!._id.toString(),
    windowDays: RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS,
    matchCount: matches.length,
  };
}

function isUnresolvedGranotCandidate(lead: RecentCallLead): boolean {
  const state = lead.ringcentral_convergence?.state;
  const unresolved =
    lead.ingestion_origin === "granot_lead_created" &&
    (state === "pending" || state === "conflict");
  if (!unresolved) return false;
  return !(
    lead.ringcentral?.telephony_session_id ||
    lead.ringcentral?.session_id ||
    lead.ringcentral?.call_log_id
  );
}
