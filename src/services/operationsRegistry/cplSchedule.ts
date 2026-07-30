import mongoose, { type ClientSession } from "mongoose";
import {
  CPL_BUSINESS_TIME_ZONE,
  getCplRatePeriodModel,
} from "../../models/CplRatePeriod";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "./errors";
import { withRegistryMutation } from "./registryAudit";
import {
  recordRegistryResolverAttempt,
  recordRegistryResolverFailure,
  recordRegistryResolverSuccess,
} from "./runtimeTelemetry";
import type {
  RegistryActorContext,
  RegistryAuditInput,
  RegistryMutationInput,
} from "./types";

export type CplMoneyInput = number | string;

export type CplSchedulePeriod = {
  id?: string;
  source_granularity_id: string;
  amount_cents: number;
  effective_from: Date;
  effective_until?: Date;
  effective_from_date: string;
  effective_until_date_exclusive?: string;
  business_timezone: typeof CPL_BUSINESS_TIME_ZONE;
  schedule_revision?: number;
  supersedes?: string;
  change_reason?: string;
};

export type CplSchedulePeriodInput = {
  amount: CplMoneyInput;
  start_date: string;
  /** Owner-facing inclusive date. Omit only for the final open period. */
  end_date?: string;
};

export type CplScheduleValidationOptions = {
  active: boolean;
  coverage_start_date?: string;
};

export type CplResolution =
  | {
      status: "resolved";
      amount: number;
      amount_cents: number;
      period_id: string;
    }
  | { status: "missing_rate"; fallback_amount: 0 }
  | {
      status: "duplicate_zero";
      amount: 0;
      base_period_id?: string;
    }
  | { status: "not_applicable"; amount: 0 };

export type ResolveCplInput = {
  source_granularity_id?: string | null;
  business_timestamp: Date;
  duplicate?: boolean;
  applicable?: boolean;
};

export type AdvancedCplOperation =
  | {
      type: "add_future";
      effective_date: string;
      amount: CplMoneyInput;
    }
  | {
      type: "split";
      period_id: string;
      effective_date: string;
      amount: CplMoneyInput;
    }
  | {
      type: "replace_schedule";
      periods: CplSchedulePeriodInput[];
    }
  | {
      type: "correct_period";
      period_id: string;
      amount: CplMoneyInput;
    };

export type AdvancedCplScheduleCommand = {
  source_granularity_id: string;
  expected_revision: number;
  operation: AdvancedCplOperation;
  reason?: string;
};

export type SimpleCplScheduleCommand = {
  effective_date: string;
  expected_revisions: Record<string, number>;
  changes: Array<{
    source_granularity_id: string;
    amount: CplMoneyInput;
  }>;
  reason?: string;
};

export type CplScheduleState = {
  source_granularity_id: string;
  revision: number;
  active: boolean;
  periods: CplSchedulePeriod[];
};

export type CplScheduleCommandResult = {
  changed: boolean;
  schedules: CplScheduleState[];
};

type CplGranularityState = {
  id: string;
  active: boolean;
  schedule_revision: number;
};

type InsertCplPeriod = Omit<
  CplSchedulePeriod,
  "id" | "schedule_revision"
> & {
  schedule_revision: number;
};

export interface CplScheduleStore {
  loadGranularity(
    id: string,
    session?: ClientSession,
  ): Promise<CplGranularityState | null>;
  loadSchedule(
    sourceGranularityId: string,
    session?: ClientSession,
  ): Promise<CplSchedulePeriod[]>;
  compareAndIncrementRevision(
    id: string,
    expectedRevision: number,
    session: ClientSession,
  ): Promise<boolean>;
  archivePeriods(ids: string[], at: Date, session: ClientSession): Promise<void>;
  insertPeriods(
    periods: InsertCplPeriod[],
    actor: RegistryActorContext,
    session: ClientSession,
  ): Promise<CplSchedulePeriod[]>;
  findCoveringPeriods(
    sourceGranularityId: string,
    at: Date,
  ): Promise<CplSchedulePeriod[]>;
}

type RegistryMutationRunner = <T>(
  input: RegistryMutationInput<T>,
) => Promise<T>;

export type CplScheduleDependencies = {
  store?: CplScheduleStore;
  runMutation?: RegistryMutationRunner;
  now?: () => Date;
};

const businessDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CPL_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

/**
 * Converts an exact business calendar date to its New York local-midnight UTC
 * instant. The iterative wall-clock conversion handles both EST and EDT
 * without relying on the process timezone.
 */
export function businessDateToUtc(date: string): Date {
  const { year, month, day } = parseBusinessDate(date);
  const desiredWallTime = Date.UTC(year, month - 1, day);
  let instant = desiredWallTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = dateTimeParts(new Date(instant));
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = desiredWallTime - actualWallTime;
    instant += adjustment;
    if (adjustment === 0) break;
  }

  const result = new Date(instant);
  const actual = dateTimeParts(result);
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== 0 ||
    actual.minute !== 0 ||
    actual.second !== 0
  ) {
    throw new TypeError(`Unable to resolve ${date} in ${CPL_BUSINESS_TIME_ZONE}`);
  }
  return result;
}

export function ownerInclusiveEndDateToExclusive(endDate: string): {
  date: string;
  instant: Date;
} {
  const nextDate = addBusinessDays(endDate, 1);
  return { date: nextDate, instant: businessDateToUtc(nextDate) };
}

/**
 * Lead timestamps are persisted as owner-facing Eastern wall-clock components
 * in a Date field. CPL changes occur only at business-date boundaries, so map
 * that stored calendar day back to its real New York midnight before lookup.
 */
export function storedLeadTimestampToCplInstant(timestamp: Date): Date {
  assertValidTimestamp(timestamp);
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  return businessDateToUtc(`${year}-${month}-${day}`);
}

export function dollarsToCents(amount: CplMoneyInput): number {
  if (typeof amount === "string") {
    const value = amount.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
      throw invalidMoney();
    }
    const [whole, fraction = ""] = value.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents)) throw invalidMoney();
    return cents;
  }

  if (!Number.isFinite(amount) || amount < 0) throw invalidMoney();
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > tolerance) {
    throw invalidMoney();
  }
  return cents;
}

export function createCplPeriod(
  sourceGranularityId: string,
  input: CplSchedulePeriodInput,
  options: { supersedes?: string; change_reason?: string } = {},
): CplSchedulePeriod {
  const effectiveFrom = businessDateToUtc(input.start_date);
  const end = input.end_date
    ? ownerInclusiveEndDateToExclusive(input.end_date)
    : undefined;
  if (end && end.instant.getTime() <= effectiveFrom.getTime()) {
    throw scheduleInvalid("A period end date must not precede its start date.");
  }
  return {
    source_granularity_id: sourceGranularityId,
    amount_cents: dollarsToCents(input.amount),
    effective_from: effectiveFrom,
    ...(end ? { effective_until: end.instant } : {}),
    effective_from_date: input.start_date,
    ...(end ? { effective_until_date_exclusive: end.date } : {}),
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    ...(options.change_reason?.trim()
      ? { change_reason: options.change_reason.trim() }
      : {}),
  };
}

export function validateCplSchedule(
  periods: readonly CplSchedulePeriod[],
  options: CplScheduleValidationOptions,
): void {
  if (options.active && periods.length === 0) {
    throw scheduleGap("An active granularity requires CPL coverage.");
  }

  let openPeriods = 0;
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]!;
    assertPeriodShape(period);
    if (index > 0) {
      const previous = periods[index - 1]!;
      if (previous.effective_from.getTime() >= period.effective_from.getTime()) {
        throw scheduleInvalid("CPL periods must be ordered by effective date.");
      }
      if (!previous.effective_until) {
        throw scheduleOverlap("An open CPL period must be the final period.");
      }
      const previousEnd = previous.effective_until.getTime();
      const currentStart = period.effective_from.getTime();
      if (previousEnd > currentStart) {
        throw scheduleOverlap("CPL periods must not overlap.");
      }
      if (options.active && previousEnd < currentStart) {
        throw scheduleGap("An active CPL schedule must not contain gaps.");
      }
    }
    if (!period.effective_until) openPeriods += 1;
  }

  if (options.coverage_start_date && options.active) {
    const coverageStart = businessDateToUtc(options.coverage_start_date);
    if (
      !periods[0] ||
      periods[0].effective_from.getTime() > coverageStart.getTime()
    ) {
      throw scheduleGap("The active CPL schedule starts after required coverage.");
    }
  }

  if (
    options.active &&
    (openPeriods !== 1 || periods.at(-1)?.effective_until !== undefined)
  ) {
    throw scheduleGap(
      "An active CPL schedule requires exactly one open-ended final period.",
    );
  }
}

export function constructSimpleCplSchedule(
  current: readonly CplSchedulePeriod[],
  sourceGranularityId: string,
  effectiveDate: string,
  amount: CplMoneyInput,
  reason?: string,
): { changed: boolean; periods: CplSchedulePeriod[] } {
  const amountCents = dollarsToCents(amount);
  const effectiveAt = businessDateToUtc(effectiveDate);
  const covering = coveringPeriods(current, effectiveAt);
  if (covering.length === 1 && covering[0]!.amount_cents === amountCents) {
    return { changed: false, periods: cloneSchedule(current) };
  }

  const retained = current.filter(
    (period) =>
      period.effective_until !== undefined &&
      period.effective_until.getTime() <= effectiveAt.getTime(),
  );
  const containing = covering[0];
  const result = cloneSchedule(retained);
  if (
    containing &&
    containing.effective_from.getTime() < effectiveAt.getTime()
  ) {
    result.push(
      replacementPeriod(containing, {
        effective_until: effectiveAt,
        effective_until_date_exclusive: effectiveDate,
        reason,
      }),
    );
  }
  result.push(
    createCplPeriod(
      sourceGranularityId,
      { amount, start_date: effectiveDate },
      { change_reason: reason },
    ),
  );
  return { changed: true, periods: result };
}

export function constructAdvancedCplSchedule(
  current: readonly CplSchedulePeriod[],
  sourceGranularityId: string,
  operation: AdvancedCplOperation,
  reason?: string,
): CplSchedulePeriod[] {
  switch (operation.type) {
    case "replace_schedule":
      return operation.periods.map((period) =>
        createCplPeriod(sourceGranularityId, period, {
          change_reason: reason,
        }),
      );
    case "correct_period": {
      const target = requiredPeriod(current, operation.period_id);
      const cents = dollarsToCents(operation.amount);
      if (target.amount_cents === cents) return cloneSchedule(current);
      return current.map((period) =>
        period.id === target.id
          ? replacementPeriod(target, { amount_cents: cents, reason })
          : clonePeriod(period),
      );
    }
    case "add_future": {
      const finalPeriod = current.at(-1);
      if (!finalPeriod || finalPeriod.effective_until) {
        throw scheduleInvalid("add_future requires an open-ended final period.");
      }
      const splitAt = businessDateToUtc(operation.effective_date);
      if (splitAt.getTime() <= finalPeriod.effective_from.getTime()) {
        throw scheduleInvalid(
          "add_future must begin after the final period starts.",
        );
      }
      return [
        ...cloneSchedule(current.slice(0, -1)),
        replacementPeriod(finalPeriod, {
          effective_until: splitAt,
          effective_until_date_exclusive: operation.effective_date,
          reason,
        }),
        createCplPeriod(
          sourceGranularityId,
          {
            amount: operation.amount,
            start_date: operation.effective_date,
          },
          { change_reason: reason },
        ),
      ];
    }
    case "split": {
      const target = requiredPeriod(current, operation.period_id);
      const splitAt = businessDateToUtc(operation.effective_date);
      if (
        splitAt.getTime() <= target.effective_from.getTime() ||
        (target.effective_until &&
          splitAt.getTime() >= target.effective_until.getTime())
      ) {
        throw scheduleInvalid("split date must fall inside the selected period.");
      }
      const index = current.indexOf(target);
      const second: CplSchedulePeriod = {
        ...createCplPeriod(
          sourceGranularityId,
          {
            amount: operation.amount,
            start_date: operation.effective_date,
          },
          { supersedes: target.id, change_reason: reason },
        ),
        ...(target.effective_until
          ? {
              effective_until: new Date(target.effective_until),
              effective_until_date_exclusive:
                target.effective_until_date_exclusive,
            }
          : {}),
      };
      return [
        ...cloneSchedule(current.slice(0, index)),
        replacementPeriod(target, {
          effective_until: splitAt,
          effective_until_date_exclusive: operation.effective_date,
          reason,
        }),
        second,
        ...cloneSchedule(current.slice(index + 1)),
      ];
    }
  }
}

export function resolveCplFromPeriods(
  periods: readonly CplSchedulePeriod[],
  input: ResolveCplInput,
): CplResolution {
  if (
    input.applicable === false ||
    !input.source_granularity_id
  ) {
    return { status: "not_applicable", amount: 0 };
  }
  assertValidTimestamp(input.business_timestamp);
  const matches = coveringPeriods(periods, input.business_timestamp);
  if (input.duplicate) {
    return {
      status: "duplicate_zero",
      amount: 0,
      ...(matches.length === 1 && matches[0]!.id
        ? { base_period_id: matches[0]!.id }
        : {}),
    };
  }
  if (matches.length !== 1 || !matches[0]!.id) {
    return { status: "missing_rate", fallback_amount: 0 };
  }
  const match = matches[0]!;
  return {
    status: "resolved",
    amount: match.amount_cents / 100,
    amount_cents: match.amount_cents,
    period_id: match.id!,
  };
}

export async function resolveCpl(
  input: ResolveCplInput,
  deps: Pick<CplScheduleDependencies, "store"> = {},
): Promise<CplResolution> {
  if (input.applicable === false || !input.source_granularity_id) {
    return { status: "not_applicable", amount: 0 };
  }
  assertValidTimestamp(input.business_timestamp);
  const store = deps.store ?? mongoCplScheduleStore;
  recordRegistryResolverAttempt("cpl");
  try {
    const periods = await store.findCoveringPeriods(
      input.source_granularity_id,
      input.business_timestamp,
    );
    recordRegistryResolverSuccess("cpl");
    return resolveCplFromPeriods(periods, input);
  } catch (error) {
    recordRegistryResolverFailure("cpl", "resolution_query_failed");
    throw error;
  }
}

export async function mutateAdvancedCplSchedule(
  command: AdvancedCplScheduleCommand,
  actor: RegistryActorContext,
  deps: CplScheduleDependencies = {},
): Promise<CplScheduleCommandResult> {
  assertOwner(actor);
  assertRevision(command.expected_revision);
  const store = deps.store ?? mongoCplScheduleStore;
  const runMutation = deps.runMutation ?? defaultRunMutation;
  const now = deps.now ?? (() => new Date());
  const audit: RegistryAuditInput = {
    entityType: "cpl_schedule",
    entityId: command.source_granularity_id,
    action: "schedule_apply",
    reason: command.reason,
    metadata: {
      operation: command.operation.type,
      expected_revision: command.expected_revision,
    },
  };

  return runMutation({
    actor,
    audit,
    invalidateKeys: ["cpl", "source_granularities", "registry_health"],
    mutate: async (session) => {
      const granularity = await requiredGranularity(
        store,
        command.source_granularity_id,
        session,
      );
      const current = await store.loadSchedule(granularity.id, session);
      assertExpectedRevision(granularity, command.expected_revision, current);
      audit.before = scheduleAuditSnapshot(granularity, current);
      const constructed = constructAdvancedCplSchedule(
        current,
        granularity.id,
        command.operation,
        command.reason,
      );
      validateCplSchedule(constructed, {
        active: granularity.active,
        coverage_start_date: current[0]?.effective_from_date,
      });
      if (schedulesEqual(current, constructed)) {
        audit.after = audit.before;
        return {
          changed: false,
          schedules: [toScheduleState(granularity, current)],
        };
      }

      const nextRevision = granularity.schedule_revision + 1;
      const incremented = await store.compareAndIncrementRevision(
        granularity.id,
        command.expected_revision,
        session,
      );
      if (!incremented) {
        throw staleRevision(granularity, current);
      }
      const persisted = await persistConstructedSchedule(
        store,
        current,
        constructed,
        nextRevision,
        actor,
        now(),
        session,
      );
      audit.after = scheduleAuditSnapshot(
        { ...granularity, schedule_revision: nextRevision },
        persisted,
      );
      return {
        changed: true,
        schedules: [
          toScheduleState(
            { ...granularity, schedule_revision: nextRevision },
            persisted,
          ),
        ],
      };
    },
  });
}

export async function applySimpleCplSchedule(
  command: SimpleCplScheduleCommand,
  actor: RegistryActorContext,
  deps: CplScheduleDependencies = {},
): Promise<CplScheduleCommandResult> {
  assertOwner(actor);
  businessDateToUtc(command.effective_date);
  const store = deps.store ?? mongoCplScheduleStore;
  const runMutation = deps.runMutation ?? defaultRunMutation;
  const now = deps.now ?? (() => new Date());
  const ids = command.changes.map((change) => change.source_granularity_id);
  if (new Set(ids).size !== ids.length) {
    throw scheduleInvalid("Simple CPL changes must contain unique granularities.");
  }
  const audit: RegistryAuditInput = {
    entityType: "cpl_schedule",
    entityId: ids.length === 1 ? ids[0]! : "multiple",
    action: "schedule_apply",
    reason: command.reason,
    metadata: {
      mode: "simple",
      effective_date: command.effective_date,
      source_granularity_ids: ids,
    },
  };

  return runMutation({
    actor,
    audit,
    invalidateKeys: ["cpl", "source_granularities", "registry_health"],
    mutate: async (session) => {
      const prepared: Array<{
        granularity: CplGranularityState;
        current: CplSchedulePeriod[];
        constructed: CplSchedulePeriod[];
        expectedRevision: number;
      }> = [];

      for (const change of command.changes) {
        const granularity = await requiredGranularity(
          store,
          change.source_granularity_id,
          session,
        );
        const expectedRevision =
          command.expected_revisions[change.source_granularity_id];
        const current = await store.loadSchedule(granularity.id, session);
        const construction = constructSimpleCplSchedule(
          current,
          granularity.id,
          command.effective_date,
          change.amount,
          command.reason,
        );
        if (!construction.changed) continue;
        assertRevision(expectedRevision);
        assertExpectedRevision(granularity, expectedRevision, current);
        validateCplSchedule(construction.periods, {
          active: granularity.active,
          coverage_start_date: current[0]?.effective_from_date,
        });
        prepared.push({
          granularity,
          current,
          constructed: construction.periods,
          expectedRevision,
        });
      }

      audit.before = {
        schedules: prepared.map((item) =>
          scheduleAuditSnapshot(item.granularity, item.current),
        ),
      };
      const schedules: CplScheduleState[] = [];
      for (const item of prepared) {
        const nextRevision = item.granularity.schedule_revision + 1;
        const incremented = await store.compareAndIncrementRevision(
          item.granularity.id,
          item.expectedRevision,
          session,
        );
        if (!incremented) {
          throw staleRevision(item.granularity, item.current);
        }
        const persisted = await persistConstructedSchedule(
          store,
          item.current,
          item.constructed,
          nextRevision,
          actor,
          now(),
          session,
        );
        schedules.push(
          toScheduleState(
            { ...item.granularity, schedule_revision: nextRevision },
            persisted,
          ),
        );
      }
      audit.after = {
        schedules: schedules.map((state) => ({
          source_granularity_id: state.source_granularity_id,
          revision: state.revision,
          active: state.active,
          periods: state.periods.map(safePeriod),
        })),
      };
      return { changed: prepared.length > 0, schedules };
    },
  });
}

export async function listCplSchedule(
  sourceGranularityId: string,
  deps: Pick<CplScheduleDependencies, "store"> = {},
): Promise<CplScheduleState> {
  const store = deps.store ?? mongoCplScheduleStore;
  const granularity = await requiredGranularity(
    store,
    sourceGranularityId,
    undefined,
  );
  const periods = await store.loadSchedule(sourceGranularityId);
  return toScheduleState(granularity, periods);
}

const mongoCplScheduleStore: CplScheduleStore = {
  async loadGranularity(id, session) {
    const query = getLeadSourceGranularityModel().findById(id).lean();
    if (session) query.session(session);
    const row = await query.exec();
    return row
      ? {
          id: String(row._id),
          active: row.active === true,
          schedule_revision: row.schedule_revision,
        }
      : null;
  },

  async loadSchedule(sourceGranularityId, session) {
    const query = getCplRatePeriodModel()
      .find({
        source_granularity: sourceGranularityId,
        archived_at: null,
      })
      .sort({ effective_from: 1 })
      .lean();
    if (session) query.session(session);
    const rows = await query.exec();
    return rows.map(toCplPeriod);
  },

  async compareAndIncrementRevision(id, expectedRevision, session) {
    const result = await getLeadSourceGranularityModel()
      .updateOne(
        { _id: id, schedule_revision: expectedRevision },
        { $inc: { schedule_revision: 1 } },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  },

  async archivePeriods(ids, at, session) {
    if (!ids.length) return;
    await getCplRatePeriodModel()
      .updateMany(
        { _id: { $in: ids }, archived_at: null },
        { $set: { archived_at: at } },
        { session },
      )
      .exec();
  },

  async insertPeriods(periods, actor, session) {
    if (!periods.length) return [];
    const docs = await getCplRatePeriodModel().create(
      periods.map((period) => ({
        source_granularity: period.source_granularity_id,
        amount_cents: period.amount_cents,
        effective_from: period.effective_from,
        effective_until: period.effective_until,
        effective_from_date: period.effective_from_date,
        effective_until_date_exclusive:
          period.effective_until_date_exclusive,
        business_timezone: CPL_BUSINESS_TIME_ZONE,
        schedule_revision: period.schedule_revision,
        supersedes: period.supersedes,
        change_reason: period.change_reason,
        created_by: {
          actor_type: actor.actorType,
          actor_id: actor.actorId,
          actor_label: actor.actorLabel,
          actor_role: actor.actorRole,
        },
      })),
      { session },
    );
    return docs.map((doc) =>
      toCplPeriod(
        doc.toObject({ virtuals: true }) as unknown as Record<string, unknown>,
      ),
    );
  },

  async findCoveringPeriods(sourceGranularityId, at) {
    const rows = await getCplRatePeriodModel()
      .find({
        source_granularity: sourceGranularityId,
        archived_at: null,
        effective_from: { $lte: at },
        $or: [
          { effective_until: { $gt: at } },
          { effective_until: { $exists: false } },
          { effective_until: null },
        ],
      })
      .sort({ effective_from: 1 })
      .limit(2)
      .lean()
      .exec();
    return rows.map(toCplPeriod);
  },
};

async function defaultRunMutation<T>(
  input: RegistryMutationInput<T>,
): Promise<T> {
  return withRegistryMutation(input);
}

async function requiredGranularity(
  store: CplScheduleStore,
  id: string,
  session?: ClientSession,
): Promise<CplGranularityState> {
  const granularity = await store.loadGranularity(id, session);
  if (!granularity) {
    throw new RegistryError("Source Granularity not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  return granularity;
}

async function persistConstructedSchedule(
  store: CplScheduleStore,
  current: readonly CplSchedulePeriod[],
  constructed: readonly CplSchedulePeriod[],
  revision: number,
  actor: RegistryActorContext,
  archivedAt: Date,
  session: ClientSession,
): Promise<CplSchedulePeriod[]> {
  const retainedIds = new Set(
    constructed.map((period) => period.id).filter(isString),
  );
  const archiveIds = current
    .map((period) => period.id)
    .filter((id): id is string => Boolean(id && !retainedIds.has(id)));
  await store.archivePeriods(archiveIds, archivedAt, session);
  const inserted = await store.insertPeriods(
    constructed
      .filter((period) => !period.id)
      .map((period) => ({ ...clonePeriod(period), schedule_revision: revision })),
    actor,
    session,
  );
  const insertedQueue = [...inserted];
  return constructed.map((period) =>
    period.id ? clonePeriod(period) : insertedQueue.shift()!,
  );
}

function replacementPeriod(
  period: CplSchedulePeriod,
  changes: {
    amount_cents?: number;
    effective_until?: Date;
    effective_until_date_exclusive?: string;
    reason?: string;
  },
): CplSchedulePeriod {
  const effectiveUntil = changes.effective_until ?? period.effective_until;
  const effectiveUntilDateExclusive =
    changes.effective_until_date_exclusive ??
    period.effective_until_date_exclusive;
  return {
    source_granularity_id: period.source_granularity_id,
    amount_cents: changes.amount_cents ?? period.amount_cents,
    effective_from: new Date(period.effective_from),
    ...(effectiveUntil
      ? { effective_until: new Date(effectiveUntil) }
      : {}),
    effective_from_date: period.effective_from_date,
    ...(effectiveUntilDateExclusive
      ? {
          effective_until_date_exclusive:
            effectiveUntilDateExclusive,
        }
      : {}),
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    ...(period.id ? { supersedes: period.id } : {}),
    ...(changes.reason?.trim()
      ? { change_reason: changes.reason.trim() }
      : {}),
  };
}

function requiredPeriod(
  periods: readonly CplSchedulePeriod[],
  id: string,
): CplSchedulePeriod {
  const period = periods.find((candidate) => candidate.id === id);
  if (!period) {
    throw new RegistryError("CPL rate period not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  return period;
}

function assertPeriodShape(period: CplSchedulePeriod): void {
  if (!Number.isSafeInteger(period.amount_cents) || period.amount_cents < 0) {
    throw invalidMoney();
  }
  const expectedFrom = businessDateToUtc(period.effective_from_date);
  if (expectedFrom.getTime() !== period.effective_from.getTime()) {
    throw scheduleInvalid(
      "effective_from does not match its New York business date.",
    );
  }
  if (period.effective_until) {
    if (!period.effective_until_date_exclusive) {
      throw scheduleInvalid(
        "Closed periods require an exclusive business end date.",
      );
    }
    const expectedUntil = businessDateToUtc(
      period.effective_until_date_exclusive,
    );
    if (expectedUntil.getTime() !== period.effective_until.getTime()) {
      throw scheduleInvalid(
        "effective_until does not match its New York business date.",
      );
    }
    if (period.effective_until.getTime() <= period.effective_from.getTime()) {
      throw scheduleInvalid("CPL periods must have positive duration.");
    }
  } else if (period.effective_until_date_exclusive) {
    throw scheduleInvalid("Open periods cannot have an exclusive end date.");
  }
}

function staleRevision(
  granularity: CplGranularityState,
  periods: readonly CplSchedulePeriod[],
): RegistryError {
  return new RegistryError("The CPL schedule revision is stale.", {
    registryCode: REGISTRY_ERROR_CODES.STALE_REVISION,
    remediation: {
      summary: "Refresh the current schedule and retry the edit.",
      action: "refresh_cpl_schedule",
      entity_type: "source_granularity",
      entity_id: granularity.id,
      current_revision: granularity.schedule_revision,
      current_schedule: periods.map(safePeriod),
    },
  });
}

function assertExpectedRevision(
  granularity: CplGranularityState,
  expectedRevision: number,
  periods: readonly CplSchedulePeriod[],
): void {
  if (granularity.schedule_revision !== expectedRevision) {
    throw staleRevision(granularity, periods);
  }
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw scheduleInvalid("expected revision must be a non-negative integer.");
  }
}

function assertOwner(actor: RegistryActorContext): void {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("CPL schedule mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
}

function assertValidTimestamp(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("business_timestamp must be a valid Date");
  }
}

function coveringPeriods(
  periods: readonly CplSchedulePeriod[],
  at: Date,
): CplSchedulePeriod[] {
  return periods.filter(
    (period) =>
      period.effective_from.getTime() <= at.getTime() &&
      (!period.effective_until ||
        at.getTime() < period.effective_until.getTime()),
  );
}

function schedulesEqual(
  left: readonly CplSchedulePeriod[],
  right: readonly CplSchedulePeriod[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((period, index) => {
    const other = right[index]!;
    return (
      period.amount_cents === other.amount_cents &&
      period.effective_from.getTime() === other.effective_from.getTime() &&
      period.effective_until?.getTime() === other.effective_until?.getTime()
    );
  });
}

function toScheduleState(
  granularity: CplGranularityState,
  periods: readonly CplSchedulePeriod[],
): CplScheduleState {
  return {
    source_granularity_id: granularity.id,
    revision: granularity.schedule_revision,
    active: granularity.active,
    periods: cloneSchedule(periods),
  };
}

function safePeriod(period: CplSchedulePeriod): Record<string, unknown> {
  return {
    id: period.id,
    amount_cents: period.amount_cents,
    effective_from_date: period.effective_from_date,
    effective_until_date_exclusive:
      period.effective_until_date_exclusive ?? null,
    business_timezone: CPL_BUSINESS_TIME_ZONE,
  };
}

function scheduleAuditSnapshot(
  granularity: CplGranularityState,
  periods: readonly CplSchedulePeriod[],
): Record<string, unknown> {
  return {
    source_granularity_id: granularity.id,
    revision: granularity.schedule_revision,
    active: granularity.active,
    periods: periods.map(safePeriod),
  };
}

function cloneSchedule(
  periods: readonly CplSchedulePeriod[],
): CplSchedulePeriod[] {
  return periods.map(clonePeriod);
}

function clonePeriod(period: CplSchedulePeriod): CplSchedulePeriod {
  return {
    ...period,
    effective_from: new Date(period.effective_from),
    ...(period.effective_until
      ? { effective_until: new Date(period.effective_until) }
      : {}),
  };
}

function toCplPeriod(row: Record<string, unknown>): CplSchedulePeriod {
  return {
    id: String(row._id ?? row.id ?? ""),
    source_granularity_id: String(row.source_granularity ?? ""),
    amount_cents: Number(row.amount_cents),
    effective_from: new Date(row.effective_from as Date),
    ...(row.effective_until
      ? { effective_until: new Date(row.effective_until as Date) }
      : {}),
    effective_from_date: String(row.effective_from_date ?? ""),
    ...(typeof row.effective_until_date_exclusive === "string"
      ? {
          effective_until_date_exclusive:
            row.effective_until_date_exclusive,
        }
      : {}),
    business_timezone: CPL_BUSINESS_TIME_ZONE,
    ...(typeof row.schedule_revision === "number"
      ? { schedule_revision: row.schedule_revision }
      : {}),
    ...(row.supersedes ? { supersedes: String(row.supersedes) } : {}),
    ...(typeof row.change_reason === "string"
      ? { change_reason: row.change_reason }
      : {}),
  };
}

function parseBusinessDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Business date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new TypeError("Business date is not a valid calendar date");
  }
  return { year, month, day };
}

function addBusinessDays(value: string, days: number): string {
  const { year, month, day } = parseBusinessDate(value);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateTimeParts(value: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const entries = Object.fromEntries(
    businessDateTimeFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(entries.year),
    month: Number(entries.month),
    day: Number(entries.day),
    hour: Number(entries.hour),
    minute: Number(entries.minute),
    second: Number(entries.second),
  };
}

function invalidMoney(): RegistryError {
  return scheduleInvalid(
    "CPL amount must be non-negative and have at most two decimal places.",
  );
}

function scheduleInvalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}

function scheduleGap(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.CPL_SCHEDULE_GAP,
  });
}

function scheduleOverlap(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.CPL_SCHEDULE_OVERLAP,
  });
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

export { mongoCplScheduleStore };
