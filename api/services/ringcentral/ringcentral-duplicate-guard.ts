import { CallLead } from "../../models/CallLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { SourceCompany } from "./call-lead-sources";
import { getRingCentralDuplicateWindowHours } from "./ringcentral-config";

/**
 * Business duplicate rule for RingCentral call leads.
 *
 * Criteria from the owner: a successful (qualified) inbound call should be
 * flagged `duplicate: true` when the *same caller phone* for the *same source
 * company* already produced a call lead within the duplicate window (default
 * 24h). Duplicates are still recorded for visibility but are zero-CPL so the
 * owner avoids paying twice for the same caller.
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
  windowHours: number;
  matchCount: number;
};

export type RingCentralDuplicateInput = {
  sourceCompany: SourceCompany;
  callerPhoneNumber: string | null;
  /** The current call's session id, excluded from the match (it is itself). */
  telephonySessionId?: string | null;
  now?: Date;
};

type RecentCallLead = {
  _id: { toString(): string };
  phone_number?: string | null;
  ringcentral?: { telephony_session_id?: string | null } | null;
};

export type RingCentralDuplicateDeps = {
  findRecentCallLeads: (params: {
    sourceCompany: SourceCompany;
    normalizedPhone: string;
    since: Date;
  }) => Promise<RecentCallLead[]>;
};

const defaultDeps: RingCentralDuplicateDeps = {
  async findRecentCallLeads({ sourceCompany, normalizedPhone, since }) {
    return CallLead.find({
      source_company: sourceCompany,
      duplicate: { $ne: true },
      normalized_phone_number: normalizedPhone,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean()
      .exec() as unknown as Promise<RecentCallLead[]>;
  },
};

export async function classifyRingCentralCallLeadDuplicate(
  input: RingCentralDuplicateInput,
  deps: RingCentralDuplicateDeps = defaultDeps,
): Promise<RingCentralDuplicateClassification> {
  const windowHours = getRingCentralDuplicateWindowHours();
  const normalizedPhone = normalizePhoneNumberForMatch(input.callerPhoneNumber);
  if (!normalizedPhone) {
    return {
      isDuplicate: false,
      reason: "no_caller_phone",
      existingLeadId: null,
      windowHours,
      matchCount: 0,
    };
  }

  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const candidates = await deps.findRecentCallLeads({
    sourceCompany: input.sourceCompany,
    normalizedPhone,
    since,
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
      windowHours,
      matchCount: 0,
    };
  }

  return {
    isDuplicate: true,
    reason: "same_source_phone_within_window",
    existingLeadId: matches[0]!._id.toString(),
    windowHours,
    matchCount: matches.length,
  };
}
