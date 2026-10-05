import type { SalesOutreachRole } from "../../config/domain/salesOutreach";

/**
 * Desk capabilities per role (P09a/P09b/P09c, CONTRACTS "HTTP interface"). Routes declare the
 * capability they need; the guard admits the roles that hold it. A Rep's commands are further
 * limited to its current assignment by the service, never by this table.
 *
 * Owner holds everything (P09c: "Admin" in this feature means the Owner). Manager holds the P09b
 * coordination set and never an Owner-only control. Generic `admin` is not a desk role.
 */
export const MANAGER_CAPABILITIES = [
  "team_reads",
  "individual_rep_filter",
  "unassigned_reads",
  "assign_reassign",
  "quoted_date_commands",
  "explicit_callback_commands",
  "prospective_absence_override",
  "prospective_partial_day_override",
  "daily_operations_access",
] as const;

export const OWNER_ONLY_CAPABILITIES = [
  "base_goal_edits",
  "roster_edits",
  "work_schedule_edits",
  "cadence_policy_edits",
  "lift_contact_restriction",
  "override_authoritative_closure",
  "historical_responsibility_goal_setting_edits",
  "activation",
  "migration",
  "rollback",
  // CONTRACTS: only the Owner may GET/PATCH the full configuration.
  "configuration_read",
  "configuration_edit",
] as const;

/** A Rep reads and plans only its current assigned Leads. */
export const REP_CAPABILITIES = ["own_assigned_reads", "quoted_date_commands", "explicit_callback_commands"] as const;

export type OutreachCapability =
  | (typeof MANAGER_CAPABILITIES)[number]
  | (typeof OWNER_ONLY_CAPABILITIES)[number]
  | (typeof REP_CAPABILITIES)[number];

const OWNER: ReadonlySet<OutreachCapability> = new Set<OutreachCapability>([
  ...MANAGER_CAPABILITIES,
  ...OWNER_ONLY_CAPABILITIES,
  "own_assigned_reads",
]);

export const ROLE_CAPABILITIES: Readonly<Record<SalesOutreachRole, ReadonlySet<OutreachCapability>>> = {
  owner: OWNER,
  manager: new Set<OutreachCapability>([...MANAGER_CAPABILITIES, "own_assigned_reads"]),
  rep: new Set<OutreachCapability>(REP_CAPABILITIES),
};

export function rolesWithCapability(capability: OutreachCapability): SalesOutreachRole[] {
  return (Object.keys(ROLE_CAPABILITIES) as SalesOutreachRole[]).filter((role) => ROLE_CAPABILITIES[role].has(capability));
}
