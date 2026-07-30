import { createHash } from "node:crypto";
import { normalizePhoneNumberToE164Like } from "../../src/services/ringcentral/phone-normalization";

export const RINGCENTRAL_BACKFILL_SCRIPT_VERSION =
  "operations-registry-ringcentral-m5-v2";

export type RingCentralSeedMapping = {
  phone_number: string;
  source_company: string;
  source_label: string;
};
export type RingCentralBackfillCompany = {
  id: string;
  company_slug: string;
  active: boolean;
  default_call_granularity?: string | null;
  embedded_call_numbers: Array<{
    granularity_key: string;
    phone_numbers: string[];
  }>;
};
export type RingCentralBackfillGranularity = {
  id: string;
  source_company: string;
  granularity_key: string;
  channel: "form" | "call";
  crm_label: string;
  active: boolean;
};
export type ExistingRingCentralRoute = {
  id: string;
  phone_number: string;
  active: boolean;
  validation_status: string;
};
export type ExistingRingCentralAssignment = {
  id: string;
  route: string;
  source_granularity: string;
  effective_until?: Date | null;
};
export type RingCentralBackfillSnapshot = {
  static_mappings: RingCentralSeedMapping[];
  companies: RingCentralBackfillCompany[];
  granularities: RingCentralBackfillGranularity[];
  routes: ExistingRingCentralRoute[];
  assignments: ExistingRingCentralAssignment[];
};
export type RingCentralBackfillMapping = {
  phone_number: string;
  source_company_id: string;
  company_slug: string;
  source_granularity_id: string;
  granularity_key: string;
  source_label: string;
  provenance: string[];
};
export type RingCentralBackfillConflict = {
  code: string;
  phone_number?: string;
  message: string;
  blocking: true;
};
export type RingCentralBackfillPlan = {
  mappings: RingCentralBackfillMapping[];
  conflicts: RingCentralBackfillConflict[];
  routes: Array<{
    phone_number: string;
    route_id?: string;
    action: "create" | "update" | "noop";
    source_granularity_id: string;
    assignment_action: "create" | "noop" | "conflict";
  }>;
  mapping_checksum: string;
};

export function buildRingCentralBackfillPlan(
  snapshot: RingCentralBackfillSnapshot,
): RingCentralBackfillPlan {
  const companiesById = new Map(
    snapshot.companies.map((company) => [company.id, company]),
  );
  const companiesBySlug = new Map(
    snapshot.companies.map((company) => [company.company_slug, company]),
  );
  const granularitiesById = new Map(
    snapshot.granularities.map((granularity) => [granularity.id, granularity]),
  );
  const granularitiesByKey = new Map(
    snapshot.granularities.map((granularity) => [
      granularity.granularity_key,
      granularity,
    ]),
  );
  const candidates: RingCentralBackfillMapping[] = [];
  const conflicts: RingCentralBackfillConflict[] = [];

  for (const seed of snapshot.static_mappings) {
    const phone = normalizePhoneNumberToE164Like(seed.phone_number);
    const company = companiesBySlug.get(seed.source_company);
    if (!phone || !company?.active) {
      conflicts.push(blocking(
        "static_mapping_company_unresolved",
        `Static mapping ${seed.phone_number} does not resolve to an active Source Company.`,
        phone ?? seed.phone_number,
      ));
      continue;
    }
    const matches = snapshot.granularities.filter(
      (granularity) =>
        granularity.source_company === company.id &&
        granularity.channel === "call" &&
        granularity.active &&
        granularity.crm_label.trim().toLowerCase() ===
          seed.source_label.trim().toLowerCase(),
    );
    const defaultGranularity = company.default_call_granularity
      ? granularitiesById.get(company.default_call_granularity)
      : undefined;
    const granularity = matches.length === 1
      ? matches[0]
      : matches.length === 0 &&
          defaultGranularity?.active &&
          defaultGranularity.channel === "call" &&
          defaultGranularity.source_company === company.id
        ? defaultGranularity
        : undefined;
    if (!granularity || matches.length > 1) {
      conflicts.push(blocking(
        matches.length > 1
          ? "static_mapping_ambiguous_granularity"
          : "static_mapping_granularity_unresolved",
        `Static mapping ${phone} does not resolve to exactly one active call granularity.`,
        phone,
      ));
      continue;
    }
    candidates.push(mapping(phone, company, granularity, seed.source_label, "static"));
  }

  for (const company of snapshot.companies) {
    for (const embedded of company.embedded_call_numbers) {
      const granularity = granularitiesByKey.get(embedded.granularity_key);
      for (const rawPhone of embedded.phone_numbers) {
        const phone = normalizePhoneNumberToE164Like(rawPhone);
        if (
          !phone ||
          !company.active ||
          !granularity?.active ||
          granularity.channel !== "call" ||
          granularity.source_company !== company.id
        ) {
          conflicts.push(blocking(
            "embedded_number_granularity_unresolved",
            `Embedded inbound number ${rawPhone} does not resolve to its active first-class call granularity.`,
            phone ?? rawPhone,
          ));
          continue;
        }
        candidates.push(mapping(
          phone,
          company,
          granularity,
          granularity.crm_label,
          "embedded",
        ));
      }
    }
  }

  const consolidated = new Map<string, RingCentralBackfillMapping>();
  for (const candidate of candidates) {
    const existing = consolidated.get(candidate.phone_number);
    if (!existing) {
      consolidated.set(candidate.phone_number, candidate);
      continue;
    }
    if (existing.source_granularity_id !== candidate.source_granularity_id) {
      conflicts.push(blocking(
        "number_assignment_conflict",
        `Number ${candidate.phone_number} resolves to multiple granularities.`,
        candidate.phone_number,
      ));
      continue;
    }
    existing.provenance = [...new Set([
      ...existing.provenance,
      ...candidate.provenance,
    ])].sort();
  }

  const mappings = [...consolidated.values()].sort((left, right) =>
    left.phone_number.localeCompare(right.phone_number),
  );
  const existingRoutes = new Map(
    snapshot.routes.map((route) => [
      normalizePhoneNumberToE164Like(route.phone_number) ?? route.phone_number,
      route,
    ]),
  );
  const openAssignmentsByRoute = new Map<string, ExistingRingCentralAssignment[]>();
  for (const assignment of snapshot.assignments) {
    if (assignment.effective_until) continue;
    openAssignmentsByRoute.set(assignment.route, [
      ...(openAssignmentsByRoute.get(assignment.route) ?? []),
      assignment,
    ]);
  }
  const routes = mappings.map((item) => {
    const route = existingRoutes.get(item.phone_number);
    const open = route ? openAssignmentsByRoute.get(route.id) ?? [] : [];
    let assignmentAction: "create" | "noop" | "conflict" = "create";
    if (open.length > 1) assignmentAction = "conflict";
    else if (open[0]?.source_granularity === item.source_granularity_id) {
      assignmentAction = "noop";
    } else if (open.length === 1) {
      assignmentAction = "conflict";
    }
    if (assignmentAction === "conflict") {
      conflicts.push(blocking(
        "existing_open_assignment_conflict",
        `Existing route ${item.phone_number} has an incompatible open assignment.`,
        item.phone_number,
      ));
    }
    return {
      phone_number: item.phone_number,
      route_id: route?.id,
      action: route
        ? route.active && route.validation_status === "valid" &&
            assignmentAction === "noop"
          ? "noop" as const
          : "update" as const
        : "create" as const,
      source_granularity_id: item.source_granularity_id,
      assignment_action: assignmentAction,
    };
  });
  return {
    mappings,
    conflicts: uniqueConflicts(conflicts),
    routes,
    mapping_checksum: checksum(mappings),
  };
}

function mapping(
  phone: string,
  company: RingCentralBackfillCompany,
  granularity: RingCentralBackfillGranularity,
  sourceLabel: string,
  provenance: string,
): RingCentralBackfillMapping {
  return {
    phone_number: phone,
    source_company_id: company.id,
    company_slug: company.company_slug,
    source_granularity_id: granularity.id,
    granularity_key: granularity.granularity_key,
    source_label: sourceLabel,
    provenance: [provenance],
  };
}
function blocking(
  code: string,
  message: string,
  phone?: string,
): RingCentralBackfillConflict {
  return { code, message, phone_number: phone, blocking: true };
}
function uniqueConflicts(
  conflicts: RingCentralBackfillConflict[],
): RingCentralBackfillConflict[] {
  return [...new Map(
    conflicts.map((item) => [
      `${item.code}|${item.phone_number ?? ""}|${item.message}`,
      item,
    ]),
  ).values()].sort((left, right) =>
    `${left.code}|${left.phone_number ?? ""}`.localeCompare(
      `${right.code}|${right.phone_number ?? ""}`,
    ),
  );
}
function checksum(mappings: RingCentralBackfillMapping[]): string {
  const stable = mappings.map((item) => ({
    phone_number: item.phone_number,
    company_slug: item.company_slug,
    source_granularity_id: item.source_granularity_id,
    granularity_key: item.granularity_key,
  }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
