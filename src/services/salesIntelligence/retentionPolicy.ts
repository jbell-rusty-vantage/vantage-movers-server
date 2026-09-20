import { csiRetentionDays } from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { resolvePolicy } from "./policy";

export type RetentionDayPolicy = {
  audio_days: number;
  redacted_days: number;
  activity_days: number;
};

/** Persisted Owner policy wins; env defaults apply when no pointer exists. */
export async function resolveRetentionDays(): Promise<RetentionDayPolicy> {
  if (!await getSalesIntelligencePolicyPointerModel().exists({ key: "active" })) return csiRetentionDays();
  {
    const policy = await resolvePolicy();
    return {
      audio_days: policy.retention.audio_days,
      redacted_days: policy.retention.redacted_days,
      activity_days: policy.retention.audit_days,
    };
  }
}
