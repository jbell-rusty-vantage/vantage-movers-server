import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExtensionUserRoleBackfill,
  LEAVE_AS_EMPLOYEE_EMAILS,
  LEAVE_AS_OWNER_EMAILS,
  SALES_BACKFILL_EMAILS,
  summarizeExtensionUserRoleBackfill,
} from "./extension-user-roles-sales-backfill.lib";

test("sales backfill remaps the three production Employee emails and increments token_version", () => {
  const plans = SALES_BACKFILL_EMAILS.map((email) =>
    classifyExtensionUserRoleBackfill({
      email: email.toUpperCase(),
      role: "employee",
      token_version: 4,
    }),
  );

  assert.deepEqual(
    plans.map((plan) => ({
      email: plan.email,
      planned_role: plan.planned_role,
      planned_token_version: plan.planned_token_version,
      will_apply: plan.will_apply,
    })),
    SALES_BACKFILL_EMAILS.map((email) => ({
      email,
      planned_role: "sales",
      planned_token_version: 5,
      will_apply: true,
    })),
  );
});

test("sales backfill is a no-op when those emails are already Sales", () => {
  const plan = classifyExtensionUserRoleBackfill({
    email: SALES_BACKFILL_EMAILS[0],
    role: "sales",
    token_version: 2,
  });
  assert.equal(plan.action, "already_sales");
  assert.equal(plan.will_apply, false);
  assert.equal(plan.planned_token_version, 2);
});

test("sales backfill leaves jbell, kylm, and ringram unchanged", () => {
  const leftover = [
    ...LEAVE_AS_EMPLOYEE_EMAILS.map((email) =>
      classifyExtensionUserRoleBackfill({
        email,
        role: "employee",
        token_version: 1,
      }),
    ),
    ...LEAVE_AS_OWNER_EMAILS.map((email) =>
      classifyExtensionUserRoleBackfill({
        email,
        role: "owner",
        token_version: 7,
      }),
    ),
  ];

  assert.deepEqual(
    leftover.map((plan) => plan.action),
    ["leave_employee", "leave_employee", "leave_owner"],
  );
  assert.equal(leftover.every((plan) => plan.will_apply === false), true);
});

test("sales backfill summary counts remap versus leave-alone rows", () => {
  const summary = summarizeExtensionUserRoleBackfill([
    classifyExtensionUserRoleBackfill({
      email: SALES_BACKFILL_EMAILS[0],
      role: "employee",
      token_version: 0,
    }),
    classifyExtensionUserRoleBackfill({
      email: LEAVE_AS_EMPLOYEE_EMAILS[0],
      role: "employee",
      token_version: 0,
    }),
    classifyExtensionUserRoleBackfill({
      email: LEAVE_AS_OWNER_EMAILS[0],
      role: "owner",
      token_version: 0,
    }),
    classifyExtensionUserRoleBackfill({
      email: "other@vantagehomemovers.com",
      role: "customer_service",
      token_version: 0,
    }),
  ]);

  assert.deepEqual(summary, {
    total: 4,
    remap_employee_to_sales: 1,
    already_sales: 0,
    leave_employee: 1,
    leave_owner: 1,
    unchanged: 1,
  });
});
