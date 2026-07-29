import mongoose from "mongoose";
import {
  computeMigrationChecksum,
  countPlannedActions,
  sortMigrationCollisions,
  summarizeMigrationCollisions,
  type MigrationCollision,
  type OperationsRegistryMigrationManifestBase,
} from "./operations-registry-migration.lib";

export const SCRIPT_VERSION = "operations-registry-source-granularities-m3";

export type EmbeddedGranularityInput = {
  id: string;
  granularity_key: string;
  channel: "form" | "call";
  owner_label: string;
  crm_label: string;
  aliases: string[];
  active: boolean;
  local?: string;
  source_sites: string[];
  inbound_phone_numbers: string[];
  priority: number;
  sheet_tab_name?: string;
  cpl: number;
};

export type SourceCompanyMigrationInput = {
  id: string;
  company_slug: string;
  default_form_granularity_key?: string | null;
  default_call_granularity_key?: string | null;
  default_form_granularity?: string | null;
  default_call_granularity?: string | null;
  sheet_config?: {
    spreadsheet_id?: string | null;
    has_bad_tabs?: boolean;
    projection_mode?: string;
  } | null;
  granularities: EmbeddedGranularityInput[];
};

export type ExistingGranularityRecord = {
  id: string;
  source_company: string;
  granularity_key: string;
  channel: "form" | "call";
  owner_label: string;
  crm_label: string;
  aliases: string[];
  active: boolean;
  local?: string;
  source_sites: string[];
  priority: number;
  sheet_tab_name?: string;
};

export type GranularityMigrationAction =
  | "create_granularity"
  | "noop_granularity"
  | "conflict";

export type CompanyMigrationAction = "update_company" | "noop_company";

export type GranularityMigrationPlanItem = {
  company_id: string;
  company_slug: string;
  embedded_id: string;
  granularity_key: string;
  action: GranularityMigrationAction;
  target_id?: string;
  document?: Omit<ExistingGranularityRecord, "id"> & { id: string };
  mapping?: {
    company_id: string;
    company_slug: string;
    embedded_id: string;
    granularity_key: string;
    first_class_id: string;
  };
  conflict?: {
    code: string;
    message: string;
  };
};

export type CompanyMigrationPlanItem = {
  company_id: string;
  company_slug: string;
  action: CompanyMigrationAction;
  update?: {
    default_form_granularity?: string;
    default_call_granularity?: string;
    default_form_granularity_key?: string;
    default_call_granularity_key?: string;
    sheet_config?: {
      spreadsheet_id?: string;
      has_bad_tabs: boolean;
      projection_mode: "derived_import" | "direct_write";
    };
  };
};

export type SourceGranularitiesSnapshot = {
  companies: SourceCompanyMigrationInput[];
  existingGranularities: ExistingGranularityRecord[];
};

export type SourceGranularitiesPlan = {
  granularities: GranularityMigrationPlanItem[];
  companies: CompanyMigrationPlanItem[];
  collisions: MigrationCollision[];
  mappings: NonNullable<GranularityMigrationPlanItem["mapping"]>[];
  resume_cursor: {
    completed_granularity_keys: string[];
    completed_company_ids: string[];
  };
};

export type SourceGranularitiesManifest = OperationsRegistryMigrationManifestBase & {
  source_counts: {
    source_companies: number;
    embedded_granularities: number;
    existing_first_class_granularities: number;
  };
  validation_summary: {
    dry_run_performed_no_writes: boolean;
    has_blocking_collisions: boolean;
    embedded_arrays_untouched: true;
    one_mapped_document_per_embedded: boolean;
    defaults_resolve_to_mapped_ids: boolean;
  };
  plan: {
    granularities: GranularityMigrationPlanItem[];
    companies: CompanyMigrationPlanItem[];
  };
  mappings: SourceGranularitiesPlan["mappings"];
};

const DEFAULT_PROJECTION_MODE = "derived_import" as const;

function isValidObjectIdString(value: string): boolean {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return false;
  }
  return String(new mongoose.Types.ObjectId(value)) === value;
}

function normalizeKey(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function granularityDocumentMatches(
  left: ExistingGranularityRecord,
  right: Omit<ExistingGranularityRecord, "id"> & { id?: string },
): boolean {
  return (
    left.source_company === right.source_company &&
    left.granularity_key === right.granularity_key &&
    left.channel === right.channel &&
    left.owner_label === right.owner_label &&
    left.crm_label === right.crm_label &&
    left.active === right.active &&
    left.local === right.local &&
    left.priority === right.priority &&
    left.sheet_tab_name === right.sheet_tab_name &&
    stableAliases(left.aliases) === stableAliases(right.aliases) &&
    stableAliases(left.source_sites) === stableAliases(right.source_sites)
  );
}

function stableAliases(values: readonly string[]): string {
  return [...values].map((value) => value.trim()).sort().join("|");
}

function buildTargetDocument(
  company: SourceCompanyMigrationInput,
  embedded: EmbeddedGranularityInput,
  targetId: string,
): ExistingGranularityRecord {
  return {
    id: targetId,
    source_company: company.id,
    granularity_key: embedded.granularity_key,
    channel: embedded.channel,
    owner_label: embedded.owner_label,
    crm_label: embedded.crm_label,
    aliases: [...embedded.aliases],
    active: embedded.active,
    local: embedded.local,
    source_sites: [...embedded.source_sites],
    priority: embedded.priority,
    sheet_tab_name: embedded.sheet_tab_name,
  };
}

function resolvePreservedId(
  embedded: EmbeddedGranularityInput,
  existingById: Map<string, ExistingGranularityRecord>,
  reservedIds: Set<string>,
): { id?: string; conflict?: MigrationCollision } {
  if (!isValidObjectIdString(embedded.id)) {
    return {};
  }
  const existing = existingById.get(embedded.id);
  if (existing && existing.granularity_key !== embedded.granularity_key) {
    return {
      conflict: {
        code: "embedded_id_granularity_key_collision",
        severity: "blocking",
        category: "source",
        message: `Embedded granularity id ${embedded.id} is already used by a different granularity key.`,
        details: {
          embedded_id: embedded.id,
          embedded_key: embedded.granularity_key,
          existing_key: existing.granularity_key,
        },
      },
    };
  }
  if (reservedIds.has(embedded.id)) {
    return {
      conflict: {
        code: "embedded_id_duplicate_in_plan",
        severity: "blocking",
        category: "source",
        message: `Embedded granularity id ${embedded.id} appears more than once in the migration input.`,
        details: { embedded_id: embedded.id, granularity_key: embedded.granularity_key },
      },
    };
  }
  return { id: embedded.id };
}

function buildGranularityPlanItem(input: {
  company: SourceCompanyMigrationInput;
  embedded: EmbeddedGranularityInput;
  existingById: Map<string, ExistingGranularityRecord>;
  existingByKey: Map<string, ExistingGranularityRecord>;
  reservedIds: Set<string>;
}): GranularityMigrationPlanItem {
  const { company, embedded, existingById, existingByKey, reservedIds } = input;
  const base = {
    company_id: company.id,
    company_slug: company.company_slug,
    embedded_id: embedded.id,
    granularity_key: embedded.granularity_key,
  };
  const preserved = resolvePreservedId(embedded, existingById, reservedIds);
  if (preserved.conflict) {
    return {
      ...base,
      action: "conflict",
      conflict: {
        code: preserved.conflict.code,
        message: preserved.conflict.message,
      },
    };
  }

  const matchedExisting = existingByKey.get(embedded.granularity_key);
  const targetId =
    preserved.id ?? matchedExisting?.id ?? new mongoose.Types.ObjectId().toString();
  if (preserved.id) {
    reservedIds.add(preserved.id);
  }

  const document = buildTargetDocument(company, embedded, targetId);
  const mapping = {
    company_id: company.id,
    company_slug: company.company_slug,
    embedded_id: embedded.id,
    granularity_key: embedded.granularity_key,
    first_class_id: targetId,
  };

  if (matchedExisting) {
    if (!granularityDocumentMatches(matchedExisting, document)) {
      return {
        ...base,
        action: "conflict",
        conflict: {
          code: "existing_granularity_document_mismatch",
          message: `First-class granularity ${embedded.granularity_key} exists with different fields.`,
        },
      };
    }
    return {
      ...base,
      action: "noop_granularity",
      target_id: targetId,
      document,
      mapping,
    };
  }

  if (
    existingById.has(targetId) &&
    existingById.get(targetId)!.granularity_key !== embedded.granularity_key
  ) {
    return {
      ...base,
      action: "conflict",
      conflict: {
        code: "target_id_granularity_key_collision",
        message: `Cannot preserve id ${targetId} for granularity ${embedded.granularity_key}.`,
      },
    };
  }

  return {
    ...base,
    action: "create_granularity",
    target_id: targetId,
    document,
    mapping,
  };
}

function buildCompanyPlanItem(
  company: SourceCompanyMigrationInput,
  mappings: Map<string, string>,
): CompanyMigrationPlanItem {
  const formKey = normalizeKey(company.default_form_granularity_key);
  const callKey = normalizeKey(company.default_call_granularity_key);
  const formId = formKey ? mappings.get(formKey) : undefined;
  const callId = callKey ? mappings.get(callKey) : undefined;

  const currentProjection = company.sheet_config?.projection_mode;
  const projectionMode: "derived_import" | "direct_write" =
    currentProjection === "direct_write" || currentProjection === "derived_import"
      ? currentProjection
      : DEFAULT_PROJECTION_MODE;
  const sheetConfig = {
    spreadsheet_id: company.sheet_config?.spreadsheet_id ?? undefined,
    has_bad_tabs: company.sheet_config?.has_bad_tabs ?? false,
    projection_mode: projectionMode,
  };

  const update: CompanyMigrationPlanItem["update"] = {};
  let needsUpdate = false;

  if (formId && company.default_form_granularity !== formId) {
    update.default_form_granularity = formId;
    needsUpdate = true;
  }
  if (callId && company.default_call_granularity !== callId) {
    update.default_call_granularity = callId;
    needsUpdate = true;
  }
  if (formKey && company.default_form_granularity_key !== formKey) {
    update.default_form_granularity_key = formKey;
    needsUpdate = true;
  }
  if (callKey && company.default_call_granularity_key !== callKey) {
    update.default_call_granularity_key = callKey;
    needsUpdate = true;
  }
  if (
    !currentProjection ||
    (currentProjection !== "direct_write" && currentProjection !== "derived_import")
  ) {
    update.sheet_config = sheetConfig;
    needsUpdate = true;
  } else if (sheetConfig.has_bad_tabs !== (company.sheet_config?.has_bad_tabs ?? false)) {
    update.sheet_config = sheetConfig;
    needsUpdate = true;
  }

  return {
    company_id: company.id,
    company_slug: company.company_slug,
    action: needsUpdate ? "update_company" : "noop_company",
    ...(needsUpdate ? { update } : {}),
  };
}

function collectGranularityKeyCollisions(
  snapshot: SourceGranularitiesSnapshot,
): MigrationCollision[] {
  const collisions: MigrationCollision[] = [];
  const keyOwners = new Map<string, Set<string>>();

  for (const company of snapshot.companies) {
    for (const embedded of company.granularities) {
      const owners = keyOwners.get(embedded.granularity_key) ?? new Set<string>();
      owners.add(embedded.id);
      keyOwners.set(embedded.granularity_key, owners);
    }
  }

  for (const existing of snapshot.existingGranularities) {
    const owners = keyOwners.get(existing.granularity_key) ?? new Set<string>();
    owners.add(existing.id);
    keyOwners.set(existing.granularity_key, owners);
  }

  for (const [granularityKey, owners] of keyOwners.entries()) {
    if (owners.size <= 1) {
      continue;
    }
    collisions.push({
      code: "granularity_key_collision",
      severity: "blocking",
      category: "source",
      message: `Granularity key "${granularityKey}" is used by multiple records.`,
      details: {
        granularity_key: granularityKey,
        record_ids: [...owners].sort(),
      },
    });
  }

  return collisions;
}

function collectDefaultResolutionCollisions(
  companies: SourceCompanyMigrationInput[],
  mappings: Map<string, string>,
): MigrationCollision[] {
  const collisions: MigrationCollision[] = [];
  for (const company of companies) {
    for (const channel of ["form", "call"] as const) {
      const key =
        channel === "form"
          ? normalizeKey(company.default_form_granularity_key)
          : normalizeKey(company.default_call_granularity_key);
      if (!key) {
        continue;
      }
      if (!mappings.has(key)) {
        collisions.push({
          code: "default_granularity_key_unmapped",
          severity: "blocking",
          category: "source",
          message: `Default ${channel} key "${key}" for ${company.company_slug} does not map to a first-class granularity.`,
          details: { company_slug: company.company_slug, channel, granularity_key: key },
        });
      }
    }
  }
  return collisions;
}

export function buildSourceGranularitiesPlan(
  snapshot: SourceGranularitiesSnapshot,
  resumeCursor: SourceGranularitiesPlan["resume_cursor"] = {
    completed_granularity_keys: [],
    completed_company_ids: [],
  },
): SourceGranularitiesPlan {
  const completedKeys = new Set(resumeCursor.completed_granularity_keys);
  const completedCompanies = new Set(resumeCursor.completed_company_ids);
  const existingById = new Map(
    snapshot.existingGranularities.map((entry) => [entry.id, entry]),
  );
  const existingByKey = new Map(
    snapshot.existingGranularities.map((entry) => [entry.granularity_key, entry]),
  );
  const reservedIds = new Set<string>();
  const granularities: GranularityMigrationPlanItem[] = [];
  const mappingsByKey = new Map<string, string>();

  for (const company of snapshot.companies) {
    for (const embedded of company.granularities) {
      if (completedKeys.has(embedded.granularity_key)) {
        const existing = existingByKey.get(embedded.granularity_key);
        if (existing) {
          mappingsByKey.set(embedded.granularity_key, existing.id);
        }
        continue;
      }
      const item = buildGranularityPlanItem({
        company,
        embedded,
        existingById,
        existingByKey,
        reservedIds,
      });
      granularities.push(item);
      if (item.mapping) {
        mappingsByKey.set(item.granularity_key, item.mapping.first_class_id);
        existingByKey.set(item.granularity_key, item.document!);
        existingById.set(item.mapping.first_class_id, item.document!);
      }
    }
  }

  for (const existing of snapshot.existingGranularities) {
    if (!mappingsByKey.has(existing.granularity_key)) {
      mappingsByKey.set(existing.granularity_key, existing.id);
    }
  }

  const companies = snapshot.companies
    .filter((company) => !completedCompanies.has(company.id))
    .map((company) => buildCompanyPlanItem(company, mappingsByKey));

  const collisions = sortMigrationCollisions([
    ...granularities
      .filter((item) => item.action === "conflict" && item.conflict)
      .map((item) => ({
        code: item.conflict!.code,
        severity: "blocking" as const,
        category: "source",
        message: item.conflict!.message,
        details: {
          company_slug: item.company_slug,
          embedded_id: item.embedded_id,
          granularity_key: item.granularity_key,
        },
      })),
    ...collectGranularityKeyCollisions(snapshot),
    ...collectDefaultResolutionCollisions(snapshot.companies, mappingsByKey),
  ]);

  return {
    granularities: [...granularities].sort((left, right) =>
      `${left.company_slug}:${left.granularity_key}`.localeCompare(
        `${right.company_slug}:${right.granularity_key}`,
      ),
    ),
    companies: [...companies].sort((left, right) =>
      left.company_slug.localeCompare(right.company_slug),
    ),
    collisions,
    mappings: granularities
      .filter((item): item is GranularityMigrationPlanItem & { mapping: NonNullable<GranularityMigrationPlanItem["mapping"]> } =>
        Boolean(item.mapping),
      )
      .map((item) => item.mapping)
      .sort((left, right) =>
        `${left.company_slug}:${left.granularity_key}`.localeCompare(
          `${right.company_slug}:${right.granularity_key}`,
        ),
      ),
    resume_cursor: resumeCursor,
  };
}

function buildChecksumPayload(
  snapshot: SourceGranularitiesSnapshot,
  plan: SourceGranularitiesPlan,
): unknown {
  return {
    companies: [...snapshot.companies]
      .map((company) => ({
        id: company.id,
        company_slug: company.company_slug,
        default_form_granularity_key: normalizeKey(company.default_form_granularity_key),
        default_call_granularity_key: normalizeKey(company.default_call_granularity_key),
        granularities: [...company.granularities]
          .map((granularity) => ({
            id: granularity.id,
            granularity_key: granularity.granularity_key,
            channel: granularity.channel,
          }))
          .sort((left, right) => left.granularity_key.localeCompare(right.granularity_key)),
      }))
      .sort((left, right) => left.company_slug.localeCompare(right.company_slug)),
    existing_granularities: [...snapshot.existingGranularities]
      .map((entry) => ({ id: entry.id, granularity_key: entry.granularity_key }))
      .sort((left, right) => left.granularity_key.localeCompare(right.granularity_key)),
    granularity_plan: plan.granularities,
    company_plan: plan.companies,
    mappings: plan.mappings,
    collisions: plan.collisions,
  };
}

export function buildSourceGranularitiesManifest(input: {
  snapshot: SourceGranularitiesSnapshot;
  plan: SourceGranularitiesPlan;
  databaseName: string;
  mode: "dry_run" | "apply";
  runId: string;
  startedAt: string;
  completedAt: string;
  gitSha?: string;
  operator?: string;
  applied?: SourceGranularitiesManifest["applied"];
}): SourceGranularitiesManifest {
  const embeddedCount = input.snapshot.companies.reduce(
    (sum, company) => sum + company.granularities.length,
    0,
  );
  const completedKeys = new Set(input.plan.resume_cursor.completed_granularity_keys);
  const pendingEmbeddedCount = input.snapshot.companies.reduce(
    (sum, company) =>
      sum +
      company.granularities.filter(
        (granularity) => !completedKeys.has(granularity.granularity_key),
      ).length,
    0,
  );
  const conflictSummary = summarizeMigrationCollisions(input.plan.collisions);
  const mappedPending = input.plan.mappings.filter(
    (mapping) => !completedKeys.has(mapping.granularity_key),
  ).length;
  const defaultsResolve = input.plan.collisions.every(
    (collision) => collision.code !== "default_granularity_key_unmapped",
  );

  return {
    run_id: input.runId,
    script_version: SCRIPT_VERSION,
    git_sha: input.gitSha,
    database_name: input.databaseName,
    mode: input.mode,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    operator: input.operator,
    source_counts: {
      source_companies: input.snapshot.companies.length,
      embedded_granularities: embeddedCount,
      existing_first_class_granularities: input.snapshot.existingGranularities.length,
    },
    planned: {
      creates: countPlannedActions(input.plan.granularities).creates,
      updates:
        countPlannedActions(input.plan.granularities).updates +
        countPlannedActions(input.plan.companies).updates,
      no_ops:
        countPlannedActions(input.plan.granularities).no_ops +
        countPlannedActions(input.plan.companies).no_ops,
      conflicts: input.plan.collisions.length,
    },
    applied: input.applied ?? {
      creates: 0,
      updates: 0,
      no_ops: 0,
      failures: 0,
    },
    mapping_checksum: computeMigrationChecksum(
      buildChecksumPayload(input.snapshot, input.plan),
    ),
    conflict_summary: conflictSummary,
    collisions: input.plan.collisions,
    validation_summary: {
      dry_run_performed_no_writes: input.mode === "dry_run",
      has_blocking_collisions: conflictSummary.blocking > 0,
      embedded_arrays_untouched: true,
      one_mapped_document_per_embedded:
        mappedPending === pendingEmbeddedCount &&
        !input.plan.granularities.some((item) => item.action === "conflict"),
      defaults_resolve_to_mapped_ids: defaultsResolve,
    },
    plan: {
      granularities: input.plan.granularities,
      companies: input.plan.companies,
    },
    mappings: input.plan.mappings,
    resume_cursor: input.plan.resume_cursor,
  };
}

export function redactSourceGranularitiesManifestForOutput(
  manifest: SourceGranularitiesManifest,
): SourceGranularitiesManifest {
  const output = structuredClone(manifest);
  for (const company of output.plan.companies) {
    const update = company.update;
    if (update?.sheet_config?.spreadsheet_id) {
      update.sheet_config.spreadsheet_id = "[redacted]";
    }
  }
  return output;
}

export function granularityMigrationInsertDocument(
  plan: GranularityMigrationPlanItem,
): Record<string, unknown> | null {
  if (plan.action !== "create_granularity" || !plan.document) {
    return null;
  }
  return {
    _id: new mongoose.Types.ObjectId(plan.document.id),
    source_company: new mongoose.Types.ObjectId(plan.document.source_company),
    granularity_key: plan.document.granularity_key,
    channel: plan.document.channel,
    owner_label: plan.document.owner_label,
    crm_label: plan.document.crm_label,
    aliases: plan.document.aliases,
    active: plan.document.active,
    local: plan.document.local,
    source_sites: plan.document.source_sites,
    priority: plan.document.priority,
    sheet_tab_name: plan.document.sheet_tab_name,
    schedule_revision: 0,
    created_from: "migration",
  };
}

export function companyMigrationUpdateFilter(
  plan: CompanyMigrationPlanItem,
): Record<string, unknown> | null {
  if (plan.action !== "update_company" || !plan.update) {
    return null;
  }
  const setPayload: Record<string, unknown> = {};
  if (plan.update.default_form_granularity) {
    setPayload.default_form_granularity = new mongoose.Types.ObjectId(
      plan.update.default_form_granularity,
    );
  }
  if (plan.update.default_call_granularity) {
    setPayload.default_call_granularity = new mongoose.Types.ObjectId(
      plan.update.default_call_granularity,
    );
  }
  if (plan.update.default_form_granularity_key) {
    setPayload.default_form_granularity_key = plan.update.default_form_granularity_key;
  }
  if (plan.update.default_call_granularity_key) {
    setPayload.default_call_granularity_key = plan.update.default_call_granularity_key;
  }
  if (plan.update.sheet_config) {
    setPayload["sheet_config.projection_mode"] = plan.update.sheet_config.projection_mode;
    setPayload["sheet_config.has_bad_tabs"] = plan.update.sheet_config.has_bad_tabs;
    if (plan.update.sheet_config.spreadsheet_id) {
      setPayload["sheet_config.spreadsheet_id"] = plan.update.sheet_config.spreadsheet_id;
    }
  }
  return { $set: setPayload };
}

export function advanceSourceGranularitiesResumeCursor(
  cursor: SourceGranularitiesPlan["resume_cursor"],
  appliedGranularityKeys: readonly string[],
  appliedCompanyIds: readonly string[],
): SourceGranularitiesPlan["resume_cursor"] {
  return {
    completed_granularity_keys: [
      ...new Set([...cursor.completed_granularity_keys, ...appliedGranularityKeys]),
    ].sort(),
    completed_company_ids: [
      ...new Set([...cursor.completed_company_ids, ...appliedCompanyIds]),
    ].sort(),
  };
}
