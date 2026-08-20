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
  | "main_site_form"
  | "main_site_call"
  | "tbm_form"
  | "tbm_call"
  | "tbm_prime_form"
  | "tbm_prime_call"
  | "top10_form"
  | "top10_call"
  | "referral"
  | "paid_overflow"
  | "auto";

export const LINK_ONLY_AUTOMATION_FAMILY_KEYS = [
  "main_site_form",
  "main_site_call",
  "tbm_form",
  "tbm_call",
  "tbm_prime_form",
  "tbm_prime_call",
  "top10_form",
  "top10_call",
] as const satisfies readonly ReviewedSourceFamilyKey[];

export const LINK_ONLY_AUTOMATION_GRANULARITY_KEYS = {
  main_site_form: "main_site_form",
  main_site_call: "main_site_call",
  tbm_form: "tbm_leads_form",
  tbm_call: "tbm_leads_call",
  tbm_prime_form: "tbm_prime_leads_form",
  tbm_prime_call: "tbm_prime_leads_call",
  top10_form: "top10_leads_form",
  top10_call: "top10_leads_call",
} as const;

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
      family: "main_site_form",
      normalized_labels: ["main site forms"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "main_site",
      routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.main_site_form,
          expected_channel: "form",
        },
      ],
    },
    {
      family: "main_site_call",
      normalized_labels: ["main site inbounds"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "main_site",
      routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.main_site_call,
          expected_channel: "call",
        },
      ],
    },
    {
      family: "tbm_form",
      normalized_labels: ["tbm forms"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "tbm_leads",
      routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_form,
          expected_channel: "form",
        },
      ],
    },
    {
      family: "tbm_call",
      normalized_labels: ["10best inbounds"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "tbm_leads",
      routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_call,
          expected_channel: "call",
        },
      ],
    },
    {
      family: "tbm_prime_form",
      normalized_labels: ["tbm forms prime"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "tbm_prime_leads",
      routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_prime_form,
          expected_channel: "form",
        },
      ],
    },
    {
      family: "tbm_prime_call",
      normalized_labels: ["tbm prime inbounds"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "tbm_prime_leads",
      routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_prime_call,
          expected_channel: "call",
        },
      ],
    },
    {
      family: "top10_form",
      normalized_labels: ["top10 forms"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "top10_leads",
      routes: [
        {
          route_key: "form_any",
          lead_model: "FormLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.top10_form,
          expected_channel: "form",
        },
      ],
    },
    {
      family: "top10_call",
      normalized_labels: ["top10 inbounds"],
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "link_only",
      company_slug: "top10_leads",
      routes: [
        {
          route_key: "call_any",
          lead_model: "CallLead",
          move_type: "any",
          granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.top10_call,
          expected_channel: "call",
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

export function isLinkOnlyAutomationFamily(
  family: ReviewedSourceFamilyKey | undefined,
): family is (typeof LINK_ONLY_AUTOMATION_FAMILY_KEYS)[number] {
  return (
    family !== undefined &&
    (LINK_ONLY_AUTOMATION_FAMILY_KEYS as readonly string[]).includes(family)
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
