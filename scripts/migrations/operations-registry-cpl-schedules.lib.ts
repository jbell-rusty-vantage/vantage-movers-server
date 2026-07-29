import mongoose from "mongoose";
import {
  cplRateCacheKey,
  type CplLeadType,
} from "../../src/config/domain/cplRateDefinitions";
import { CPL_BUSINESS_TIME_ZONE } from "../../src/models/CplRatePeriod";
import {
  businessDateToUtc,
  dollarsToCents,
} from "../../src/services/operationsRegistry/cplSchedule";
import {
  computeMigrationChecksum,
  countPlannedActions,
  sortMigrationCollisions,
  summarizeMigrationCollisions,
  type MigrationCollision,
  type OperationsRegistryMigrationManifestBase,
} from "./operations-registry-migration.lib";

export const SCRIPT_VERSION = "operations-registry-cpl-schedules-m4";

export const M4_CUTOVER_CHANGE_REASON = "M4 cutover schedule seed";

export const M4_SYSTEM_ACTOR = {
  actor_type: "system" as const,
  actor_id: "operations-registry-cpl-schedules-m4",
  actor_label: "M4 CPL schedule seed",
  actor_role: "system",
};

export type CplAuthority =
  | "embedded_granularity"
  | "cpl_rates"
  | "embedded_granularity+cpl_rates";

export type ActiveGranularityInput = {
  id: string;
  source_company_id: string;
  company_slug: string;
  granularity_key: string;
  channel: "form" | "call";
  owner_label: string;
  crm_label: string;
  local?: string;
  active: boolean;
  schedule_revision: number;
};

export type EmbeddedCplInput = {
  company_slug: string;
  granularity_key: string;
  channel: "form" | "call";
  local?: string;
  crm_label: string;
  cpl: number;
};

export type LegacyCplRateInput = {
  id?: string;
  label: string;
  source_company: string;
  lead_type: CplLeadType;
  local?: string;
  cpl: number;
};

export type ExistingPeriodInput = {
  id: string;
  source_granularity_id: string;
  amount_cents: number;
  effective_from_date: string;
  archived_at?: Date | string | null;
};

export type CplSchedulesSnapshot = {
  cutover_date: string;
  activeGranularities: ActiveGranularityInput[];
  embeddedCpls: EmbeddedCplInput[];
  cplRates: LegacyCplRateInput[];
  existingPeriods: ExistingPeriodInput[];
};

export type CplScheduleMigrationAction =
  | "create"
  | "noop_existing_schedule"
  | "conflict";

export type CplSchedulePlanItem = {
  source_granularity_id: string;
  granularity_key: string;
  company_slug: string;
  channel: "form" | "call";
  action: CplScheduleMigrationAction;
  cutover_date: string;
  business_timezone: typeof CPL_BUSINESS_TIME_ZONE;
  amount_cents?: number;
  source_value?: number;
  authority?: CplAuthority;
  expected_revision?: number;
  next_revision?: number;
  period?: {
    amount_cents: number;
    effective_from_date: string;
    effective_from_iso: string;
    business_timezone: typeof CPL_BUSINESS_TIME_ZONE;
    change_reason: string;
  };
  conflict?: {
    code: string;
    message: string;
  };
};

export type CplSchedulesPlan = {
  schedules: CplSchedulePlanItem[];
  collisions: MigrationCollision[];
  resume_cursor: {
    completed_granularity_ids: string[];
  };
};

export type CplSchedulesManifest = OperationsRegistryMigrationManifestBase & {
  cutover_date: string;
  business_timezone: typeof CPL_BUSINESS_TIME_ZONE;
  source_counts: {
    active_first_class_granularities: number;
    embedded_cpl_rows: number;
    cpl_rates: number;
    existing_non_archived_periods: number;
  };
  validation_summary: {
    dry_run_performed_no_writes: boolean;
    has_blocking_collisions: boolean;
    no_historical_periods_inferred: true;
    lead_fields_untouched: true;
    existing_schedules_not_overwritten: true;
  };
  plan: {
    schedules: CplSchedulePlanItem[];
  };
  proposed_schedules: Array<{
    source_granularity_id: string;
    granularity_key: string;
    company_slug: string;
    cutover_date: string;
    business_timezone: typeof CPL_BUSINESS_TIME_ZONE;
    amount_cents: number;
    source_value: number;
    authority: CplAuthority;
  }>;
};

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CPL_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatAmericaNewYorkBusinessDate(now: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD in modern Node Intl implementations.
  return businessDateFormatter.format(now);
}

export function resolveCutoverBusinessDate(
  args: readonly string[],
  now: Date = new Date(),
): string {
  const flag = args.find((arg) => arg.startsWith("--cutover-date="));
  const value = flag ? flag.slice("--cutover-date=".length).trim() : formatAmericaNewYorkBusinessDate(now);
  businessDateToUtc(value);
  return value;
}

function rateCacheKey(
  sourceCompany: string,
  leadType: CplLeadType,
  local: string | undefined,
): string {
  return cplRateCacheKey(
    sourceCompany as Parameters<typeof cplRateCacheKey>[0],
    leadType,
    local as Parameters<typeof cplRateCacheKey>[2],
  );
}

function findEmbeddedCpl(
  granularity: ActiveGranularityInput,
  embeddedCpls: readonly EmbeddedCplInput[],
): EmbeddedCplInput | undefined {
  return embeddedCpls.find(
    (entry) =>
      entry.granularity_key === granularity.granularity_key &&
      entry.company_slug === granularity.company_slug,
  );
}

function findLegacyCplRate(
  granularity: ActiveGranularityInput,
  cplRates: readonly LegacyCplRateInput[],
  embedded?: EmbeddedCplInput,
): LegacyCplRateInput | undefined {
  const targetKey = rateCacheKey(
    granularity.company_slug,
    granularity.channel,
    granularity.local ?? embedded?.local,
  );
  return cplRates.find(
    (rate) =>
      rateCacheKey(rate.source_company, rate.lead_type, rate.local) === targetKey,
  );
}

function resolveAmountAuthority(input: {
  granularity: ActiveGranularityInput;
  embedded?: EmbeddedCplInput;
  legacy?: LegacyCplRateInput;
}): {
  amount_cents?: number;
  source_value?: number;
  authority?: CplAuthority;
  conflict?: MigrationCollision;
} {
  const { granularity, embedded, legacy } = input;
  const hasEmbedded = embedded !== undefined;
  const hasLegacy = legacy !== undefined;

  if (!hasEmbedded && !hasLegacy) {
    return {
      conflict: {
        code: "missing_cpl_authority",
        severity: "blocking",
        category: "cpl",
        message: `No embedded or cpl_rates CPL found for ${granularity.company_slug}/${granularity.granularity_key}.`,
        details: {
          source_granularity_id: granularity.id,
          company_slug: granularity.company_slug,
          granularity_key: granularity.granularity_key,
        },
      },
    };
  }

  if (hasEmbedded && hasLegacy) {
    const embeddedCents = dollarsToCents(embedded.cpl);
    const legacyCents = dollarsToCents(legacy.cpl);
    if (embeddedCents !== legacyCents) {
      return {
        conflict: {
          code: "embedded_cpl_vs_cpl_rates_disagreement",
          severity: "blocking",
          category: "cpl",
          message: `Embedded CPL and cpl_rates disagree for ${granularity.company_slug}/${granularity.granularity_key}; owner review required.`,
          details: {
            source_granularity_id: granularity.id,
            company_slug: granularity.company_slug,
            granularity_key: granularity.granularity_key,
            embedded_cpl: embedded.cpl,
            embedded_amount_cents: embeddedCents,
            cpl_rates_cpl: legacy.cpl,
            cpl_rates_amount_cents: legacyCents,
            cpl_rates_label: legacy.label,
          },
        },
      };
    }
    return {
      amount_cents: embeddedCents,
      source_value: embedded.cpl,
      authority: "embedded_granularity+cpl_rates",
    };
  }

  if (hasEmbedded) {
    return {
      amount_cents: dollarsToCents(embedded.cpl),
      source_value: embedded.cpl,
      authority: "embedded_granularity",
    };
  }

  return {
    amount_cents: dollarsToCents(legacy!.cpl),
    source_value: legacy!.cpl,
    authority: "cpl_rates",
  };
}

function buildPeriodProposal(
  cutoverDate: string,
  amountCents: number,
): NonNullable<CplSchedulePlanItem["period"]> {
  const effectiveFrom = businessDateToUtc(cutoverDate);
  return {
    amount_cents: amountCents,
    effective_from_date: cutoverDate,
    effective_from_iso: effectiveFrom.toISOString(),
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    change_reason: M4_CUTOVER_CHANGE_REASON,
  };
}

export function buildCplSchedulesPlan(
  snapshot: CplSchedulesSnapshot,
  resumeCursor: CplSchedulesPlan["resume_cursor"] = {
    completed_granularity_ids: [],
  },
): CplSchedulesPlan {
  businessDateToUtc(snapshot.cutover_date);
  const completed = new Set(resumeCursor.completed_granularity_ids);
  const existingByGranularity = new Map<string, ExistingPeriodInput[]>();
  for (const period of snapshot.existingPeriods) {
    if (period.archived_at) {
      continue;
    }
    const list = existingByGranularity.get(period.source_granularity_id) ?? [];
    list.push(period);
    existingByGranularity.set(period.source_granularity_id, list);
  }

  const schedules: CplSchedulePlanItem[] = [];
  const collisions: MigrationCollision[] = [];

  for (const granularity of snapshot.activeGranularities) {
    if (!granularity.active) {
      continue;
    }
    if (completed.has(granularity.id)) {
      continue;
    }

    const base: Omit<CplSchedulePlanItem, "action"> = {
      source_granularity_id: granularity.id,
      granularity_key: granularity.granularity_key,
      company_slug: granularity.company_slug,
      channel: granularity.channel,
      cutover_date: snapshot.cutover_date,
      business_timezone: CPL_BUSINESS_TIME_ZONE,
    };

    const existing = existingByGranularity.get(granularity.id) ?? [];
    if (existing.length > 0) {
      schedules.push({
        ...base,
        action: "noop_existing_schedule",
        expected_revision: granularity.schedule_revision,
      });
      continue;
    }

    const embedded = findEmbeddedCpl(granularity, snapshot.embeddedCpls);
    const resolved = resolveAmountAuthority({
      granularity,
      embedded,
      legacy: findLegacyCplRate(granularity, snapshot.cplRates, embedded),
    });

    if (resolved.conflict) {
      collisions.push(resolved.conflict);
      schedules.push({
        ...base,
        action: "conflict",
        conflict: {
          code: resolved.conflict.code,
          message: resolved.conflict.message,
        },
      });
      continue;
    }

    const amountCents = resolved.amount_cents!;
    const nextRevision = granularity.schedule_revision + 1;
    schedules.push({
      ...base,
      action: "create",
      amount_cents: amountCents,
      source_value: resolved.source_value,
      authority: resolved.authority,
      expected_revision: granularity.schedule_revision,
      next_revision: nextRevision,
      period: buildPeriodProposal(snapshot.cutover_date, amountCents),
    });
  }

  const sortedSchedules = [...schedules].sort((left, right) =>
    `${left.company_slug}:${left.granularity_key}`.localeCompare(
      `${right.company_slug}:${right.granularity_key}`,
    ),
  );

  return {
    schedules: sortedSchedules,
    collisions: sortMigrationCollisions(collisions),
    resume_cursor: resumeCursor,
  };
}

function buildChecksumPayload(
  snapshot: CplSchedulesSnapshot,
  plan: CplSchedulesPlan,
): unknown {
  return {
    cutover_date: snapshot.cutover_date,
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    active_granularities: [...snapshot.activeGranularities]
      .map((entry) => ({
        id: entry.id,
        company_slug: entry.company_slug,
        granularity_key: entry.granularity_key,
        channel: entry.channel,
        local: entry.local ?? null,
        schedule_revision: entry.schedule_revision,
      }))
      .sort((left, right) =>
        `${left.company_slug}:${left.granularity_key}`.localeCompare(
          `${right.company_slug}:${right.granularity_key}`,
        ),
      ),
    embedded_cpls: [...snapshot.embeddedCpls]
      .map((entry) => ({
        company_slug: entry.company_slug,
        granularity_key: entry.granularity_key,
        cpl: entry.cpl,
      }))
      .sort((left, right) =>
        `${left.company_slug}:${left.granularity_key}`.localeCompare(
          `${right.company_slug}:${right.granularity_key}`,
        ),
      ),
    cpl_rates: [...snapshot.cplRates]
      .map((entry) => ({
        label: entry.label,
        source_company: entry.source_company,
        lead_type: entry.lead_type,
        local: entry.local ?? null,
        cpl: entry.cpl,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    existing_periods: [...snapshot.existingPeriods]
      .filter((period) => !period.archived_at)
      .map((period) => ({
        id: period.id,
        source_granularity_id: period.source_granularity_id,
        amount_cents: period.amount_cents,
        effective_from_date: period.effective_from_date,
      }))
      .sort((left, right) =>
        `${left.source_granularity_id}:${left.effective_from_date}:${left.id}`.localeCompare(
          `${right.source_granularity_id}:${right.effective_from_date}:${right.id}`,
        ),
      ),
    schedule_plan: plan.schedules,
    collisions: plan.collisions,
  };
}

export function buildCplSchedulesManifest(input: {
  snapshot: CplSchedulesSnapshot;
  plan: CplSchedulesPlan;
  databaseName: string;
  mode: "dry_run" | "apply";
  runId: string;
  startedAt: string;
  completedAt: string;
  gitSha?: string;
  operator?: string;
  applied?: CplSchedulesManifest["applied"];
}): CplSchedulesManifest {
  const conflictSummary = summarizeMigrationCollisions(input.plan.collisions);
  const nonArchivedPeriods = input.snapshot.existingPeriods.filter(
    (period) => !period.archived_at,
  ).length;
  const proposed = input.plan.schedules
    .filter(
      (item): item is CplSchedulePlanItem & {
        amount_cents: number;
        source_value: number;
        authority: CplAuthority;
      } =>
        item.action === "create" &&
        item.amount_cents !== undefined &&
        item.source_value !== undefined &&
        item.authority !== undefined,
    )
    .map((item) => ({
      source_granularity_id: item.source_granularity_id,
      granularity_key: item.granularity_key,
      company_slug: item.company_slug,
      cutover_date: item.cutover_date,
      business_timezone: CPL_BUSINESS_TIME_ZONE,
      amount_cents: item.amount_cents,
      source_value: item.source_value,
      authority: item.authority,
    }));

  return {
    run_id: input.runId,
    script_version: SCRIPT_VERSION,
    git_sha: input.gitSha,
    database_name: input.databaseName,
    mode: input.mode,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    operator: input.operator,
    cutover_date: input.snapshot.cutover_date,
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    source_counts: {
      active_first_class_granularities: input.snapshot.activeGranularities.length,
      embedded_cpl_rows: input.snapshot.embeddedCpls.length,
      cpl_rates: input.snapshot.cplRates.length,
      existing_non_archived_periods: nonArchivedPeriods,
    },
    planned: countPlannedActions(input.plan.schedules),
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
      no_historical_periods_inferred: true,
      lead_fields_untouched: true,
      existing_schedules_not_overwritten: true,
    },
    plan: {
      schedules: input.plan.schedules,
    },
    proposed_schedules: proposed,
    resume_cursor: input.plan.resume_cursor,
  };
}

export function cplScheduleMigrationInsertDocument(
  plan: CplSchedulePlanItem,
): Record<string, unknown> | null {
  if (plan.action !== "create" || !plan.period || plan.next_revision === undefined) {
    return null;
  }
  return {
    source_granularity: new mongoose.Types.ObjectId(plan.source_granularity_id),
    amount_cents: plan.period.amount_cents,
    effective_from: businessDateToUtc(plan.period.effective_from_date),
    effective_from_date: plan.period.effective_from_date,
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    schedule_revision: plan.next_revision,
    change_reason: plan.period.change_reason,
    created_by: { ...M4_SYSTEM_ACTOR },
  };
}

export function granularityRevisionCompareFilter(
  plan: CplSchedulePlanItem,
): { _id: string; schedule_revision: number } | null {
  if (plan.action !== "create" || plan.expected_revision === undefined) {
    return null;
  }
  return {
    _id: plan.source_granularity_id,
    schedule_revision: plan.expected_revision,
  };
}

export function advanceCplSchedulesResumeCursor(
  cursor: CplSchedulesPlan["resume_cursor"],
  appliedGranularityIds: readonly string[],
): CplSchedulesPlan["resume_cursor"] {
  return {
    completed_granularity_ids: [
      ...new Set([...cursor.completed_granularity_ids, ...appliedGranularityIds]),
    ].sort(),
  };
}
