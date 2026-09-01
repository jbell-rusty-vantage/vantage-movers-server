/**
 * Owner-facing translation of Registry Health codes.
 *
 * Every code `queries/health.ts` can emit must have a row. An unknown code
 * surfaces as itself with a generic action — never dropped.
 */
export type OwnerFindingSeverity = "blocking" | "reviewable";

export type OwnerFinding = {
  code: string;
  severity: OwnerFindingSeverity;
  owner_message: string;
  owner_action: string;
  deep_link: string;
  scope: { lead_source_id: string; source_granularity_id?: string };
  advanced: { raw_code: string };
};

export type FindingTranslationRow = {
  severity: OwnerFindingSeverity;
  owner_message: string;
  owner_action: string;
  deep_link: string;
};

const HEALTH = "/admin/operations-registry/health";
const LEAD_SOURCES = "/admin/operations-registry/lead-sources";
const GRANOT_NAMES = "/admin/operations-registry/granot-names";
const INBOUND = "/admin/operations-registry/inbound-numbers";
const LEAD_COSTS = "/admin/operations-registry/lead-costs";
const MAPPINGS = "/admin/operations-registry/label-mappings";
const AGENTS = "/admin/operations-registry/agents";
const MERCHANTS = "/admin/operations-registry/merchants";

export const FINDING_TRANSLATION_TABLE: Record<string, FindingTranslationRow> = {
  "registry.signing_secret_missing": {
    severity: "blocking",
    owner_message:
      "Owner changes cannot be trusted until the dashboard signing secret is configured.",
    owner_action: "Ask engineering to set the dashboard signing secret.",
    deep_link: HEALTH,
  },
  "registry.inactive_agents_present": {
    severity: "reviewable",
    owner_message:
      "Some agents are switched off. They still appear on old records but will not be matched automatically.",
    owner_action: "Review inactive agents and switch one back on if it should receive work.",
    deep_link: AGENTS,
  },
  "registry.inactive_merchants_present": {
    severity: "reviewable",
    owner_message:
      "Some merchants are switched off. They still appear on old bookings but will not be offered automatically.",
    owner_action: "Review inactive merchants if a booking needs one of them.",
    deep_link: MERCHANTS,
  },
  "registry.ringcentral_validation_failed": {
    severity: "blocking",
    owner_message: "This number has stopped filing calls.",
    owner_action: "Re-check the number against RingCentral and fix why it is no longer recognized.",
    deep_link: INBOUND,
  },
  "registry.ringcentral_route_inconsistent": {
    severity: "blocking",
    owner_message:
      "Calls to this number are not being filed anywhere because the number is not fully mapped.",
    owner_action: "Finish mapping this inbound number to a live call feed.",
    deep_link: INBOUND,
  },
  "registry.ringcentral_assignment_inconsistent": {
    severity: "blocking",
    owner_message:
      "Calls to this number are not being filed anywhere because the assigned feed cannot receive calls.",
    owner_action: "Point this number at a live inbound-call feed of an active lead source.",
    deep_link: INBOUND,
  },
  "registry.migration_evidence_present": {
    severity: "reviewable",
    owner_message:
      "A source-connection migration still has leftover evidence that needs an Owner review.",
    owner_action: "Open Registry Health and clear the leftover migration evidence.",
    deep_link: HEALTH,
  },
  "registry.migration_evidence_missing": {
    severity: "reviewable",
    owner_message:
      "A source-connection migration expected evidence that is not on file.",
    owner_action: "Open Registry Health and restore or re-run the missing migration evidence.",
    deep_link: HEALTH,
  },
  "registry.source_resolution_failures": {
    severity: "blocking",
    owner_message:
      "Incoming leads are failing to land in a lead source, so they are not being filed.",
    owner_action: "Open the lead source that should own those names and fix the colliding or missing spelling.",
    deep_link: LEAD_SOURCES,
  },
  "registry.cache_stale": {
    severity: "reviewable",
    owner_message:
      "Live matching may be using an older snapshot of source connections until the cache refreshes.",
    owner_action: "Retry after a few minutes, or ask engineering if the stale cache persists.",
    deep_link: HEALTH,
  },
  "registry.compatibility_reads_remaining": {
    severity: "reviewable",
    owner_message:
      "Some incoming names are still matched through the old static list instead of the official mappings. The observation window opened on 1 Sep 2026. Removal of that list is blocked until this count holds at zero.",
    owner_action: "Add an official sheet or legacy name on the lead source that should own them.",
    deep_link: MAPPINGS,
  },
  "registry.label_mapping_destination_invalid": {
    severity: "blocking",
    owner_message:
      "A sheet or leftover name is pointing at a feed that cannot receive those leads.",
    owner_action: "Retire that accepted name and create a replacement that points at a live feed.",
    deep_link: MAPPINGS,
  },
  "registry.label_mapping_collision": {
    severity: "blocking",
    owner_message:
      "Two accepted names share the same spelling, so incoming leads with that name cannot be filed.",
    owner_action: "Keep one accepted name and retire the other.",
    deep_link: MAPPINGS,
  },
  "registry.granot_source_destination_invalid": {
    severity: "blocking",
    owner_message:
      "Granot is sending leads under a name that no longer lands in a live feed.",
    owner_action: "Reconnect that Granot name to a live feed, or switch the name off.",
    deep_link: GRANOT_NAMES,
  },
  "registry.granot_source_route_shape_invalid": {
    severity: "blocking",
    owner_message:
      "This Granot name does not say clearly which feed should receive the lead.",
    owner_action: "Set the Granot name to one feed, or to both local and long-distance form feeds.",
    deep_link: GRANOT_NAMES,
  },
  "registry.granot_sms_gate_inconsistent": {
    severity: "blocking",
    owner_message:
      "Customer text is shown as on, but this Granot name is not allowed to text.",
    owner_action: "Turn customer text off, or switch the arrival policy to create-if-missing and attest consent.",
    deep_link: GRANOT_NAMES,
  },
  "registry.granot_sms_daily_cap_configured": {
    severity: "reviewable",
    owner_message:
      "A stored daily text cap exists on this Granot name, but it is not enforced.",
    owner_action: "Leave the cap as historical data, or ask engineering if a real daily limit is required.",
    deep_link: GRANOT_NAMES,
  },
  "registry.granot_source_label_collision": {
    severity: "blocking",
    owner_message:
      "Two Granot names collapse to the same spelling, so arrivals under that name cannot be filed.",
    owner_action: "Keep one exact Granot spelling and retire the other.",
    deep_link: GRANOT_NAMES,
  },
  "registry.cpl_schedule_invalid": {
    severity: "blocking",
    owner_message:
      "This feed cannot go live because its lead cost schedule has a gap or overlap.",
    owner_action: "Open lead costs for this feed and fix the schedule.",
    deep_link: LEAD_COSTS,
  },
  "registry.cpl_missing_rate_leads": {
    severity: "blocking",
    owner_message:
      "Some filed leads have no lead cost, so reporting and activation stay blocked.",
    owner_action: "Set a lead cost that covers those dates for this feed.",
    deep_link: LEAD_COSTS,
  },
  "registry.cpl_correction_jobs_unhealthy": {
    severity: "reviewable",
    owner_message:
      "A lead-cost correction did not finish, so some costs may still be wrong.",
    owner_action: "Open lead costs and retry or cancel the stuck correction.",
    deep_link: LEAD_COSTS,
  },
  "registry.source_granularity_inactive_company": {
    severity: "blocking",
    owner_message:
      "This feed is live while its lead source is not, so new leads cannot be owned cleanly.",
    owner_action: "Activate the lead source, or switch the feed off.",
    deep_link: LEAD_SOURCES,
  },
  "registry.source_default_invalid": {
    severity: "blocking",
    owner_message:
      "This lead source has live feeds but no default feed for that channel, so new leads have nowhere to land.",
    owner_action: "Activate a feed as the default for this channel.",
    deep_link: LEAD_SOURCES,
  },
  "registry.source_crm_label_ambiguous": {
    severity: "blocking",
    owner_message:
      "Two live feeds of the same kind send the same spelling to Granot, so those leads cannot be told apart.",
    owner_action: "Change What Vantage sends to Granot on one of the feeds.",
    deep_link: LEAD_SOURCES,
  },
  "registry.source_source_site_ambiguous": {
    severity: "blocking",
    owner_message:
      "Two live feeds claim the same website, so form arrivals from that site cannot be filed.",
    owner_action: "Give each feed its own website, or retire one of them.",
    deep_link: LEAD_SOURCES,
  },
  "registry.source_fallback_priority_ambiguous": {
    severity: "blocking",
    owner_message:
      "Two live feeds accept the same other spelling at the same priority, so those leads cannot be filed.",
    owner_action: "Give one feed a different other spelling, or change which feed should win.",
    deep_link: LEAD_SOURCES,
  },
};

export const FINDING_TRANSLATIONS = FINDING_TRANSLATION_TABLE;
export const TRANSLATED_HEALTH_CODES = Object.keys(FINDING_TRANSLATION_TABLE).sort();

const GENERIC_FALLBACK: FindingTranslationRow = {
  severity: "reviewable",
  owner_message: "This connection needs an Owner review.",
  owner_action: "Open Registry Health and act on the raw finding.",
  deep_link: HEALTH,
};

export function listTranslatedHealthCodes(): string[] {
  return [...TRANSLATED_HEALTH_CODES];
}

export function translateFinding(
  finding: {
    code: string;
    severity?: string;
    summary?: string;
    entity_id?: string;
    entity_type?: string;
    evidence?: Record<string, string | number | boolean | null>;
  },
  scope: {
    lead_source_id: string;
    source_granularity_id?: string;
    phone_number?: string;
  },
): OwnerFinding {
  const row = FINDING_TRANSLATION_TABLE[finding.code] ?? {
    ...GENERIC_FALLBACK,
    owner_message: finding.summary?.trim() || `Untranslated finding ${finding.code}.`,
    owner_action: `Review ${finding.code} in Registry Health.`,
  };
  const phone =
    scope.phone_number ||
    (typeof finding.evidence?.phone_number === "string"
      ? finding.evidence.phone_number
      : undefined);
  const ownerMessage =
    finding.code === "registry.ringcentral_validation_failed"
      ? "This number has stopped filing calls."
      : finding.code === "registry.ringcentral_assignment_inconsistent" && phone
        ? `Calls to ${phone} are not being filed anywhere.`
        : row.owner_message;
  return {
    code: finding.code,
    severity: row.severity,
    owner_message: ownerMessage,
    owner_action: row.owner_action,
    deep_link: specializeDeepLink(finding.code, scope, finding.entity_id),
    scope: {
      lead_source_id: scope.lead_source_id,
      ...(scope.source_granularity_id
        ? { source_granularity_id: scope.source_granularity_id }
        : {}),
    },
    advanced: { raw_code: finding.code },
  };
}

export function translateFindings(
  findings: Array<{
    code: string;
    severity?: string;
    summary?: string;
    entity_id?: string;
    entity_type?: string;
    evidence?: Record<string, string | number | boolean | null>;
  }>,
  scope: {
    lead_source_id: string;
    source_granularity_id?: string;
    phone_number?: string;
  },
): OwnerFinding[] {
  return findings.map((finding) => translateFinding(finding, scope));
}

export const translateHealthFinding = translateFinding;

function specializeDeepLink(
  code: string,
  scope: { lead_source_id: string; source_granularity_id?: string },
  entityId?: string,
): string {
  if (code.startsWith("registry.cpl_") && scope.source_granularity_id) {
    return `${LEAD_COSTS}/${scope.source_granularity_id}`;
  }
  if (code.startsWith("registry.granot_") && entityId) {
    return `${GRANOT_NAMES}/${entityId}`;
  }
  if (code.startsWith("registry.label_") && entityId) {
    return `${MAPPINGS}/${entityId}`;
  }
  if (code.startsWith("registry.ringcentral_") && entityId) {
    return `${INBOUND}/${entityId}`;
  }
  if (scope.lead_source_id && code.startsWith("registry.source_")) {
    return `${LEAD_SOURCES}/${scope.lead_source_id}`;
  }
  return FINDING_TRANSLATION_TABLE[code]?.deep_link ?? HEALTH;
}
