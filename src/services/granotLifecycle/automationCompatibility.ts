import type { GranotLifecycleDisposition, LeadModel } from "./types";

export const GRANOT_AUTOMATION_COMPATIBILITY_STATUSES = [
  "ready",
  "missing_reference",
  "source_disabled",
  "source_ambiguous",
  "operation_not_permitted",
] as const;

export type GranotAutomationCompatibilityStatus =
  (typeof GRANOT_AUTOMATION_COMPATIBILITY_STATUSES)[number];

export const GRANOT_AUTOMATION_COMPATIBILITY_ISSUE_CODES = [
  "granot_crm_source_reference_missing",
  "granot_crm_source_disabled",
  "granot_crm_source_ambiguous",
  "granot_crm_source_operation_not_permitted",
] as const;

export type GranotAutomationCompatibilityIssueCode =
  (typeof GRANOT_AUTOMATION_COMPATIBILITY_ISSUE_CODES)[number];

export type GranotAutomationSourceCompatibility = {
  granot_crm_source_id?: string;
  available_for_apply: boolean;
  status: GranotAutomationCompatibilityStatus;
  issues: Array<{
    code: GranotAutomationCompatibilityIssueCode;
    message: string;
  }>;
};

export type GranotAutomationCompatibilityOperation = "form_leads" | "call_leads";

export type GranotAutomationCompatibilityRoute = {
  lead_model: LeadModel;
};

export type GranotAutomationCompatibilitySource = {
  id: string;
  enabled: boolean;
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lifecycle_routes: GranotAutomationCompatibilityRoute[];
  normalized_granot_label?: string;
};

export function automationOperationPermittedByRoutes(
  routes: readonly GranotAutomationCompatibilityRoute[],
  operation: GranotAutomationCompatibilityOperation,
): boolean {
  const expectedModel: LeadModel =
    operation === "form_leads" ? "FormLead" : "CallLead";
  return routes.some((route) => route.lead_model === expectedModel);
}

export function evaluateGranotAutomationCompatibility(input: {
  granot_crm_source_id?: string;
  requested_operations: readonly GranotAutomationCompatibilityOperation[];
  referenced?: GranotAutomationCompatibilitySource | null;
  normalized_label_match_count?: number;
}): GranotAutomationSourceCompatibility {
  const granot_crm_source_id = input.granot_crm_source_id?.trim() || undefined;
  if (!granot_crm_source_id) {
    return unavailable("missing_reference", "granot_crm_source_reference_missing", {
      message: "This automation source has no Granot CRM source reference.",
    });
  }

  if (!input.referenced) {
    return unavailable(
      "missing_reference",
      "granot_crm_source_reference_missing",
      {
        granot_crm_source_id,
        message: "The referenced Granot CRM source was not found.",
      },
    );
  }

  if ((input.normalized_label_match_count ?? 1) > 1) {
    return unavailable("source_ambiguous", "granot_crm_source_ambiguous", {
      granot_crm_source_id,
      message:
        "The referenced Granot CRM source label matches more than one Registry row.",
    });
  }

  const referenced = input.referenced;
  if (
    !referenced.enabled ||
    !referenced.lifecycle_enabled ||
    referenced.lifecycle_disposition === "deferred"
  ) {
    return unavailable("source_disabled", "granot_crm_source_disabled", {
      granot_crm_source_id,
      message:
        "The referenced Granot CRM source is operationally disabled, lifecycle-disabled, or deferred.",
    });
  }

  const requested = input.requested_operations.length
    ? input.requested_operations
    : ([] as GranotAutomationCompatibilityOperation[]);
  const blocked = requested.filter(
    (operation) =>
      !automationOperationPermittedByRoutes(referenced.lifecycle_routes, operation),
  );
  if (requested.length > 0 && blocked.length > 0) {
    return unavailable(
      "operation_not_permitted",
      "granot_crm_source_operation_not_permitted",
      {
        granot_crm_source_id,
        message:
          "The referenced Granot CRM source routes do not permit the requested automation operation.",
      },
    );
  }

  return {
    granot_crm_source_id,
    available_for_apply: true,
    status: "ready",
    issues: [],
  };
}

function unavailable(
  status: Exclude<GranotAutomationCompatibilityStatus, "ready">,
  code: GranotAutomationCompatibilityIssueCode,
  input: { granot_crm_source_id?: string; message: string },
): GranotAutomationSourceCompatibility {
  return {
    ...(input.granot_crm_source_id
      ? { granot_crm_source_id: input.granot_crm_source_id }
      : {}),
    available_for_apply: false,
    status,
    issues: [{ code, message: input.message }],
  };
}
