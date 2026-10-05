import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { SALES_OUTREACH_ROLES } from "../../config/domain/salesOutreach";
import { TRUSTED_ADMIN_ACTOR_ROLES, APPROVED_REGISTRY_READ_ROLES } from "../operationsRegistry/trustedActorCanonical";
import { MANAGER_CAPABILITIES, OWNER_ONLY_CAPABILITIES, ROLE_CAPABILITIES, rolesWithCapability, type OutreachCapability } from "./permissions";

const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "../../../docs/sales-outreach-desk/contracts/fixtures", name), "utf8")) as T;

test("fixture p09b: Manager holds exactly the approved coordination set and no Owner-only control", () => {
  const p09b = fixture<{ manager_allowed: string[]; owner_only: string[]; rep_scope_expanded: boolean }>("p09b-manager-permissions.json");
  assert.deepEqual([...MANAGER_CAPABILITIES].sort(), [...p09b.manager_allowed].sort());
  for (const capability of p09b.manager_allowed) assert.ok(ROLE_CAPABILITIES.manager.has(capability as OutreachCapability), capability);
  for (const capability of p09b.owner_only) {
    assert.ok((OWNER_ONLY_CAPABILITIES as readonly string[]).includes(capability), capability);
    assert.equal(ROLE_CAPABILITIES.manager.has(capability as OutreachCapability), false, capability);
    assert.equal(ROLE_CAPABILITIES.rep.has(capability as OutreachCapability), false, capability);
    assert.deepEqual(rolesWithCapability(capability as OutreachCapability), ["owner"], capability);
  }
  // Daily Operations access is a Manager capability; the Rep never gets team or Unassigned reads.
  assert.deepEqual(rolesWithCapability("daily_operations_access"), ["owner", "manager"]);
  assert.equal(p09b.rep_scope_expanded, false);
  for (const capability of ["team_reads", "individual_rep_filter", "unassigned_reads", "assign_reassign", "prospective_absence_override"] as const)
    assert.equal(ROLE_CAPABILITIES.rep.has(capability), false, capability);
});

test("fixture p09c: Admin means Owner; a generic admin is not a desk role and is never elevated", () => {
  const p09c = fixture<{ admin_means_owner_in_feature: boolean; generic_admin_automatically_elevated: boolean; rep_scope: string; manager_permissions: string }>(
    "p09c-admin-owner-role.json",
  );
  assert.equal(p09c.admin_means_owner_in_feature, true);
  assert.equal(p09c.generic_admin_automatically_elevated, false);
  assert.deepEqual([...SALES_OUTREACH_ROLES], ["owner", "manager", "rep"]);
  assert.equal((SALES_OUTREACH_ROLES as readonly string[]).includes("admin"), false);
  // Owner holds every capability any role holds.
  for (const role of SALES_OUTREACH_ROLES)
    for (const capability of ROLE_CAPABILITIES[role]) assert.ok(ROLE_CAPABILITIES.owner.has(capability), `${role}:${capability}`);
  assert.equal(p09c.rep_scope, "current_assignment_only");
  assert.deepEqual([...ROLE_CAPABILITIES.rep].sort(), ["explicit_callback_commands", "own_assigned_reads", "quoted_date_commands"]);
  // Signing a manager grants nothing on the registry.
  assert.ok((TRUSTED_ADMIN_ACTOR_ROLES as readonly string[]).includes("manager"));
  assert.equal((APPROVED_REGISTRY_READ_ROLES as readonly string[]).includes("manager"), false);
});
