import { SALES_OUTREACH_LIVE_TOPICS, SALES_OUTREACH_QUEUE_FILTERS } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import type { SalesOutreachCadenceSummaryDto, SalesOutreachCapabilitiesDto } from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ConfigurationInspection } from "../config/load";
import { ROLE_CAPABILITIES } from "../permissions";

/** Desk reads this server build serves. Capabilities never advertise undeployed work. */
export const DEPLOYED_DESK_READS = ["capabilities", "rep_days", "team", "queue", "outreach_detail", "live"] as const;

/** Queue filters per role: a Rep never gets the rep or Unassigned filters (CONTRACTS, P09a/P09b). */
const COORDINATOR_QUEUE_FILTERS = SALES_OUTREACH_QUEUE_FILTERS;
const REP_QUEUE_FILTERS = SALES_OUTREACH_QUEUE_FILTERS.filter((f) => f !== "agent_id" && f !== "unassigned");

type View = SalesOutreachCapabilitiesDto["permitted_views"][number];

/**
 * Deployed commands this actor may send now (SRV-7). Desk commands (Quoted date, callback, assignment)
 * need the desk available; the Owner/Manager settings commands (day override, restrictions) need only
 * an active configuration, so a muted desk stays reversible; `configuration_edit` is always the Owner's.
 */
function permittedCommands(role: OutreachActor["role"], deskAvailable: boolean, configurationActive: boolean): string[] {
  const commands: string[] = [];
  if (deskAvailable) commands.push("quoted_followup", "callback");
  if (deskAvailable && role !== "rep") commands.push("assignment");
  if (configurationActive && role !== "rep") commands.push("day_override");
  if (role === "owner") {
    if (configurationActive) commands.push("restrictions");
    commands.push("configuration_edit");
  }
  return commands;
}

/**
 * The configured cadence any desk role may read (the reference's "New lead schedule" box), copied 1:1
 * from `cadence.*`: no interpretation, no text, no minutes. The configuration holds no Quoted
 * daily-call count, so `quoted` is null.
 */
export function cadenceSummaryOf(cadence: SalesOutreachConfigurationValue["cadence"]): SalesOutreachCadenceSummaryDto {
  return {
    policy_version: cadence.policy_version,
    new: {
      days_1_3_calls: cadence.new_days_1_3_calls ? { ...cadence.new_days_1_3_calls } : null,
      call_slots:
        cadence.new_call_slots?.map((band) => ({ from_day: band.from_day, to_day: band.to_day, calls_per_day: band.deadline_minutes.length })) ??
        null,
      sms_sequence: cadence.sms_sequence
        ? {
            initial_days: [...cadence.sms_sequence.initial_days],
            repeat_from_day: cadence.sms_sequence.repeat_from_day,
            repeat_every_days: cadence.sms_sequence.repeat_every_days,
          }
        : null,
    },
    quoted: null,
  };
}

/**
 * `GET /capabilities` body (CONTRACTS "HTTP interface"; IMPLEMENTATION-PLAN §5, IMPL-02).
 *
 * The Owner keeps Settings (configuration GET/PATCH) and the existing Numbers/Accounts views even
 * while the desk is disabled or its configuration is broken, so a disable stays reversible. Every
 * other view and filter needs an active configuration with `controls.desk_enabled`. Controls are
 * the safe effective booleans only; a broken or missing configuration reports them all false.
 *
 * Activity (read-only history composed from the queue and outreach view) opens for every desk role
 * with the desk. A Manager's Settings is attendance only (its `day_override` command), so it follows
 * the active configuration like that command; a Rep has no Settings. `cadence_summary` is served to
 * every role whenever the configuration is active, even with the desk off.
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
  if (available) views.push(...(coordinator ? (["team", "my", "activity"] as const) : (["my", "activity"] as const)));
  if (actor.role === "owner") views.push("settings", "numbers", "accounts");
  if (actor.role === "manager" && active) views.push("settings");

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
      queue: available ? [...(coordinator ? COORDINATOR_QUEUE_FILTERS : REP_QUEUE_FILTERS)] : [],
    },
    // Configuration invalidation reaches every desk role (it is how a muted desk is noticed).
    live_topics: available ? [...SALES_OUTREACH_LIVE_TOPICS] : ["outreach_configuration"],
    permitted_commands: permittedCommands(actor.role, available, inspected.state === "active"),
    role_capabilities: [...ROLE_CAPABILITIES[actor.role]].sort(),
    deployed_reads: [...DEPLOYED_DESK_READS],
    cadence_summary: active ? cadenceSummaryOf(active.value.cadence) : null,
  };
}
