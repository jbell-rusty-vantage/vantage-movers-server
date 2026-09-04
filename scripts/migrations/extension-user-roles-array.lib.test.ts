import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExtensionUserRolesArray,
  summarizeExtensionUserRolesArray,
} from "./extension-user-roles-array.lib";

test("roles-array report maps leftover singular role per spec §3.3", () => {
  const table = [
    { role: "owner", planned: ["owner"], action: "convert_owner" },
    { role: "sales", planned: ["sales"], action: "convert_sales" },
    { role: "customer_service", planned: ["customer_service"], action: "convert_customer_service" },
    { role: "employee", planned: ["sales", "customer_service"], action: "convert_employee" },
  ] as const;

  for (const row of table) {
    const plan = classifyExtensionUserRolesArray({
      email: `${row.role}@vantage.example`,
      role: row.role,
      token_version: 2,
    });
    assert.equal(plan.action, row.action);
    assert.deepEqual(plan.planned_roles, [...row.planned]);
    assert.equal(plan.will_apply, true);
    assert.equal(plan.planned_token_version, 3);
  }
});

test("already-has-roles rows do not bump token_version and will not apply", () => {
  const plan = classifyExtensionUserRolesArray({
    email: "Already@Vantage.example",
    role: "employee",
    roles: ["owner", "sales"],
    token_version: 9,
  });
  assert.equal(plan.action, "already_has_roles");
  assert.equal(plan.will_apply, false);
  assert.equal(plan.planned_token_version, 9);
  assert.deepEqual(plan.planned_roles, ["owner", "sales"]);
});

test("roles-array summary counts convert versus already-has-roles", () => {
  const plans = [
    classifyExtensionUserRolesArray({
      email: "owner@vantage.example",
      role: "owner",
      token_version: 0,
    }),
    classifyExtensionUserRolesArray({
      email: "sales@vantage.example",
      role: "sales",
      token_version: 0,
    }),
    classifyExtensionUserRolesArray({
      email: "cs@vantage.example",
      role: "customer_service",
      token_version: 0,
    }),
    classifyExtensionUserRolesArray({
      email: "legacy@vantage.example",
      role: "employee",
      token_version: 0,
    }),
    classifyExtensionUserRolesArray({
      email: "migrated@vantage.example",
      roles: ["sales"],
      token_version: 1,
    }),
  ];

  assert.deepEqual(summarizeExtensionUserRolesArray(plans), {
    total: 5,
    convert_owner: 1,
    convert_sales: 1,
    convert_customer_service: 1,
    convert_employee: 1,
    already_has_roles: 1,
    unchanged: 0,
  });
  assert.equal(plans.filter((plan) => plan.will_apply).length, 4);
});
