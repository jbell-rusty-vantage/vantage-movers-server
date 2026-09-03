export const EXTENSION_USER_ROLES_SALES_BACKFILL_VERSION =
  "extension-user-roles-sales-backfill/1";

export const SALES_BACKFILL_EMAILS = [
  "kylem@vantagehomemovers.com",
  "garye@vantagehomemovers.com",
  "brianh@vantagehomemovers.com",
] as const;

export const LEAVE_AS_EMPLOYEE_EMAILS = [
  "jbell@vantagehomemovers.com",
  "kylm@vantagehomemovers.com",
] as const;

export const LEAVE_AS_OWNER_EMAILS = ["ringram@vantagehomemovers.com"] as const;

export type ExtensionUserRoleBackfillRow = {
  email: string;
  role: string;
  token_version: number;
};

export type ExtensionUserRoleBackfillAction =
  | "remap_employee_to_sales"
  | "already_sales"
  | "leave_employee"
  | "leave_owner"
  | "unchanged";

export type ExtensionUserRoleBackfillPlan = {
  email: string;
  current_role: string;
  planned_role: string;
  token_version: number;
  planned_token_version: number;
  action: ExtensionUserRoleBackfillAction;
  will_apply: boolean;
};

function hasEmail(list: readonly string[], email: string): boolean {
  return list.includes(email);
}

export function classifyExtensionUserRoleBackfill(
  row: ExtensionUserRoleBackfillRow,
): ExtensionUserRoleBackfillPlan {
  const email = row.email.trim().toLowerCase();
  const current_role = row.role;
  const token_version = row.token_version;

  if (hasEmail(SALES_BACKFILL_EMAILS, email)) {
    if (current_role === "employee") {
      return {
        email,
        current_role,
        planned_role: "sales",
        token_version,
        planned_token_version: token_version + 1,
        action: "remap_employee_to_sales",
        will_apply: true,
      };
    }
    if (current_role === "sales") {
      return {
        email,
        current_role,
        planned_role: "sales",
        token_version,
        planned_token_version: token_version,
        action: "already_sales",
        will_apply: false,
      };
    }
  }

  if (hasEmail(LEAVE_AS_EMPLOYEE_EMAILS, email)) {
    return {
      email,
      current_role,
      planned_role: current_role,
      token_version,
      planned_token_version: token_version,
      action: "leave_employee",
      will_apply: false,
    };
  }

  if (hasEmail(LEAVE_AS_OWNER_EMAILS, email)) {
    return {
      email,
      current_role,
      planned_role: current_role,
      token_version,
      planned_token_version: token_version,
      action: "leave_owner",
      will_apply: false,
    };
  }

  return {
    email,
    current_role,
    planned_role: current_role,
    token_version,
    planned_token_version: token_version,
    action: "unchanged",
    will_apply: false,
  };
}

export function summarizeExtensionUserRoleBackfill(
  plans: ExtensionUserRoleBackfillPlan[],
): Record<ExtensionUserRoleBackfillAction | "total", number> {
  return {
    total: plans.length,
    remap_employee_to_sales: plans.filter(
      (plan) => plan.action === "remap_employee_to_sales",
    ).length,
    already_sales: plans.filter((plan) => plan.action === "already_sales").length,
    leave_employee: plans.filter((plan) => plan.action === "leave_employee").length,
    leave_owner: plans.filter((plan) => plan.action === "leave_owner").length,
    unchanged: plans.filter((plan) => plan.action === "unchanged").length,
  };
}
