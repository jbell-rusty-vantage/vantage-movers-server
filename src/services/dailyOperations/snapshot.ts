import { shouldPublishDailyOperationsRedis } from "../../config/domain/dailyOperations";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import { getDailyOperationsDayModel } from "../../models/DailyOperationsDay";
import type {
  DailyOperationsDayDocument,
  DailyOperationsHourlyBucket,
} from "../../models/DailyOperationsDay";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { FLORIDA_TIME_ZONE } from "../../utils/easternTime";
import {
  buildDaySeed,
  DAILY_OPERATIONS_ORIGIN_KEYS,
  easternDayKey,
  easternHour,
  previousEasternDayKey,
  seedHourlyBuckets,
  sumHourlyThrough,
  type DailyOperationsOriginKey,
} from "./dayDocument";

/**
 * `yesterday*` and `day_before*` are `null` when that NY day document is
 * missing (UI shows a dash). `*_by_now` sums hourly buckets `0..currentNyHour`
 * so pace compares like hours, not a closed day against a half day.
 * DOP-10 added the day-before fields; every earlier field is unchanged.
 */
export type DailyOperationsHeadlinePace = {
  today: number;
  yesterday: number | null;
  yesterday_by_now: number | null;
  day_before: number | null;
  day_before_by_now: number | null;
};

export type DailyOperationsWebhookClassCount = {
  today: number;
  yesterday: number | null;
  day_before: number | null;
};

export type DailyOperationsSnapshotCompany = {
  source_company: string;
  form: number;
  call: number;
  total: number;
  yesterday_total: number | null;
  day_before_total: number | null;
};

export type DailyOperationsSnapshot = {
  timezone: typeof FLORIDA_TIME_ZONE;
  today: string;
  yesterday: string;
  day_before: string;
  generated_at: string;
  redis: { configured: boolean; mode: "stream" };
  metrics: {
    leads: DailyOperationsHeadlinePace & {
      form: number;
      call: number;
      duplicate_form: number;
      duplicate_call: number;
    };
    bookings: DailyOperationsHeadlinePace;
    cancellations: DailyOperationsHeadlinePace;
    texts: DailyOperationsHeadlinePace & {
      deferred: number;
      held_now: number;
      skipped: number;
      failed: number;
    };
    webhooks: {
      lead_created: DailyOperationsWebhookClassCount;
      priority_updated: DailyOperationsWebhookClassCount;
      booking_status_changed: DailyOperationsWebhookClassCount;
      booked: DailyOperationsWebhookClassCount;
      release: DailyOperationsWebhookClassCount;
    };
    intakes: { opened_today: number; still_open: number };
    exceptions: {
      zip_missing: number;
      crm_failed: number;
      dead_letter: number;
      adoption_conflict: number;
    };
  };
  origins: Record<DailyOperationsOriginKey, number>;
  companies: DailyOperationsSnapshotCompany[];
  hourly: {
    today: DailyOperationsHourlyBucket[];
    yesterday: DailyOperationsHourlyBucket[];
    day_before: DailyOperationsHourlyBucket[];
  };
};

export type DailyOperationsDayLoader = (
  day: string,
) => Promise<DailyOperationsDayDocument | null>;

export type DailyOperationsSnapshotDeps = {
  now?: () => Date;
  loadDay?: DailyOperationsDayLoader;
  countOpenIntakes?: () => Promise<number>;
  countHeldMessages?: () => Promise<number>;
  redisConfigured?: () => boolean;
};

export async function getDailyOperationsSnapshot(
  deps: DailyOperationsSnapshotDeps = {},
): Promise<DailyOperationsSnapshot> {
  const now = deps.now?.() ?? new Date();
  const todayKey = easternDayKey(now);
  const yesterdayKey = previousEasternDayKey(todayKey);
  const dayBeforeKey = previousEasternDayKey(yesterdayKey);
  const currentNyHour = easternHour(now);
  const loadDay = deps.loadDay ?? defaultLoadDay;
  const countOpenIntakes = deps.countOpenIntakes ?? defaultCountOpenIntakes;
  const countHeldMessages = deps.countHeldMessages ?? defaultCountHeldMessages;
  const redisConfigured =
    deps.redisConfigured ?? shouldPublishDailyOperationsRedis;

  const [todayDoc, yesterdayDoc, dayBeforeDoc, stillOpen, heldNow] =
    await Promise.all([
      loadDay(todayKey),
      loadDay(yesterdayKey),
      loadDay(dayBeforeKey),
      countOpenIntakes(),
      countHeldMessages(),
    ]);

  const today = todayDoc ?? (buildDaySeed(todayKey) as DailyOperationsDayDocument);
  const yesterdayPresent = Boolean(yesterdayDoc);
  const dayBeforePresent = Boolean(dayBeforeDoc);
  const todayHourly = normalizeHourly(today.hourly);
  const yesterdayHourly = yesterdayPresent
    ? normalizeHourly(yesterdayDoc!.hourly)
    : seedHourlyBuckets();
  const dayBeforeHourly = dayBeforePresent
    ? normalizeHourly(dayBeforeDoc!.hourly)
    : seedHourlyBuckets();

  const priorTotal = (
    present: boolean,
    value: number | undefined,
  ): number | null => (present ? (value ?? 0) : null);

  const pace = (
    todayValue: number,
    yesterdayValue: number | undefined,
    dayBeforeValue: number | undefined,
    hourlyField: Exclude<keyof DailyOperationsHourlyBucket, "hour">,
  ): DailyOperationsHeadlinePace => ({
    today: todayValue,
    yesterday: priorTotal(yesterdayPresent, yesterdayValue),
    yesterday_by_now: yesterdayPresent
      ? sumHourlyThrough(yesterdayHourly, currentNyHour, hourlyField)
      : null,
    day_before: priorTotal(dayBeforePresent, dayBeforeValue),
    day_before_by_now: dayBeforePresent
      ? sumHourlyThrough(dayBeforeHourly, currentNyHour, hourlyField)
      : null,
  });

  const webhookClass = (
    field: keyof DailyOperationsDayDocument["webhooks"],
  ): DailyOperationsWebhookClassCount => ({
    today: today.webhooks[field],
    yesterday: priorTotal(yesterdayPresent, yesterdayDoc?.webhooks[field]),
    day_before: priorTotal(dayBeforePresent, dayBeforeDoc?.webhooks[field]),
  });

  const origins = { ...buildDaySeed(todayKey).origins };
  for (const key of DAILY_OPERATIONS_ORIGIN_KEYS) {
    origins[key] = Number(today.origins?.[key] ?? 0);
  }

  return {
    timezone: FLORIDA_TIME_ZONE,
    today: todayKey,
    yesterday: yesterdayKey,
    day_before: dayBeforeKey,
    generated_at: now.toISOString(),
    redis: { configured: redisConfigured(), mode: "stream" },
    metrics: {
      leads: {
        ...pace(
          today.leads.total,
          yesterdayDoc?.leads.total,
          dayBeforeDoc?.leads.total,
          "leads",
        ),
        form: today.leads.form,
        call: today.leads.call,
        duplicate_form: today.leads.duplicate_form,
        duplicate_call: today.leads.duplicate_call,
      },
      bookings: pace(
        today.bookings.total,
        yesterdayDoc?.bookings.total,
        dayBeforeDoc?.bookings.total,
        "bookings",
      ),
      cancellations: pace(
        today.cancellations.total,
        yesterdayDoc?.cancellations.total,
        dayBeforeDoc?.cancellations.total,
        "cancellations",
      ),
      texts: {
        ...pace(
          today.messages.successful,
          yesterdayDoc?.messages.successful,
          dayBeforeDoc?.messages.successful,
          "messages",
        ),
        deferred: today.messages.deferred,
        held_now: heldNow,
        skipped: today.messages.skipped,
        failed: today.messages.failed,
      },
      webhooks: {
        lead_created: webhookClass("lead_created"),
        priority_updated: webhookClass("priority_updated"),
        booking_status_changed: webhookClass("booking_status_changed"),
        booked: webhookClass("booked"),
        release: webhookClass("release"),
      },
      intakes: {
        opened_today: today.intakes.opened,
        still_open: stillOpen,
      },
      exceptions: {
        zip_missing: today.exceptions.zip_missing,
        crm_failed: today.exceptions.crm_failed,
        dead_letter: today.exceptions.dead_letter,
        adoption_conflict: today.exceptions.adoption_conflict,
      },
    },
    origins,
    companies: SOURCE_COMPANIES.map((slug) => {
      const todayCompany = today.companies?.[slug] ?? { form: 0, call: 0, total: 0 };
      const yesterdayCompany = yesterdayDoc?.companies?.[slug];
      const dayBeforeCompany = dayBeforeDoc?.companies?.[slug];
      return {
        source_company: slug,
        form: todayCompany.form ?? 0,
        call: todayCompany.call ?? 0,
        total: todayCompany.total ?? 0,
        yesterday_total: priorTotal(yesterdayPresent, yesterdayCompany?.total),
        day_before_total: priorTotal(dayBeforePresent, dayBeforeCompany?.total),
      };
    }),
    hourly: {
      today: todayHourly,
      yesterday: yesterdayHourly,
      day_before: dayBeforeHourly,
    },
  };
}

function normalizeHourly(
  hourly: DailyOperationsHourlyBucket[] | undefined,
): DailyOperationsHourlyBucket[] {
  const seeded = seedHourlyBuckets();
  if (!hourly?.length) return seeded;
  return seeded.map((bucket) => {
    const found = hourly.find((entry) => entry.hour === bucket.hour) ?? hourly[bucket.hour];
    return {
      hour: bucket.hour,
      leads: Number(found?.leads ?? 0),
      bookings: Number(found?.bookings ?? 0),
      cancellations: Number(found?.cancellations ?? 0),
      webhooks: Number(found?.webhooks ?? 0),
      messages: Number(found?.messages ?? 0),
    };
  });
}

async function defaultLoadDay(
  day: string,
): Promise<DailyOperationsDayDocument | null> {
  return getDailyOperationsDayModel().findOne({ day }).lean().exec();
}

async function defaultCountOpenIntakes(): Promise<number> {
  return getGranotBookingReconciliationCaseModel().countDocuments({
    state: "open",
  });
}

async function defaultCountHeldMessages(): Promise<number> {
  return getLeadMessageModel().countDocuments({
    provider_status: "scheduled",
    status: "accepted",
  });
}
