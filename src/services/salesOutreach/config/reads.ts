import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import {
  CADENCE_REQUIRED_FOR_ACTIVATION,
  EVIDENCE_REQUIRED_FOR_ACTIVATION,
  GOALS_REQUIRED_FOR_ACTIVATION,
  salesOutreachConfigurationValueSchema,
  type SalesOutreachConfigurationValue,
} from "../../../validation/v1/salesOutreach";
import { salesOutreachConfigurationLoader, type ConfigurationLoader } from "./load";

/**
 * Pending-activation reasons shown beside the configuration (CONTRACTS: "validation errors, …
 * pending activation reasons"). They are informational: a PATCH that would enable a control
 * without its required values is already rejected by the strict schema.
 */
export function configurationActivationBlockers(value: SalesOutreachConfigurationValue): string[] {
  const blockers: string[] = [];
  const incomplete = (record: Record<string, unknown>, keys: readonly string[]) => keys.some((key) => record[key] === null);
  if (incomplete(value.cadence, CADENCE_REQUIRED_FOR_ACTIVATION)) blockers.push("cadence_policy_incomplete");
  if (incomplete(value.evidence, EVIDENCE_REQUIRED_FOR_ACTIVATION)) blockers.push("evidence_policy_incomplete");
  if (incomplete(value.goals, GOALS_REQUIRED_FOR_ACTIVATION)) blockers.push("goal_roster_incomplete");
  if (value.cadence.sms_mode !== null && !value.controls.rep_sms_capture_enabled) blockers.push("rep_sms_capture_disabled");
  if (value.migration.paused) blockers.push("migration_paused");
  if (!value.transition.intake_admission_enabled) blockers.push("intake_admission_disabled");
  return blockers;
}

/**
 * GET /configuration (Owner). Never initializes or writes. `uninitialized` shows the CONTRACTS
 * bootstrap defaults at revision 0 so the Owner can install a first version; `unavailable` keeps
 * the pointer revision visible (value null) so the Owner can repair it with a PATCH.
 */
export async function readSalesOutreachConfiguration(loader: ConfigurationLoader = salesOutreachConfigurationLoader, now = new Date()) {
  const inspected = await loader.inspect();
  const base = { contract_version: SALES_OUTREACH_CONTRACT_VERSION, as_of: now.toISOString(), timezone: SALES_OUTREACH_TIMEZONE };
  if (inspected.state === "uninitialized") {
    const value = salesOutreachConfigurationValueSchema.parse({});
    return {
      ...base,
      configuration_state: "uninitialized" as const,
      revision: 0,
      version: null,
      content_hash: null,
      approval_ref: null,
      updated_at: null,
      updated_by: null,
      unavailable_reason: null,
      value,
      activation_blockers: configurationActivationBlockers(value),
    };
  }
  if (inspected.state === "unavailable") {
    return {
      ...base,
      configuration_state: "unavailable" as const,
      revision: inspected.revision,
      version: inspected.version,
      content_hash: null,
      approval_ref: null,
      updated_at: inspected.updated_at?.toISOString() ?? null,
      updated_by: inspected.updated_by,
      unavailable_reason: inspected.reason,
      value: null,
      activation_blockers: ["configuration_unavailable"],
    };
  }
  return {
    ...base,
    configuration_state: "active" as const,
    revision: inspected.revision,
    version: inspected.version,
    content_hash: inspected.content_hash,
    approval_ref: inspected.approval_ref,
    updated_at: inspected.updated_at?.toISOString() ?? null,
    updated_by: inspected.updated_by,
    unavailable_reason: null,
    value: inspected.value,
    activation_blockers: configurationActivationBlockers(inspected.value),
  };
}
