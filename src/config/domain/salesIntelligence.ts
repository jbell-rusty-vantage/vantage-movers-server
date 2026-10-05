import { getMongoDatabaseName } from "./runtime";

export const SALES_INTELLIGENCE_POLICY_VERSION = "csi-policy-v1" as const;
export const CONTACT_NUMBER_CLASSIFICATIONS = [
  "unknown",
  "customer",
  "company",
  "non_customer",
] as const;
export const CONTACT_ELIGIBILITY_STATES = [
  "allowed",
  "temporarily_blocked",
  "suppressed",
  "unknown",
] as const;
export const CONTACT_NUMBER_KINDS = [
  "external",
  "company_did",
  "extension",
  "service_code",
  "withheld",
  "malformed",
] as const;
/**
 * Durable job stages that may be enqueued, claimed and dispatched. Retained capabilities only:
 * provider capture, Call Log reconcile/refresh, directory, Number↔Lead attachment, Number
 * rebuild and the receipt-only repair of RingCentral Accounts messages.
 */
export const CSI_JOB_STAGES = [
  "capture_projection",
  "call_log_reconcile",
  // CC-08: targeted Call Log re-read of one telephony session after webhook hang-up.
  "call_log_refresh",
  "directory",
  "attachment_refresh",
  "rebuild",
  "nudge_repair",
  // Sales Outreach Desk (IMPLEMENTATION-PLAN §6.2). `outreach_lead_change` refreshes one Lead's desk
  // subject (P05d/P05e period transitions, intake admission); `outreach_evaluate` re-runs the cadence
  // engine for one subject revision (its consumer lands with the evaluator wiring).
  "outreach_lead_change",
  "outreach_evaluate",
] as const;
export type CsiJobStage = (typeof CSI_JOB_STAGES)[number];
/**
 * Stages of the retired AI/media/Outreach pipeline (server-admin slimming SPECIFICATION §7.4).
 * Rows written by earlier releases may still carry them. They are never enqueued, claimed or
 * dispatched again: a late queue wake-up or a recovered row is acknowledged and terminalized as
 * `retired`, with no provider call and no effect.
 */
export const CSI_RETIRED_JOB_STAGES = [
  "outreach_ensure",
  "outreach_derive",
  "recording_discovery",
  "media",
  "media_fetch",
  "transcription",
  "analysis",
  "application",
  "number_refresh",
  "backfill",
  "retention",
  "rep_identity_reevaluate",
  "move_assessment",
] as const;
export function isRetainedCsiJobStage(stage: unknown): stage is CsiJobStage {
  return typeof stage === "string" && (CSI_JOB_STAGES as readonly string[]).includes(stage);
}
export const CSI_ERROR_CODES = [
  "FEATURE_DISABLED",
  "OWNER_REQUIRED",
  "INVALID_INPUT",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ILLEGAL_TRANSITION",
  "IDENTITY_BLOCKED",
  "RUN_SCOPE_DENIED",
  "NUDGE_DESTINATION_IS_CUSTOMER",
  "NUDGE_NOT_ACTIONABLE",
  "NUDGE_CONFIGURATION_UNAVAILABLE",
  "NUDGE_DESTINATION_EVIDENCE_INCOMPLETE",
  "NUDGE_BODY_INVALID",
  "RATE_LIMITED",
  "UNSUPPORTED_SCOPE",
  "LEASE_LOST",
  "INDEX_REQUIRED",
  "FORBIDDEN",
] as const;
export type CsiErrorCode = (typeof CSI_ERROR_CODES)[number];
export const CSI_FLAGS = [
  // Owner reads and commands of the retained Numbers and RingCentral Accounts surface.
  "ENABLED",
  "CAPTURE_WEBHOOK",
  "CAPTURE_CALL_LOG",
  "DIRECTORY_SYNC",
  "ATTACHMENT_REFRESH",
  "AUTO_ATTACH",
  "NUDGE_ENABLED",
  // CC-08: the daily webhook-subscription cron may create the all-direction
  // subscription when none owned exists. Off: it only renews/repairs owned ones.
  "WEBHOOK_AUTO_CREATE",
  // Form Lead Contact Numbers: the `attachment-lead:` job creates the Contact Number for a
  // non-duplicate Form Lead's submitted phone before attachment. Off: only calls create numbers.
  "FORM_LEAD_NUMBERS",
  // S5c-NUMBERS: the Numbers list hides form-only Numbers (`has_calls = false`) unless `include_form_only`.
  "NUMBERS_HAS_CALLS_DEFAULT",
  // S6-AGENT: Granot's latest rep replaces an automatic Lead `receiver_agent` (E3/E6). Read by the
  // Granot lifecycle Lead projection (`granotLifecycle/leadDesiredState.ts`); listed for the settings display.
  "RECEIVER_LATEST_WINS",
  // S8-REP: a signed `rep` passes the CSI boundary; every interim Numbers/Accounts route then refuses it.
  "REP_ACCESS",
] as const;
export function csiFlag(flag: (typeof CSI_FLAGS)[number]): boolean {
  return (
    process.env[`SALES_INTELLIGENCE_${flag}`]?.trim().toLowerCase() === "true"
  );
}
export function csiDataset() {
  const deployment = process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID?.trim();
  if (!deployment)
    throw new Error("SALES_INTELLIGENCE_DEPLOYMENT_ID is required");
  return { deployment, database: getMongoDatabaseName() };
}

/** Owner messaging configuration. Optional transports are off unless explicitly enabled. */
export function csiNudgeConfiguration() {
  const channelNames = ["team_messaging", "sms_to_rep", "pager"] as const;
  const rawChannels = process.env.SALES_INTELLIGENCE_NUDGE_CHANNELS;
  const channels = rawChannels === undefined ? null : rawChannels.split(",").map(value => value.trim()).filter(Boolean);
  if (channels?.some(value => !(channelNames as readonly string[]).includes(value))) throw new Error("invalid_nudge_channels");
  const channelEnabled = (channel: typeof channelNames[number], suffix: string, fallback: boolean) => {
    const override = process.env[`SALES_INTELLIGENCE_NUDGE_${suffix}_ENABLED`]?.trim().toLowerCase();
    // The documented allowlist cannot be widened by an alias. Explicit false can further restrict it.
    return channels ? channels.includes(channel) && override !== "false" : override === undefined ? fallback : override === "true";
  };
  const positive = (raw: string | undefined, fallback: number) => {
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100) throw new Error("invalid_nudge_limit");
    return n;
  };
  return {
    account: process.env.RINGCENTRAL_ACCOUNT_ID?.trim() ?? "",
    senderExtension: process.env.SALES_INTELLIGENCE_NUDGE_SENDER_EXTENSION_ID?.trim() ?? "",
    senderExtensionNumber: process.env.SALES_INTELLIGENCE_NUDGE_SENDER_EXTENSION_NUMBER?.trim() ?? "",
    senderPerson: process.env.SALES_INTELLIGENCE_NUDGE_SENDER_PERSON_ID?.trim() ?? "",
    senderDid: process.env.SALES_INTELLIGENCE_NUDGE_SENDER_DID?.trim() ?? "",
    recordBaseUrl: process.env.SALES_INTELLIGENCE_ADMIN_BASE_URL?.trim() ?? "",
    hourlyLimit: positive(process.env.SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR ?? process.env.SALES_INTELLIGENCE_NUDGE_HOURLY_LIMIT, 6),
    channels: {
      team_messaging: channelEnabled("team_messaging", "TEAM_MESSAGING", true),
      sms_to_rep: channelEnabled("sms_to_rep", "SMS", false),
      pager: channelEnabled("pager", "PAGER", false),
    },
  };
}
/** Days Call activity is kept when no Owner policy is installed. Zero disables the activity purge. */
export function csiRetentionDays() {
  const raw = process.env.SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS;
  if (raw === undefined) return { activity_days: 730 };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 3650)
    throw new Error("Invalid SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS");
  return { activity_days: parsed };
}
