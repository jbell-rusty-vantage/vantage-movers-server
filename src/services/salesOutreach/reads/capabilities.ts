import type { SalesOutreachCapabilitiesDto } from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ConfigurationInspection } from "../config/load";
import { ROLE_CAPABILITIES } from "../permissions";

/** Desk reads this server build serves (phase 2 / M1). Capabilities never advertise undeployed work. */
export const DEPLOYED_DESK_READS = ["capabilities", "rep_days", "team"] as const;

type View = SalesOutreachCapabilitiesDto["permitted_views"][number];

/**
 * `GET /capabilities` body (CONTRACTS "HTTP interface"; IMPLEMENTATION-PLAN §5, IMPL-02).
 *
 * The Owner keeps Settings (configuration GET/PATCH) and the existing Numbers/Accounts views even
 * while the desk is disabled or its configuration is broken, so a disable stays reversible. Every
 * other view and filter needs an active configuration with `controls.desk_enabled`. Controls are
 * the safe effective booleans only; a broken or missing configuration reports them all false.
 */
export function composeCapabilities(
  actor: OutreachActor,
  inspected: ConfigurationInspection,
  base: Pick<SalesOutreachCapabilitiesDto, "contract_version" | "as_of" | "timezone" | "scope">,
): SalesOutreachCapabilitiesDto {
  const active = inspected.state === "active" ? inspected : null;
  const controls = {
    desk_enabled: active?.value.controls.desk_enabled ?? false,
    goal_metrics_enabled: active?.value.controls.goal_metrics_enabled ?? false,
    rep_sms_capture_enabled: active?.value.controls.rep_sms_capture_enabled ?? false,
    cadence_shadow_enabled: active?.value.controls.cadence_shadow_enabled ?? false,
    cadence_enforcement_enabled: active?.value.controls.cadence_enforcement_enabled ?? false,
    intake_admission_enabled: active?.value.transition.intake_admission_enabled ?? false,
  };
  const unavailable_reason =
    inspected.state === "uninitialized"
      ? "configuration_uninitialized"
      : inspected.state === "unavailable"
        ? "configuration_unavailable"
        : controls.desk_enabled
          ? null
          : "desk_disabled";
  const available = unavailable_reason === null;
  const coordinator = actor.role === "owner" || actor.role === "manager";

  const views: View[] = [];
  if (available) views.push(...(coordinator ? (["team", "my"] as const) : (["my"] as const)));
  if (actor.role === "owner") views.push("settings", "numbers", "accounts");

  return {
    ...base,
    configuration_state: inspected.state,
    configuration_version: inspected.state === "uninitialized" ? null : inspected.version,
    configuration_revision: inspected.state === "uninitialized" ? 0 : inspected.revision,
    controls,
    desk_available: available,
    unavailable_reason,
    permitted_views: views,
    permitted_filters: {
      rep_days: available ? (coordinator ? ["business_day", "agent_id"] : ["business_day"]) : [],
      team: available && coordinator ? ["business_day"] : [],
    },
    permitted_commands: actor.role === "owner" ? ["configuration_edit"] : [],
    role_capabilities: [...ROLE_CAPABILITIES[actor.role]].sort(),
    deployed_reads: [...DEPLOYED_DESK_READS],
  };
}
