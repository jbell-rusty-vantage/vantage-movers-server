import { csiRetentionDays } from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { resolvePolicy } from "./policy";

/**
 * Days Call activity is kept before retention purges it. The persisted Owner policy
 * (`retention.audit_days`) wins; the env default applies when no policy is installed.
 */
export async function resolveActivityRetentionDays(): Promise<number> {
  if (!await getSalesIntelligencePolicyPointerModel().exists({ key: "active" })) return csiRetentionDays().activity_days;
  return (await resolvePolicy()).retention.audit_days;
}
