import {
  resolveStoredExtensionRoles,
  type CurrentExtensionRole,
} from "../../src/auth/extension/roles";

export const EXTENSION_USER_ROLES_ARRAY_VERSION = "extension-user-roles-array/1";

export type ExtensionUserRolesArrayRow = {
  email: string;
  role?: unknown;
  roles?: unknown;
  token_version: number;
};

export type ExtensionUserRolesArrayAction =
  | "convert_owner"
  | "convert_sales"
  | "convert_customer_service"
  | "convert_employee"
  | "already_has_roles"
  | "unchanged";

export type ExtensionUserRolesArrayPlan = {
  email: string;
  current_role: string | null;
  current_roles: CurrentExtensionRole[] | null;
  planned_roles: CurrentExtensionRole[] | null;
  token_version: number;
  planned_token_version: number;
  action: ExtensionUserRolesArrayAction;
  will_apply: boolean;
};

export function classifyExtensionUserRolesArray(
  row: ExtensionUserRolesArrayRow,
): ExtensionUserRolesArrayPlan {
  const email = row.email.trim().toLowerCase();
  const token_version = row.token_version;
  const current_role = typeof row.role === "string" ? row.role : null;
  const existingRoles = resolveStoredExtensionRoles({ roles: row.roles });
  if (existingRoles) {
    return {
      email,
      current_role,
      current_roles: existingRoles,
      planned_roles: existingRoles,
      token_version,
      planned_token_version: token_version,
      action: "already_has_roles",
      will_apply: false,
    };
  }

  const planned = resolveStoredExtensionRoles({ role: row.role });
  if (!planned) {
    return {
      email,
      current_role,
      current_roles: null,
      planned_roles: null,
      token_version,
      planned_token_version: token_version,
      action: "unchanged",
      will_apply: false,
    };
  }

  const action = actionForLeftoverRole(current_role);
  return {
    email,
    current_role,
    current_roles: null,
    planned_roles: planned,
    token_version,
    planned_token_version: token_version + 1,
    action,
    will_apply: true,
  };
}

export function summarizeExtensionUserRolesArray(
  plans: ExtensionUserRolesArrayPlan[],
): Record<ExtensionUserRolesArrayAction | "total", number> {
  return {
    total: plans.length,
    convert_owner: plans.filter((plan) => plan.action === "convert_owner").length,
    convert_sales: plans.filter((plan) => plan.action === "convert_sales").length,
    convert_customer_service: plans.filter(
      (plan) => plan.action === "convert_customer_service",
    ).length,
    convert_employee: plans.filter((plan) => plan.action === "convert_employee").length,
    already_has_roles: plans.filter((plan) => plan.action === "already_has_roles").length,
    unchanged: plans.filter((plan) => plan.action === "unchanged").length,
  };
}

function actionForLeftoverRole(role: string | null): ExtensionUserRolesArrayAction {
  if (role === "owner") return "convert_owner";
  if (role === "sales") return "convert_sales";
  if (role === "customer_service") return "convert_customer_service";
  if (role === "employee") return "convert_employee";
  return "unchanged";
}
