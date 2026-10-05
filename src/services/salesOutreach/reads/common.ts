import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration, ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import { newYorkBusinessDay } from "./businessDay";
import { composeFreshness, type SalesOutreachFreshness } from "./freshness";
import type { DeskQueueStore } from "./deskStore";
import type { SalesOutreachReadStore } from "./store";

/**
 * Shared pieces of every desk read (CONTRACTS "Common read data"): the deps, the base/common read
 * fields, the fail-closed configuration gate and the freshness read. Each read takes one server
 * reference instant (`now`), reads the configuration pointer once and never writes, initializes
 * configuration or calls a provider.
 */
export type DeskReadDeps = Readonly<{
  loader: ConfigurationLoader;
  store?: SalesOutreachReadStore;
  /** Projection/subject reads of the queue, the outreach view and the team cadence cards. */
  queueStore?: DeskQueueStore;
  now: Date;
}>;

export function baseRead(actor: OutreachActor, now: Date, scopedAgent: string | null) {
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    as_of: now.toISOString(),
    timezone: SALES_OUTREACH_TIMEZONE,
    scope: { role: actor.role, agent_id: scopedAgent },
  };
}

/**
 * The active configuration for a desk read, or a fail-closed refusal: uninitialized or broken
 * configuration and `controls.desk_enabled = false` all answer 503 `CONFIGURATION_UNAVAILABLE`
 * (with an issue naming why). The Owner's configuration and capabilities routes stay open.
 */
export async function requireDeskConfiguration(loader: ConfigurationLoader): Promise<ActiveConfiguration> {
  const loaded = await loader.load();
  if (loaded.state !== "active")
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "configuration_uninitialized" }]);
  if (!loaded.value.controls.desk_enabled)
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls.desk_enabled", code: "desk_disabled" }]);
  return loaded;
}

/** The requested business day (default: today in New York at `now`); future days are refused. */
export function resolveBusinessDay(requested: string | undefined, now: Date): { business_day: string; today: string } {
  const today = newYorkBusinessDay(now);
  const business_day = requested ?? today;
  if (business_day > today) throw new OutreachError("INVALID_INPUT", [{ path: "business_day", code: "future_business_day" }]);
  return { business_day, today };
}

export async function readFreshness(store: SalesOutreachReadStore, configuration: ActiveConfiguration, now: Date) {
  const smsEnabled = configuration.value.controls.rep_sms_capture_enabled;
  const [calls, mailboxes, granot] = await Promise.all([
    store.readCallsCapture(),
    smsEnabled ? store.readSmsMailboxes() : Promise.resolve([]),
    store.readLatestGranotObservationAt(),
  ]);
  return {
    calls,
    freshness: composeFreshness({ now, calls, sms_capture_enabled: smsEnabled, sms_mailboxes: mailboxes, granot_last_observed_at: granot }),
  };
}

export function commonRead(
  actor: OutreachActor,
  now: Date,
  scopedAgent: string | null,
  configuration: ActiveConfiguration,
  projection_revision: number | null,
  freshness: SalesOutreachFreshness,
) {
  return {
    ...baseRead(actor, now, scopedAgent),
    configuration_state: "active" as const,
    configuration_version: configuration.version,
    configuration_revision: configuration.revision,
    projection_revision,
    freshness,
  };
}
