import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../../src/services/granotLifecycle/types";

export const GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION =
  "granot-lifecycle-source-policy-v1";

export const REVIEWED_SOURCE_COMPANY_SLUG = "best_relocation_leads";

export const REVIEWED_GRANULARITY_KEYS = {
  call: "best_relocation_leads_call",
  form_local: "best_relocation_leads_form_local",
  form_long_distance: "best_relocation_leads_form_long_distance",
} as const;

export const EXCLUDED_PROVIDER_TYPES = ["AUTO"] as const;

export type ReviewedSourceFamilyKey =
  | "best_relocation_call"
  | "best_relocation_form"
  | "referral"
  | "paid_overflow"
  | "auto";

export type ReviewedSourceRouteSpec = {
  route_key: string;
  lead_model: LeadModel;
  move_type: "local" | "long_distance" | "any";
  granularity_key: string;
  expected_channel: "form" | "call";
  expected_local?: "local" | "long_distance";
};

export type ReviewedSourceFamilySpec = {
  family: ReviewedSourceFamilyKey;
  normalized_labels: readonly string[];
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  company_slug?: string;
  routes: readonly ReviewedSourceRouteSpec[];
};

export const REVIEWED_SOURCE_CLASSIFICATION_MANIFEST = {
  policy_version: GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION,
  excluded_provider_types: EXCLUDED_PROVIDER_TYPES,
  families: [
    {
      family: "best_relocation_call",
      normalized_labels: [
        "bestrelocation inbounds",
        "best relocation inbounds",
      ],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "create_if_missing",
      company_slug: REVIEWED_SOURCE_COMPANY_SLUG,
      routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          granularity_key: REVIEWED_GRANULARITY_KEYS.call,
          expected_channel: "call",
        },
      ],
    },
    {
      family: "best_relocation_form",
      normalized_labels: ["bestrelocation forms", "best relocation forms"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "create_if_missing",
      company_slug: REVIEWED_SOURCE_COMPANY_SLUG,
      routes: [
        {
          route_key: "form_local",
          lead_model: "FormLead",
          move_type: "local",
          granularity_key: REVIEWED_GRANULARITY_KEYS.form_local,
          expected_channel: "form",
          expected_local: "local",
        },
        {
          route_key: "form_long_distance",
          lead_model: "FormLead",
          move_type: "long_distance",
          granularity_key: REVIEWED_GRANULARITY_KEYS.form_long_distance,
          expected_channel: "form",
          expected_local: "long_distance",
        },
      ],
    },
    {
      family: "referral",
      normalized_labels: ["referral"],
      lifecycle_enabled: true,
      lifecycle_disposition: "referral_booking",
      lead_created_policy: "observation_only",
      routes: [],
    },
    {
      family: "paid_overflow",
      normalized_labels: ["paid overflow"],
      lifecycle_enabled: false,
      lifecycle_disposition: "deferred",
      lead_created_policy: "observation_only",
      routes: [],
    },
    {
      family: "auto",
      normalized_labels: ["auto"],
      lifecycle_enabled: false,
      lifecycle_disposition: "deferred",
      lead_created_policy: "observation_only",
      routes: [],
    },
  ] as const satisfies readonly ReviewedSourceFamilySpec[],
} as const;

export function reviewedFamilyForNormalizedLabel(
  normalizedLabel: string,
): ReviewedSourceFamilySpec | undefined {
  return REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families.find((family) =>
    (family.normalized_labels as readonly string[]).includes(normalizedLabel),
  );
}

export function isExcludedProviderType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    EXCLUDED_PROVIDER_TYPES.includes(
      value.toUpperCase() as (typeof EXCLUDED_PROVIDER_TYPES)[number],
    )
  );
}
