import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { SourceCompany } from "../../config/domain";

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
  callerPhoneNumber: string | null;
  /** The current call's session id, excluded from the match (it is itself). */
  telephonySessionId?: string | null;
  /** Business timestamp for the current call, before CallLead persistence normalization. */
  callTimestamp?: Date;
};

type RecentCallLead = {
  _id: { toString(): string };
  phone_number?: string | null;
  ringcentral?: { telephony_session_id?: string | null } | null;
};

export type RingCentralDuplicateDeps = {
  findRecentCallLeads: (params: {
    sourceCompany: SourceCompany;
    leadSourceCompany?: unknown;
    normalizedPhone: string;
    from: Date;
    to: Date;
  }) => Promise<RecentCallLead[]>;
};

const defaultDeps: RingCentralDuplicateDeps = {
  async findRecentCallLeads({
    sourceCompany,
    leadSourceCompany,
    normalizedPhone,
    from,
    to,
  }) {
    return CallLead.find({
      ...(leadSourceCompany
        ? {
            $or: [
              { lead_source_company: leadSourceCompany },
              { source_company: sourceCompany },
            ],
          }
        : { source_company: sourceCompany }),
      duplicate: { $ne: true },
      normalized_phone_number: normalizedPhone,
      timestamp: { $gte: from, $lte: to },
    })
      .sort({ timestamp: -1 })
      .limit(25)
      .lean()
      .exec() as unknown as Promise<RecentCallLead[]>;
  },
};

export async function classifyRingCentralCallLeadDuplicate(
  input: RingCentralDuplicateInput,
  deps: RingCentralDuplicateDeps = defaultDeps,
): Promise<RingCentralDuplicateClassification> {
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
  const to = new Date(callTimestamp.getTime() + windowMs);
  const candidates = await deps.findRecentCallLeads({
    sourceCompany: input.sourceCompany,
    leadSourceCompany: input.leadSourceCompany,
    normalizedPhone,
    from,
    to,
  });

  const matches = candidates.filter(
    (lead) =>
      normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone &&
      (input.telephonySessionId
        ? lead.ringcentral?.telephony_session_id !== input.telephonySessionId
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
