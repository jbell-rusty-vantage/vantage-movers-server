export const CURRENT_EXTENSION_ROLES = ["owner", "sales", "customer_service"] as const;
export type CurrentExtensionRole = (typeof CURRENT_EXTENSION_ROLES)[number];

const LEFTOVER_EMPLOYEE_ROLES: CurrentExtensionRole[] = ["sales", "customer_service"];

export function isCurrentExtensionRole(value: unknown): value is CurrentExtensionRole {
  return (
    typeof value === "string" &&
    (CURRENT_EXTENSION_ROLES as readonly string[]).includes(value)
  );
}

export function normalizeExtensionRoles(input: unknown): CurrentExtensionRole[] | null {
  if (!Array.isArray(input) || input.length === 0) {
    return null;
  }

  const unique = new Set<CurrentExtensionRole>();
  for (const value of input) {
    if (!isCurrentExtensionRole(value)) {
      return null;
    }
    unique.add(value);
  }

  if (unique.size === 0) {
    return null;
  }

  return CURRENT_EXTENSION_ROLES.filter((role) => unique.has(role));
}

export function resolveStoredExtensionRoles(doc: {
  roles?: unknown;
  role?: unknown;
}): CurrentExtensionRole[] | null {
  if (Array.isArray(doc.roles) && doc.roles.length > 0) {
    return normalizeExtensionRoles(doc.roles);
  }

  if (doc.role === "employee") {
    return [...LEFTOVER_EMPLOYEE_ROLES];
  }

  if (isCurrentExtensionRole(doc.role)) {
    return [doc.role];
  }

  return null;
}

export function hasExtensionRole(
  roles: readonly CurrentExtensionRole[],
  role: CurrentExtensionRole,
): boolean {
  return roles.includes(role);
}

export function rolesSetsEqual(
  a: readonly CurrentExtensionRole[],
  b: readonly CurrentExtensionRole[],
): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const role of setA) {
    if (!setB.has(role)) {
      return false;
    }
  }
  return true;
}

export function formatTariffActorRole(
  roles: readonly CurrentExtensionRole[],
): "owner" | "sales" | "customer_service" | "sales+customer_service" {
  if (hasExtensionRole(roles, "owner")) {
    return "owner";
  }

  const hasSales = hasExtensionRole(roles, "sales");
  const hasCustomerService = hasExtensionRole(roles, "customer_service");
  if (hasSales && hasCustomerService) {
    return "sales+customer_service";
  }
  if (hasSales) {
    return "sales";
  }
  if (hasCustomerService) {
    return "customer_service";
  }

  return "sales";
}
