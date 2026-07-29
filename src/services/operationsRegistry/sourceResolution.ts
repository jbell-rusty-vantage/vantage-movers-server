export type RegistrySourceChannel = "form" | "call";

export type RegistrySourceCompanyRecord = {
  id: string;
  company_slug: string;
  owner_label: string;
  aliases: string[];
  active: boolean;
  default_form_granularity?: string;
  default_call_granularity?: string;
};

export type RegistrySourceGranularityRecord = {
  id: string;
  source_company: string;
  granularity_key: string;
  channel: RegistrySourceChannel;
  owner_label: string;
  crm_label: string;
  aliases: string[];
  source_sites: string[];
  priority: number;
  local?: "local" | "long_distance";
  active: boolean;
  schedule_revision: number;
};

export type SourceAttributionInput = {
  channel: RegistrySourceChannel;
  company_slug?: string | null;
  granularity_key?: string | null;
  crm_label?: string | null;
  source_site?: string | null;
  fallback_alias?: string | null;
  local?: "local" | "long_distance";
  allow_company_identifier_fallback?: boolean;
};

export type SourceAttribution = {
  company_id: string;
  company_slug: string;
  company_label_snapshot: string;
  granularity_id: string;
  granularity_key: string;
  granularity_label_snapshot: string;
  crm_label_snapshot: string;
  match_kind: "exact" | "default" | "fallback";
  registry_revision: number;
};

export type SourceResolutionPreview =
  | { status: "resolved"; attribution: SourceAttribution }
  | {
      status: "not_found";
      identifier_kind: "company" | "exact" | "default" | "fallback";
      identifier: string | null;
    }
  | {
      status: "ambiguous";
      identifier_kind: "company" | "exact" | "fallback";
      identifier: string;
      candidate_ids: string[];
      priority?: number;
    };

export function previewSourceAttribution(
  companies: readonly RegistrySourceCompanyRecord[],
  granularities: readonly RegistrySourceGranularityRecord[],
  input: SourceAttributionInput,
): SourceResolutionPreview {
  const activeCompanies = companies.filter((company) => company.active);
  let companyResult = selectCompany(activeCompanies, input.company_slug);
  if (companyResult.status !== "resolved") {
    if (
      input.allow_company_identifier_fallback &&
      companyResult.status === "not_found"
    ) {
      companyResult = { status: "resolved" };
    } else {
      return companyResult;
    }
  }

  const candidates = granularities.filter(
    (granularity) =>
      granularity.active &&
      granularity.channel === input.channel &&
      (!companyResult.company ||
        granularity.source_company === companyResult.company.id),
  );

  const exact = firstIdentifier([
    ["granularity_key", input.granularity_key],
    ["crm_label", input.crm_label],
    ["source_site", input.source_site],
  ]);
  if (exact) {
    const matches = candidates.filter((candidate) =>
      exactMatches(candidate, exact.kind, exact.value),
    );
    if (matches.length > 1) {
      return ambiguous("exact", exact.value, matches);
    }
    if (matches.length === 1) {
      return resolved(companies, matches[0], "exact");
    }
    if (!normalize(input.fallback_alias)) {
      return {
        status: "not_found",
        identifier_kind: "exact",
        identifier: exact.value,
      };
    }
  }

  if (input.local) {
    const localMatches = candidates.filter(
      (candidate) => candidate.local === input.local,
    );
    if (localMatches.length === 1) {
      return resolved(companies, localMatches[0], "exact");
    }
    if (localMatches.length > 1) {
      return ambiguous("exact", input.local, localMatches);
    }
  }

  const fallback = normalize(input.fallback_alias);
  if (fallback) {
    const matches = candidates.filter((candidate) =>
      candidate.aliases.some((alias) => normalize(alias) === fallback),
    );
    if (matches.length) {
      const highestPriority = Math.max(...matches.map((match) => match.priority));
      const preferred = matches.filter(
        (match) => match.priority === highestPriority,
      );
      if (preferred.length > 1) {
        return {
          ...ambiguous("fallback", fallback, preferred),
          priority: highestPriority,
        };
      }
      return resolved(companies, preferred[0], "fallback");
    }
    if (!companyResult.company) {
      return {
        status: "not_found",
        identifier_kind: "fallback",
        identifier: fallback,
      };
    }
  }

  const company = companyResult.company;
  if (!company) {
    return {
      status: "not_found",
      identifier_kind: "company",
      identifier: null,
    };
  }
  const defaultId =
    input.channel === "form"
      ? company.default_form_granularity
      : company.default_call_granularity;
  const defaultGranularity = candidates.find(
    (candidate) => candidate.id === defaultId,
  );
  if (!defaultGranularity) {
    return {
      status: "not_found",
      identifier_kind: "default",
      identifier: defaultId ?? null,
    };
  }
  return resolved(companies, defaultGranularity, "default");
}

function selectCompany(
  companies: readonly RegistrySourceCompanyRecord[],
  rawValue: string | null | undefined,
):
  | { status: "resolved"; company?: RegistrySourceCompanyRecord }
  | Extract<SourceResolutionPreview, { status: "not_found" | "ambiguous" }> {
  const value = normalize(rawValue);
  if (!value) {
    return { status: "resolved" };
  }
  const matches = companies.filter(
    (company) =>
      normalize(company.company_slug) === value ||
      company.aliases.some((alias) => normalize(alias) === value),
  );
  if (matches.length === 1) {
    return { status: "resolved", company: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      identifier_kind: "company",
      identifier: value,
      candidate_ids: matches.map((match) => match.id).sort(),
    };
  }
  return {
    status: "not_found",
    identifier_kind: "company",
    identifier: value,
  };
}

function resolved(
  companies: readonly RegistrySourceCompanyRecord[],
  granularity: RegistrySourceGranularityRecord,
  match_kind: SourceAttribution["match_kind"],
): SourceResolutionPreview {
  const company = companies.find(
    (candidate) => candidate.id === granularity.source_company,
  );
  if (!company?.active) {
    return {
      status: "not_found",
      identifier_kind: "company",
      identifier: granularity.source_company,
    };
  }
  return {
    status: "resolved",
    attribution: {
      company_id: company.id,
      company_slug: company.company_slug,
      company_label_snapshot: company.owner_label,
      granularity_id: granularity.id,
      granularity_key: granularity.granularity_key,
      granularity_label_snapshot: granularity.owner_label,
      crm_label_snapshot: granularity.crm_label,
      match_kind,
      registry_revision: granularity.schedule_revision,
    },
  };
}

function exactMatches(
  candidate: RegistrySourceGranularityRecord,
  kind: string,
  value: string,
): boolean {
  if (kind === "granularity_key") {
    return normalize(candidate.granularity_key) === value;
  }
  if (kind === "crm_label") {
    return normalize(candidate.crm_label) === value;
  }
  return candidate.source_sites.some((site) => normalize(site) === value);
}

function firstIdentifier(
  values: ReadonlyArray<readonly [string, string | null | undefined]>,
): { kind: string; value: string } | undefined {
  for (const [kind, rawValue] of values) {
    const value = normalize(rawValue);
    if (value) {
      return { kind, value };
    }
  }
  return undefined;
}

function ambiguous(
  identifier_kind: "exact" | "fallback",
  identifier: string,
  matches: readonly RegistrySourceGranularityRecord[],
): Extract<SourceResolutionPreview, { status: "ambiguous" }> {
  return {
    status: "ambiguous",
    identifier_kind,
    identifier,
    candidate_ids: matches.map((match) => match.id).sort(),
  };
}

function normalize(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}
