import { createHash } from "node:crypto";
import { normalizeAgentName } from "../../src/services/agents/agentName";
import { normalizeGranotCrmUsername } from "../../src/services/agents/receiverAgentCrmUsername";
import { collectNormalizedCollisions } from "../../src/services/employeeBookings/migrationPreflight";
import {
  CPL_RATE_DEFINITIONS,
  cplRateCacheKey,
  type CplLeadType,
} from "../../src/config/domain/cplRateDefinitions";
import {
  RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE,
} from "../../src/services/ringcentral/call-lead-sources";
import { normalizePhoneNumberToE164Like } from "../../src/services/ringcentral/phone-normalization";
import { normalizeSourceLabel } from "../../src/services/operationsRegistry/sourceLabelNormalize";

export const SCRIPT_VERSION = "operations-registry-inventory-s0";
export const PRODUCTION_DATABASE = "vantagemovers";
export const TEST_DATABASE = "testvantagemovers";
export const HISTORICAL_DATABASE = "vantagemovershistorical";
export const PRODUCTION_CONFIRMATION = "--confirm-production-db=vantagemovers";

export type CollisionSeverity = "blocking" | "reviewable";

export type InventoryCollision = {
  code: string;
  severity: CollisionSeverity;
  category:
    | "agent"
    | "merchant"
    | "source"
    | "cpl"
    | "ringcentral"
    | "lead_snapshot";
  message: string;
  details: Record<string, unknown>;
};

export type StaticAuthorityReference = {
  module: string;
  symbols: string[];
  role: string;
};

export const STATIC_AUTHORITY_REFERENCES: readonly StaticAuthorityReference[] = [
  {
    module: "src/config/domain/sources.ts",
    symbols: [
      "SOURCE_COMPANIES",
      "SOURCE_LABEL_TO_COMPANY",
      "SOURCE_COMPANY_CONFIGS",
      "CRM_SOURCE_LABELS",
      "resolveSourceCompany",
      "resolveSourceCompanyFromLabel",
      "getFormLeadSourceCompanyLabel",
      "getCallLeadSourceCompanyLabel",
    ],
    role: "closed_world_source_company_union_and_label_maps",
  },
  {
    module: "src/config/domain/cplRateDefinitions.ts",
    symbols: ["CPL_RATE_DEFINITIONS", "findCplRateDefinition", "cplRateCacheKey"],
    role: "canonical_cpl_slot_seeds",
  },
  {
    module: "src/config/domain/cpl.ts",
    symbols: ["getCplForSource"],
    role: "legacy_env_backed_cpl_fallback",
  },
  {
    module: "src/services/ringcentral/call-lead-sources.ts",
    symbols: [
      "RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE",
      "resolveRingCentralInboundSource",
      "resolveRingCentralInboundSourceFromCatalog",
    ],
    role: "static_inbound_phone_routing_fallback",
  },
  {
    module: "src/services/leadSourceCompanies/leadSourceCompany.service.ts",
    symbols: ["LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL", "ensureLeadSourceCompaniesSeeded"],
    role: "embedded_catalog_seed_and_legacy_phone_metadata",
  },
  {
    module: "src/services/cpl/cplRate.service.ts",
    symbols: ["getCplRate", "listCplRates", "updateCplRate"],
    role: "embedded_granularity_cpl_with_legacy_cpl_rates_fallback",
  },
  {
    module: "src/services/googleSheets/targets.ts",
    symbols: ["resolveSourceLeadSheetTarget"],
    role: "static_source_sheet_target_resolution",
  },
  {
    module: "src/services/analytics/analyticsFilters.ts",
    symbols: ["SOURCE_COMPANIES"],
    role: "analytics_source_company_filter_union",
  },
] as const;

export type AgentInventoryRecord = {
  id: string;
  name: string;
  normalized_name: string;
  active: boolean;
  granot_crm_username?: string;
  granot_identity_username?: string;
  name_aliases: string[];
};

export type MerchantInventoryRecord = {
  id: string;
  name: string;
  normalized_name: string;
  active: boolean;
  name_aliases: string[];
};

export type GranularityInventoryRecord = {
  id: string;
  company_slug: string;
  company_id: string;
  granularity_key: string;
  channel: "form" | "call";
  owner_label: string;
  crm_label: string;
  aliases: string[];
  active: boolean;
  cpl: number;
  local?: string;
  source_sites: string[];
  inbound_phone_numbers: string[];
  priority: number;
  sheet_tab_name?: string;
};

export type SourceCompanyInventoryRecord = {
  id: string;
  company_slug: string;
  name: string;
  owner_label: string;
  aliases: string[];
  active: boolean;
  default_form_granularity_key?: string;
  default_call_granularity_key?: string;
  sheet_config?: {
    spreadsheet_id?: string;
    has_bad_tabs: boolean;
    projection_mode?: string;
  };
  granularities: GranularityInventoryRecord[];
};

export type CplRateInventoryRecord = {
  id?: string;
  label: string;
  source_company: string;
  lead_type: CplLeadType;
  local?: string;
  cpl: number;
};

export type LeadCountBucket = {
  source_company: string;
  source_granularity_key: string;
  cpl: number;
  count: number;
};

export type InventorySnapshot = {
  agents: AgentInventoryRecord[];
  merchants: MerchantInventoryRecord[];
  sourceCompanies: SourceCompanyInventoryRecord[];
  cplRates: CplRateInventoryRecord[];
  formLeadCounts: LeadCountBucket[];
  callLeadCounts: LeadCountBucket[];
  bookedLeadMerchantSnapshots: Array<{ normalized: string; count: number }>;
};

export type OperationsRegistryInventoryManifest = {
  run_id: string;
  script_version: string;
  git_sha?: string;
  database_name: string;
  mode: "dry_run";
  started_at: string;
  completed_at: string;
  operator?: string;
  source_counts: {
    agents: number;
    merchants: number;
    source_companies: number;
    embedded_granularities: number;
    cpl_rates: number;
    form_leads: number;
    call_leads: number;
    booked_lead_merchant_snapshots: number;
    static_ringcentral_numbers: number;
  };
  planned: {
    creates: 0;
    updates: 0;
    no_ops: 0;
    conflicts: number;
  };
  applied: {
    creates: 0;
    updates: 0;
    no_ops: 0;
    failures: 0;
  };
  mapping_checksum: string;
  conflict_summary: {
    blocking: number;
    reviewable: number;
    total: number;
    by_category: Record<string, number>;
  };
  collisions: InventoryCollision[];
  validation_summary: {
    read_only: true;
    has_blocking_collisions: boolean;
    has_reviewable_collisions: boolean;
    static_authority_reference_count: number;
  };
  static_authority_references: StaticAuthorityReference[];
  inventory: {
    agents: AgentInventoryRecord[];
    merchants: MerchantInventoryRecord[];
    source_companies: SourceCompanyInventoryRecord[];
    cpl_rates: CplRateInventoryRecord[];
    embedded_cpl_by_granularity: Array<{
      company_slug: string;
      granularity_key: string;
      channel: "form" | "call";
      crm_label: string;
      cpl: number;
      local?: string;
    }>;
    form_lead_counts: LeadCountBucket[];
    call_lead_counts: LeadCountBucket[];
    booked_lead_merchant_snapshots: Array<{ normalized: string; count: number }>;
    static_ringcentral_numbers: Array<{
      phone_number: string;
      source_label: string;
      source_company: string;
    }>;
    embedded_inbound_phone_numbers: Array<{
      company_slug: string;
      granularity_key: string;
      crm_label: string;
      phone_number: string;
    }>;
  };
  resume_cursor: null;
};

function normalizeAlias(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeMerchantName(value: string): string {
  return normalizeAgentName(value);
}

function sortCollisions(collisions: InventoryCollision[]): InventoryCollision[] {
  return [...collisions].sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.category.localeCompare(right.category) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function pushCollision(
  collisions: InventoryCollision[],
  collision: InventoryCollision,
): void {
  collisions.push(collision);
}

function collectAgentCollisions(
  agents: AgentInventoryRecord[],
  collisions: InventoryCollision[],
): void {
  const normalizedCollisions = collectNormalizedCollisions(
    agents.map((agent) => ({ ...agent, _id: agent.id })),
    (agent) => agent.normalized_name,
  );
  for (const collision of normalizedCollisions) {
    pushCollision(collisions, {
      code: "agent_normalized_name_collision",
      severity: "blocking",
      category: "agent",
      message: `Multiple Agents share normalized name "${collision.normalized}".`,
      details: { normalized: collision.normalized, agent_ids: collision.ids },
    });
  }

  const usernameOwners = new Map<string, string[]>();
  for (const agent of agents) {
    const username =
      normalizeGranotCrmUsername(agent.granot_identity_username) ??
      normalizeGranotCrmUsername(agent.granot_crm_username);
    if (!username) {
      continue;
    }
    usernameOwners.set(username, [...(usernameOwners.get(username) ?? []), agent.id]);
  }
  for (const [username, agentIds] of usernameOwners.entries()) {
    if (agentIds.length <= 1) {
      continue;
    }
    pushCollision(collisions, {
      code: "agent_granot_username_collision",
      severity: "blocking",
      category: "agent",
      message: `Granot username ${username} is configured on multiple Agents.`,
      details: { username, agent_ids: agentIds.sort() },
    });
  }

  for (const agent of agents) {
    const flat = normalizeGranotCrmUsername(agent.granot_crm_username);
    const embedded = normalizeGranotCrmUsername(agent.granot_identity_username);
    if (flat && embedded && flat !== embedded) {
      pushCollision(collisions, {
        code: "agent_granot_identity_flat_mismatch",
        severity: "reviewable",
        category: "agent",
        message: `Agent ${agent.id} has mismatched flat and embedded Granot usernames.`,
        details: {
          agent_id: agent.id,
          granot_crm_username: flat,
          granot_identity_username: embedded,
        },
      });
    }
    if (!agent.active && (flat || embedded)) {
      pushCollision(collisions, {
        code: "inactive_agent_with_granot_username",
        severity: "reviewable",
        category: "agent",
        message: `Inactive Agent ${agent.id} still has a configured Granot username.`,
        details: {
          agent_id: agent.id,
          username: embedded ?? flat,
        },
      });
    }
  }
}

function collectMerchantCollisions(
  merchants: MerchantInventoryRecord[],
  bookedLeadMerchantSnapshots: InventorySnapshot["bookedLeadMerchantSnapshots"],
  collisions: InventoryCollision[],
): void {
  const normalizedCollisions = collectNormalizedCollisions(
    merchants.map((merchant) => ({ ...merchant, _id: merchant.id })),
    (merchant) => merchant.normalized_name,
  );
  for (const collision of normalizedCollisions) {
    pushCollision(collisions, {
      code: "merchant_normalized_name_collision",
      severity: "blocking",
      category: "merchant",
      message: `Multiple Merchants share normalized name "${collision.normalized}".`,
      details: { normalized: collision.normalized, merchant_ids: collision.ids },
    });
  }

  const knownNames = new Set<string>();
  for (const merchant of merchants) {
    knownNames.add(merchant.normalized_name);
    for (const alias of merchant.name_aliases) {
      const normalized = normalizeMerchantName(alias);
      if (normalized) {
        knownNames.add(normalized);
      }
    }
  }

  for (const snapshot of bookedLeadMerchantSnapshots) {
    if (!snapshot.normalized || knownNames.has(snapshot.normalized)) {
      continue;
    }
    pushCollision(collisions, {
      code: "booked_lead_merchant_snapshot_unmatched",
      severity: "reviewable",
      category: "lead_snapshot",
      message: `BookedLead merchant snapshot "${snapshot.normalized}" does not match a Merchant record.`,
      details: {
        normalized_merchant: snapshot.normalized,
        booking_count: snapshot.count,
      },
    });
  }
}

function flattenGranularities(
  sourceCompanies: SourceCompanyInventoryRecord[],
): GranularityInventoryRecord[] {
  return sourceCompanies.flatMap((company) => company.granularities);
}

function collectSourceCollisions(
  sourceCompanies: SourceCompanyInventoryRecord[],
  collisions: InventoryCollision[],
): void {
  const granularities = flattenGranularities(sourceCompanies);

  const keyCollisions = collectNormalizedCollisions(
    granularities.map((granularity) => ({ ...granularity, _id: granularity.id })),
    (granularity) => granularity.granularity_key,
  );
  for (const collision of keyCollisions) {
    pushCollision(collisions, {
      code: "granularity_key_collision",
      severity: "blocking",
      category: "source",
      message: `Granularity key "${collision.normalized}" is used by multiple records.`,
      details: { granularity_key: collision.normalized, granularity_ids: collision.ids },
    });
  }

  const activeGranularities = granularities.filter((granularity) => granularity.active);
  const crmLabelCollisions = collectNormalizedCollisions(
    activeGranularities.map((granularity) => ({ ...granularity, _id: granularity.id })),
    (granularity) => normalizeAlias(granularity.crm_label),
  );
  for (const collision of crmLabelCollisions) {
    pushCollision(collisions, {
      code: "exact_active_crm_label_collision",
      severity: "blocking",
      category: "source",
      message: `Active CRM label "${collision.normalized}" maps to multiple granularities.`,
      details: { crm_label: collision.normalized, granularity_ids: collision.ids },
    });
  }

  for (const channel of ["form", "call"] as const) {
    const channelGranularities = activeGranularities.filter(
      (granularity) => granularity.channel === channel,
    );
    const siteOwners = new Map<string, string[]>();
    for (const granularity of channelGranularities) {
      for (const site of granularity.source_sites) {
        const normalized = normalizeAlias(site);
        if (!normalized) {
          continue;
        }
        siteOwners.set(normalized, [...(siteOwners.get(normalized) ?? []), granularity.id]);
      }
    }
    for (const [sourceSite, granularityIds] of siteOwners.entries()) {
      if (granularityIds.length <= 1) {
        continue;
      }
      pushCollision(collisions, {
        code: "exact_active_source_site_collision",
        severity: "blocking",
        category: "source",
        message: `Active ${channel} source site "${sourceSite}" maps to multiple granularities.`,
        details: { channel, source_site: sourceSite, granularity_ids: granularityIds.sort() },
      });
    }
  }

  const aliasPriorityOwners = new Map<string, Map<number, string[]>>();
  for (const granularity of activeGranularities) {
    const aliasValues = [
      granularity.granularity_key,
      granularity.crm_label,
      ...granularity.aliases,
    ];
    for (const alias of aliasValues) {
      const normalized = normalizeAlias(alias);
      if (!normalized) {
        continue;
      }
      const byPriority =
        aliasPriorityOwners.get(normalized) ?? new Map<number, string[]>();
      byPriority.set(granularity.priority, [
        ...(byPriority.get(granularity.priority) ?? []),
        granularity.id,
      ]);
      aliasPriorityOwners.set(normalized, byPriority);
    }
  }
  for (const [alias, byPriority] of aliasPriorityOwners.entries()) {
    for (const [priority, granularityIds] of byPriority.entries()) {
      const uniqueIds = [...new Set(granularityIds)].sort();
      if (uniqueIds.length <= 1) {
        continue;
      }
      pushCollision(collisions, {
        code: "fallback_alias_equal_priority_ambiguity",
        severity: "blocking",
        category: "source",
        message: `Fallback alias "${alias}" at priority ${priority} is ambiguous across active granularities.`,
        details: { alias, priority, granularity_ids: uniqueIds },
      });
    }
  }

  for (const company of sourceCompanies) {
    for (const channel of ["form", "call"] as const) {
      const activeInChannel = company.granularities.filter(
        (granularity) => granularity.active && granularity.channel === channel,
      );
      if (activeInChannel.length === 0) {
        continue;
      }
      const defaultKey =
        channel === "form"
          ? company.default_form_granularity_key
          : company.default_call_granularity_key;
      if (!defaultKey) {
        pushCollision(collisions, {
          code: "missing_active_default_granularity",
          severity: "reviewable",
          category: "source",
          message: `Source company ${company.company_slug} has active ${channel} granularities but no default key.`,
          details: { company_slug: company.company_slug, channel },
        });
        continue;
      }
      const defaultGranularity = company.granularities.find(
        (granularity) => granularity.granularity_key === defaultKey,
      );
      if (!defaultGranularity) {
        pushCollision(collisions, {
          code: "default_granularity_key_missing",
          severity: "reviewable",
          category: "source",
          message: `Source company ${company.company_slug} default ${channel} key "${defaultKey}" does not exist.`,
          details: {
            company_slug: company.company_slug,
            channel,
            default_granularity_key: defaultKey,
          },
        });
      } else if (!defaultGranularity.active) {
        pushCollision(collisions, {
          code: "default_granularity_inactive",
          severity: "reviewable",
          category: "source",
          message: `Source company ${company.company_slug} default ${channel} granularity is inactive.`,
          details: {
            company_slug: company.company_slug,
            channel,
            granularity_key: defaultGranularity.granularity_key,
          },
        });
      }
    }
  }
}

function collectPhoneCollisions(
  granularities: GranularityInventoryRecord[],
  collisions: InventoryCollision[],
): Map<string, GranularityInventoryRecord[]> {
  const activePhoneOwners = new Map<string, GranularityInventoryRecord[]>();
  for (const granularity of granularities.filter((entry) => entry.active)) {
    for (const phone of granularity.inbound_phone_numbers) {
      const normalized = normalizePhoneNumberToE164Like(phone);
      if (!normalized) {
        continue;
      }
      activePhoneOwners.set(normalized, [
        ...(activePhoneOwners.get(normalized) ?? []),
        granularity,
      ]);
    }
  }

  for (const [phoneNumber, owners] of activePhoneOwners.entries()) {
    if (owners.length <= 1) {
      continue;
    }
    pushCollision(collisions, {
      code: "exact_active_inbound_phone_collision",
      severity: "blocking",
      category: "ringcentral",
      message: `Inbound phone ${phoneNumber} is assigned to multiple active granularities.`,
      details: {
        phone_number: phoneNumber,
        assignments: owners
          .map((owner) => ({
            company_slug: owner.company_slug,
            granularity_key: owner.granularity_key,
            crm_label: owner.crm_label,
          }))
          .sort((left, right) =>
            `${left.company_slug}:${left.granularity_key}`.localeCompare(
              `${right.company_slug}:${right.granularity_key}`,
            ),
          ),
      },
    });
  }

  return activePhoneOwners;
}

function collectCplCollisions(
  sourceCompanies: SourceCompanyInventoryRecord[],
  cplRates: CplRateInventoryRecord[],
  collisions: InventoryCollision[],
): void {
  const legacyRates = new Map<string, number>();
  for (const rate of cplRates) {
    legacyRates.set(rate.label, rate.cpl);
  }
  for (const definition of CPL_RATE_DEFINITIONS) {
    if (!legacyRates.has(definition.label)) {
      legacyRates.set(definition.label, definition.defaultCpl);
    }
  }

  for (const company of sourceCompanies) {
    for (const granularity of company.granularities) {
      const legacyKey = cplRateCacheKey(
        company.company_slug as Parameters<typeof cplRateCacheKey>[0],
        granularity.channel,
        granularity.local as Parameters<typeof cplRateCacheKey>[2],
      );
      const legacyRate = [...legacyRates.entries()].find(([label]) => {
        const definition = CPL_RATE_DEFINITIONS.find((entry) => entry.label === label);
        if (!definition) {
          return false;
        }
        return (
          cplRateCacheKey(
            definition.sourceCompany,
            definition.leadType,
            definition.local,
          ) === legacyKey
        );
      });
      const legacyValue = legacyRate?.[1];
      if (legacyValue === undefined || legacyValue === granularity.cpl) {
        continue;
      }
      pushCollision(collisions, {
        code: "embedded_cpl_vs_legacy_cpl_rate_disagreement",
        severity: "reviewable",
        category: "cpl",
        message: `Embedded CPL for ${company.company_slug}/${granularity.granularity_key} disagrees with legacy cpl_rates.`,
        details: {
          company_slug: company.company_slug,
          granularity_key: granularity.granularity_key,
          crm_label: granularity.crm_label,
          embedded_cpl: granularity.cpl,
          legacy_cpl: legacyValue,
          legacy_label: legacyRate?.[0],
        },
      });
    }
  }
}

function collectRingCentralCollisions(
  granularities: GranularityInventoryRecord[],
  activePhoneOwners: Map<string, GranularityInventoryRecord[]>,
  collisions: InventoryCollision[],
): void {
  for (const [phoneNumber, mapping] of Object.entries(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE)) {
    const owners = activePhoneOwners.get(phoneNumber) ?? [];
    if (owners.length === 0) {
      pushCollision(collisions, {
        code: "static_ringcentral_number_missing_from_embedded_catalog",
        severity: "reviewable",
        category: "ringcentral",
        message: `Static RingCentral number ${phoneNumber} is not present on any active embedded granularity.`,
        details: {
          phone_number: phoneNumber,
          static_source_label: mapping.sourceLabel,
          static_source_company: mapping.sourceCompany,
        },
      });
      continue;
    }

    const mismatchedOwners = owners.filter(
      (owner) =>
        owner.crm_label !== mapping.sourceLabel ||
        owner.company_slug !== mapping.sourceCompany,
    );
    if (mismatchedOwners.length > 0) {
      pushCollision(collisions, {
        code: "static_embedded_ringcentral_assignment_mismatch",
        severity: "blocking",
        category: "ringcentral",
        message: `Static RingCentral number ${phoneNumber} disagrees with embedded catalog assignment.`,
        details: {
          phone_number: phoneNumber,
          static_source_label: mapping.sourceLabel,
          static_source_company: mapping.sourceCompany,
          embedded_assignments: mismatchedOwners.map((owner) => ({
            company_slug: owner.company_slug,
            granularity_key: owner.granularity_key,
            crm_label: owner.crm_label,
          })),
        },
      });
    }
  }

  for (const [phoneNumber, owners] of activePhoneOwners.entries()) {
    if (phoneNumber in RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE) {
      continue;
    }
    pushCollision(collisions, {
      code: "embedded_ringcentral_number_not_in_static_map",
      severity: "reviewable",
      category: "ringcentral",
      message: `Embedded inbound phone ${phoneNumber} is not listed in the static RingCentral map.`,
      details: {
        phone_number: phoneNumber,
        assignments: owners.map((owner) => ({
          company_slug: owner.company_slug,
          granularity_key: owner.granularity_key,
          crm_label: owner.crm_label,
        })),
      },
    });
  }
}

export function collectInventoryCollisions(snapshot: InventorySnapshot): InventoryCollision[] {
  const collisions: InventoryCollision[] = [];
  collectAgentCollisions(snapshot.agents, collisions);
  collectMerchantCollisions(
    snapshot.merchants,
    snapshot.bookedLeadMerchantSnapshots,
    collisions,
  );
  collectSourceCollisions(snapshot.sourceCompanies, collisions);
  const granularities = flattenGranularities(snapshot.sourceCompanies);
  const activePhoneOwners = collectPhoneCollisions(granularities, collisions);
  collectCplCollisions(snapshot.sourceCompanies, snapshot.cplRates, collisions);
  collectRingCentralCollisions(granularities, activePhoneOwners, collisions);
  return sortCollisions(collisions);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashInventoryValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function computeInventoryChecksum(snapshot: InventorySnapshot): string {
  const collisions = collectInventoryCollisions(snapshot);
  const payload = {
    agents: [...snapshot.agents].sort((left, right) => left.id.localeCompare(right.id)),
    merchants: [...snapshot.merchants].sort((left, right) => left.id.localeCompare(right.id)),
    source_companies: [...snapshot.sourceCompanies].sort((left, right) =>
      left.company_slug.localeCompare(right.company_slug),
    ),
    cpl_rates: [...snapshot.cplRates].sort((left, right) => left.label.localeCompare(right.label)),
    form_lead_counts: [...snapshot.formLeadCounts].sort((left, right) =>
      `${left.source_company}:${left.source_granularity_key}:${left.cpl}`.localeCompare(
        `${right.source_company}:${right.source_granularity_key}:${right.cpl}`,
      ),
    ),
    call_lead_counts: [...snapshot.callLeadCounts].sort((left, right) =>
      `${left.source_company}:${left.source_granularity_key}:${left.cpl}`.localeCompare(
        `${right.source_company}:${right.source_granularity_key}:${right.cpl}`,
      ),
    ),
    booked_lead_merchant_snapshots: [...snapshot.bookedLeadMerchantSnapshots].sort(
      (left, right) => left.normalized.localeCompare(right.normalized),
    ),
    collisions,
    static_authority_references: STATIC_AUTHORITY_REFERENCES,
  };
  return hashInventoryValue(payload);
}

function summarizeCollisions(collisions: InventoryCollision[]) {
  const byCategory: Record<string, number> = {};
  let blocking = 0;
  let reviewable = 0;
  for (const collision of collisions) {
    byCategory[collision.category] = (byCategory[collision.category] ?? 0) + 1;
    if (collision.severity === "blocking") {
      blocking += 1;
    } else {
      reviewable += 1;
    }
  }
  return {
    blocking,
    reviewable,
    total: collisions.length,
    by_category: Object.fromEntries(
      Object.entries(byCategory).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function buildOperationsRegistryInventoryManifest(input: {
  snapshot: InventorySnapshot;
  databaseName: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  gitSha?: string;
  operator?: string;
}): OperationsRegistryInventoryManifest {
  const collisions = collectInventoryCollisions(input.snapshot);
  const conflictSummary = summarizeCollisions(collisions);
  const granularities = flattenGranularities(input.snapshot.sourceCompanies);
  const formLeadTotal = input.snapshot.formLeadCounts.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  const callLeadTotal = input.snapshot.callLeadCounts.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );

  return {
    run_id: input.runId,
    script_version: SCRIPT_VERSION,
    git_sha: input.gitSha,
    database_name: input.databaseName,
    mode: "dry_run",
    started_at: input.startedAt,
    completed_at: input.completedAt,
    operator: input.operator,
    source_counts: {
      agents: input.snapshot.agents.length,
      merchants: input.snapshot.merchants.length,
      source_companies: input.snapshot.sourceCompanies.length,
      embedded_granularities: granularities.length,
      cpl_rates: input.snapshot.cplRates.length,
      form_leads: formLeadTotal,
      call_leads: callLeadTotal,
      booked_lead_merchant_snapshots: input.snapshot.bookedLeadMerchantSnapshots.length,
      static_ringcentral_numbers: Object.keys(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE).length,
    },
    planned: {
      creates: 0,
      updates: 0,
      no_ops: 0,
      conflicts: collisions.length,
    },
    applied: {
      creates: 0,
      updates: 0,
      no_ops: 0,
      failures: 0,
    },
    mapping_checksum: computeInventoryChecksum(input.snapshot),
    conflict_summary: conflictSummary,
    collisions,
    validation_summary: {
      read_only: true,
      has_blocking_collisions: conflictSummary.blocking > 0,
      has_reviewable_collisions: conflictSummary.reviewable > 0,
      static_authority_reference_count: STATIC_AUTHORITY_REFERENCES.length,
    },
    static_authority_references: [...STATIC_AUTHORITY_REFERENCES],
    inventory: {
      agents: [...input.snapshot.agents].sort((left, right) =>
        left.normalized_name.localeCompare(right.normalized_name),
      ),
      merchants: [...input.snapshot.merchants].sort((left, right) =>
        left.normalized_name.localeCompare(right.normalized_name),
      ),
      source_companies: [...input.snapshot.sourceCompanies].sort((left, right) =>
        left.company_slug.localeCompare(right.company_slug),
      ),
      cpl_rates: [...input.snapshot.cplRates].sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
      embedded_cpl_by_granularity: granularities
        .map((granularity) => ({
          company_slug: granularity.company_slug,
          granularity_key: granularity.granularity_key,
          channel: granularity.channel,
          crm_label: granularity.crm_label,
          cpl: granularity.cpl,
          local: granularity.local,
        }))
        .sort((left, right) =>
          `${left.company_slug}:${left.granularity_key}`.localeCompare(
            `${right.company_slug}:${right.granularity_key}`,
          ),
        ),
      form_lead_counts: [...input.snapshot.formLeadCounts].sort((left, right) =>
        `${left.source_company}:${left.source_granularity_key}:${left.cpl}`.localeCompare(
          `${right.source_company}:${right.source_granularity_key}:${right.cpl}`,
        ),
      ),
      call_lead_counts: [...input.snapshot.callLeadCounts].sort((left, right) =>
        `${left.source_company}:${left.source_granularity_key}:${left.cpl}`.localeCompare(
          `${right.source_company}:${right.source_granularity_key}:${right.cpl}`,
        ),
      ),
      booked_lead_merchant_snapshots: [...input.snapshot.bookedLeadMerchantSnapshots].sort(
        (left, right) => left.normalized.localeCompare(right.normalized),
      ),
      static_ringcentral_numbers: Object.entries(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE)
        .map(([phoneNumber, mapping]) => ({
          phone_number: phoneNumber,
          source_label: mapping.sourceLabel,
          source_company: mapping.sourceCompany,
        }))
        .sort((left, right) => left.phone_number.localeCompare(right.phone_number)),
      embedded_inbound_phone_numbers: granularities
        .flatMap((granularity) =>
          granularity.inbound_phone_numbers
            .map((phone) => normalizePhoneNumberToE164Like(phone))
            .filter((phone): phone is string => Boolean(phone))
            .map((phoneNumber) => ({
              company_slug: granularity.company_slug,
              granularity_key: granularity.granularity_key,
              crm_label: granularity.crm_label,
              phone_number: phoneNumber,
            })),
        )
        .sort((left, right) =>
          `${left.phone_number}:${left.company_slug}:${left.granularity_key}`.localeCompare(
            `${right.phone_number}:${right.company_slug}:${right.granularity_key}`,
          ),
        ),
    },
    resume_cursor: null,
  };
}

export function assertNoApplyFlag(args: readonly string[]): void {
  if (args.includes("--apply") || args.includes("--production-apply")) {
    throw new Error(
      "Operations registry inventory (S0) is read-only and does not support --apply or --production-apply.",
    );
  }
}

export function assertInventoryDatabaseAllowed(
  databaseName: string | undefined,
  args: readonly string[],
): asserts databaseName is string {
  if (!databaseName) {
    throw new Error("Cannot run inventory: connected database name is unknown.");
  }
  if (databaseName === HISTORICAL_DATABASE) {
    throw new Error(
      `Refusing inventory against historical database ${HISTORICAL_DATABASE}.`,
    );
  }
  if (databaseName === TEST_DATABASE) {
    return;
  }
  if (databaseName === PRODUCTION_DATABASE) {
    if (!args.includes(PRODUCTION_CONFIRMATION)) {
      throw new Error(
        `Refusing production inventory without explicit confirmation flag ${PRODUCTION_CONFIRMATION}.`,
      );
    }
    return;
  }
  throw new Error(
    `Refusing inventory against unknown database "${databaseName}". Allowed targets: ${TEST_DATABASE}, or ${PRODUCTION_DATABASE} with ${PRODUCTION_CONFIRMATION}.`,
  );
}

export function redactInventoryManifestForOutput(
  manifest: OperationsRegistryInventoryManifest,
): OperationsRegistryInventoryManifest {
  return redactInventoryValue(manifest) as OperationsRegistryInventoryManifest;
}

function redactInventoryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactInventoryValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "spreadsheet_id" ||
      /(?:secret|token|password|authorization|credential|cookie|private[_-]?key)/i.test(
        key,
      )
    ) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactInventoryValue(nested);
    }
  }
  return redacted;
}

export type LabelMappingProposalClassification =
  | "ok"
  | "zero_match"
  | "multiple_match"
  | "cross_company";

export type LabelInventoryOrigin =
  | "static_map"
  | "feed_crm_label"
  | "feed_alias"
  | "lead_snapshot";

export type LabelInventoryEntry = {
  label: string;
  namespace: "sheet_lead_source" | "legacy_api_source";
  static_company_slug?: string;
  origin: LabelInventoryOrigin;
};

export type LabelMappingProposal = {
  label: string;
  normalized_label: string;
  namespace: "sheet_lead_source" | "legacy_api_source";
  origin: LabelInventoryOrigin;
  static_company_slug?: string;
  matched_feed_ids: string[];
  matched_company_ids: string[];
  matched_company_slugs: string[];
  classification: LabelMappingProposalClassification;
  source_company?: string;
  source_granularity?: string;
};

export type LabelMappingProposalInput = {
  labels: Array<{
    label: string;
    namespace: "sheet_lead_source" | "legacy_api_source";
    static_company_slug?: string;
    origin?: LabelInventoryOrigin;
  }>;
  feeds: Array<{
    id: string;
    company_id: string;
    company_slug: string;
    crm_label: string;
    aliases: string[];
    active: boolean;
  }>;
};

const LABEL_ORIGIN_RANK: Record<LabelInventoryOrigin, number> = {
  static_map: 0,
  feed_crm_label: 1,
  feed_alias: 2,
  lead_snapshot: 3,
};

/**
 * Deduplicate inventory labels by namespace + normalized spelling.
 * Prefer the static map, then Feed crm_label, then Feed alias, then Lead snapshot.
 */
export function collectLabelMappingInventoryLabels(input: {
  staticLabels: Array<{
    label: string;
    namespace: "sheet_lead_source" | "legacy_api_source";
    static_company_slug?: string;
  }>;
  feeds: Array<{ crm_label: string; aliases: string[] }>;
  leadSnapshots: readonly string[];
}): LabelInventoryEntry[] {
  const candidates: LabelInventoryEntry[] = [];
  for (const entry of input.staticLabels) {
    candidates.push({ ...entry, origin: "static_map" });
  }
  for (const feed of input.feeds) {
    if (feed.crm_label.trim()) {
      candidates.push({
        label: feed.crm_label,
        namespace: "sheet_lead_source",
        origin: "feed_crm_label",
      });
    }
    for (const alias of feed.aliases) {
      if (alias.trim()) {
        candidates.push({
          label: alias,
          namespace: "sheet_lead_source",
          origin: "feed_alias",
        });
      }
    }
  }
  for (const snapshot of input.leadSnapshots) {
    if (snapshot.trim()) {
      candidates.push({
        label: snapshot,
        namespace: "sheet_lead_source",
        origin: "lead_snapshot",
      });
    }
  }

  const best = new Map<string, LabelInventoryEntry>();
  for (const candidate of candidates) {
    const key = `${candidate.namespace}:${normalizeSourceLabel(candidate.label)}`;
    const existing = best.get(key);
    if (
      !existing ||
      LABEL_ORIGIN_RANK[candidate.origin] < LABEL_ORIGIN_RANK[existing.origin]
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()].sort((left, right) =>
    `${left.namespace}:${normalizeSourceLabel(left.label)}`.localeCompare(
      `${right.namespace}:${normalizeSourceLabel(right.label)}`,
    ),
  );
}

export type LabelMappingManifest = {
  kind: "operations-registry-label-mappings";
  proposals: Array<{
    label: string;
    normalized_label: string;
    namespace: "sheet_lead_source" | "legacy_api_source";
    source_company: string;
    source_granularity: string;
    classification: "ok";
  }>;
  checksum: string;
};

export function proposeLabelMappings(
  input: LabelMappingProposalInput,
): LabelMappingProposal[] {
  return input.labels.map((entry) => {
    const normalized = normalizeSourceLabel(entry.label);
    const matches = input.feeds.filter((feed) => {
      const labels = [feed.crm_label, ...feed.aliases];
      return labels.some((candidate) => normalizeSourceLabel(candidate) === normalized);
    });
    const companyIds = [...new Set(matches.map((feed) => feed.company_id))];
    const companySlugs = [...new Set(matches.map((feed) => feed.company_slug))];
    let classification: LabelMappingProposalClassification = "ok";
    if (matches.length === 0) {
      classification = "zero_match";
    } else if (matches.length > 1 || companyIds.length > 1) {
      classification = companyIds.length > 1 ? "cross_company" : "multiple_match";
    } else if (
      entry.static_company_slug &&
      companySlugs[0] &&
      entry.static_company_slug !== companySlugs[0]
    ) {
      classification = "cross_company";
    }
    const firstMatch = matches[0];
    return {
      label: entry.label,
      normalized_label: normalized,
      namespace: entry.namespace,
      origin: entry.origin ?? "static_map",
      static_company_slug: entry.static_company_slug,
      matched_feed_ids: matches.map((feed) => feed.id),
      matched_company_ids: companyIds,
      matched_company_slugs: companySlugs,
      classification,
      ...(classification === "ok" && firstMatch
        ? {
            source_company: firstMatch.company_id,
            source_granularity: firstMatch.id,
          }
        : {}),
    };
  });
}

export function summarizeLabelMappingClassifications(
  proposals: readonly LabelMappingProposal[],
): Record<LabelMappingProposalClassification, number> {
  return {
    ok: proposals.filter((item) => item.classification === "ok").length,
    zero_match: proposals.filter((item) => item.classification === "zero_match").length,
    multiple_match: proposals.filter((item) => item.classification === "multiple_match").length,
    cross_company: proposals.filter((item) => item.classification === "cross_company").length,
  };
}

export function blockingLabelMappingProposals(
  proposals: readonly LabelMappingProposal[],
): LabelMappingProposal[] {
  return proposals.filter((item) => item.classification !== "ok");
}

export function buildLabelMappingManifest(
  proposals: readonly LabelMappingProposal[],
): LabelMappingManifest {
  const blocking = blockingLabelMappingProposals(proposals);
  if (blocking.length) {
    throw new Error(
      `Refusing to emit a label-mapping manifest while ${blocking.length} proposal(s) are not ok: ${blocking
        .map((item) => `${item.label} (${item.classification})`)
        .join(", ")}.`,
    );
  }
  const ok = proposals
    .filter((item) => item.classification === "ok")
    .map((item) => ({
      label: item.label,
      normalized_label: item.normalized_label,
      namespace: item.namespace,
      source_company: item.source_company!,
      source_granularity: item.source_granularity!,
      classification: "ok" as const,
    }))
    .sort((left, right) =>
      `${left.namespace}:${left.normalized_label}`.localeCompare(
        `${right.namespace}:${right.normalized_label}`,
      ),
    );
  return {
    kind: "operations-registry-label-mappings",
    proposals: ok,
    checksum: computeLabelMappingManifestChecksum(ok),
  };
}

export function computeLabelMappingManifestChecksum(
  proposals: LabelMappingManifest["proposals"],
): string {
  return hashInventoryValue({
    kind: "operations-registry-label-mappings",
    proposals,
  });
}

export function summarizeLabelInventoryOrigins(
  proposals: readonly LabelMappingProposal[],
): Record<LabelInventoryOrigin, number> {
  return {
    static_map: proposals.filter((item) => item.origin === "static_map").length,
    feed_crm_label: proposals.filter((item) => item.origin === "feed_crm_label").length,
    feed_alias: proposals.filter((item) => item.origin === "feed_alias").length,
    lead_snapshot: proposals.filter((item) => item.origin === "lead_snapshot").length,
  };
}

export function assertLabelMappingManifestChecksum(manifest: LabelMappingManifest): void {
  const expected = computeLabelMappingManifestChecksum(manifest.proposals);
  if (manifest.checksum !== expected) {
    throw new Error(
      `Label-mapping manifest checksum mismatch. Expected ${expected}, received ${manifest.checksum}.`,
    );
  }
}

export type EmbeddedGranularityUsageReport = {
  indexes: Array<{
    fields: string;
    purpose: string;
  }>;
  readers: Array<{
    path: string;
    kind: "read" | "write" | "index" | "test" | "script";
    still_live: boolean;
    notes: string;
  }>;
  removed_in_this_pass: false;
};

export function reportEmbeddedGranularitiesUsage(): EmbeddedGranularityUsageReport {
  return {
    indexes: [
      {
        fields: "granularities.granularity_key",
        purpose: "legacy embedded Feed key lookup",
      },
      {
        fields: "granularities.crm_label",
        purpose: "legacy embedded outgoing-label lookup",
      },
      {
        fields: "granularities.inbound_phone_numbers",
        purpose: "legacy embedded inbound-phone lookup",
      },
    ],
    readers: [
      {
        path: "src/models/LeadSourceCompany.ts",
        kind: "index",
        still_live: true,
        notes: "Schema still embeds granularities[] and declares the three indexes. Nothing dropped.",
      },
      {
        path: "src/services/leadSourceCompanies/leadSourceCompany.service.ts",
        kind: "read",
        still_live: true,
        notes: "Seed, list, and legacy resolveLeadSource still project the embedded array.",
      },
      {
        path: "src/services/operationsRegistry/sourceRegistry.ts",
        kind: "read",
        still_live: true,
        notes: "toCompanyItem still maps doc.granularities when present.",
      },
      {
        path: "src/services/cpl/cplRate.service.ts",
        kind: "read",
        still_live: true,
        notes: "Admin CPL list still walks company.granularities.",
      },
      {
        path: "src/services/operationsRegistry/sourceModels.test.ts",
        kind: "write",
        still_live: true,
        notes: "Validation fixture still writes an embedded granularity for schema defaults.",
      },
      {
        path: "scripts/migrations/operations-registry-inventory.lib.ts",
        kind: "script",
        still_live: true,
        notes: "Inventory still records embedded granularities as migration evidence.",
      },
    ],
    removed_in_this_pass: false,
  };
}
