import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration, ConfigurationLoader } from "../config/load";
import { deskTimingOf } from "../config/timing";
import { OutreachError } from "../errors";
import { cadenceCallCoverage, smsCoverage, type CallWatermarks, type ChannelCoverage } from "../evidence/coverage";
import { newYorkBusinessDay } from "./businessDay";
import { composeFreshness, type CaptureSyncRow, type SalesOutreachFreshness } from "./freshness";
import type { DeskQueueStore } from "./deskStore";
import type { ContactDerivationMark, SalesOutreachReadStore } from "./store";

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

/**
 * The call watermarks a read needs, from the two rows it loads: the Call Log capture row
 * (`readCallsCapture`: capped `known`, uncapped `observed`) and the contact-event derivation row
 * (`readContactDerivation`, null before S3's first sweep).
 */
export function readCallWatermarks(calls: CaptureSyncRow | null, derivation: ContactDerivationMark | null): CallWatermarks {
  return {
    capture_known: calls?.known_complete_through ?? null,
    capture_observed: calls?.observed_complete_through ?? null,
    derived_known: derivation?.known_complete_through ?? null,
    derived_observed: derivation?.observed_complete_through ?? null,
    coverage_from: derivation?.coverage_from ?? null,
  };
}

/**
 * The coverage every desk read labels channels with (olr A2):
 * - `cadence`: what the engine judges deadlines against (`cadenceCallCoverage`; SMS = worst current reviewed
 *   mailbox, null while SMS capture is off) — a passed deadline reads overdue only when this proves it;
 * - `capture`: the raw watermark the channel's `coverage` block shows (Call Log `known_complete_through`;
 *   SMS the same worst mailbox), `complete` while it trails `as_of` by at most `today_tolerance_ms`.
 */
export type DeskReadCoverage = Readonly<{ cadence: ChannelCoverage; capture: ChannelCoverage; today_tolerance_ms: number }>;

export async function readFreshness(store: SalesOutreachReadStore, configuration: ActiveConfiguration, now: Date) {
  const smsEnabled = configuration.value.controls.rep_sms_capture_enabled;
  const timing = deskTimingOf(configuration.value);
  const [calls, lastCallWebhookAt, mailboxes, granot, derivation] = await Promise.all([
    store.readCallsCapture(),
    store.readLastCallWebhookAt(),
    smsEnabled ? store.readSmsMailboxes(now) : Promise.resolve([]),
    store.readLatestGranotObservationAt(),
    store.readContactDerivation(),
  ]);
  const watermarks = readCallWatermarks(calls, derivation);
  const sms = smsEnabled ? smsCoverage(mailboxes) : null;
  const coverage: DeskReadCoverage = {
    cadence: { call: cadenceCallCoverage(watermarks, timing), sms },
    capture: { call: calls?.known_complete_through ?? null, sms },
    today_tolerance_ms: timing.today_coverage_tolerance_ms,
  };
  return {
    calls,
    watermarks,
    coverage,
    freshness: composeFreshness({
      now,
      timing,
      calls,
      last_call_webhook_at: lastCallWebhookAt,
      sms_capture_enabled: smsEnabled,
      sms_mailboxes: mailboxes,
      granot_last_observed_at: granot,
    }),
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
