import { getMongoDatabaseName, isTestMode } from "./runtime";

export const CSI_CONTRACT_VERSION = "csi-foundation-v1" as const;
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
export const CSI_ACTION_KINDS = [
  "call",
  "text_customer_via_lead_message",
  "send_estimate",
  "check_availability",
  "review",
  "wait",
  "reconcile_identity",
  "other",
] as const;
export const CSI_OUTREACH_STATES = [
  "unworked",
  "open",
  "waiting_on_customer",
  "identity_review",
  "closed",
] as const;
export const CSI_EFFECT_STATUSES = [
  "applied",
  "no_change",
  "blocked_owner",
  "blocked_identity",
  "blocked_closed",
  "blocked_restriction",
  "needs_review",
  "stale",
] as const;
export const CSI_EXTRACTION_MODELS = [
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.6-luna",
] as const;
export const CSI_TOOLS = [
  "get_intelligence_context",
  "get_call_transcript",
  "list_number_activity",
  "search_leads",
  "get_lead",
  "search_bookings",
  "get_booking",
  "get_rep_identity",
  "query_operational_records",
  "search_ringcentral_calls",
  "get_ringcentral_call",
  "submit_intelligence_analysis",
] as const;
export const CSI_JOB_STAGES = [
  "capture_projection",
  "call_log_reconcile",
  "directory",
  "attachment_refresh",
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
  "rebuild",
  "rep_identity_reevaluate",
  "nudge_repair",
  // MA-02: independent Move assessment step (one subject-level model call per input fingerprint).
  "move_assessment",
  // CC-08: targeted Call Log re-read of one telephony session after webhook hang-up.
  "call_log_refresh",
] as const;
export const CSI_ERROR_CODES = [
  "FEATURE_DISABLED",
  "OWNER_REQUIRED",
  "INVALID_INPUT",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ILLEGAL_TRANSITION",
  "IDENTITY_BLOCKED",
  "CONTACT_RESTRICTED",
  "OFFICIAL_STATE_BLOCKS_REOPEN",
  "ORIGINAL_EVIDENCE_UNAVAILABLE",
  "RUN_SCOPE_DENIED",
  "SUBMISSION_CONFLICT",
  "EVIDENCE_SCOPE_INVALID",
  "NUDGE_DESTINATION_IS_CUSTOMER",
  "NUDGE_NOT_ACTIONABLE",
  "NUDGE_CONFIGURATION_UNAVAILABLE",
  "NUDGE_DESTINATION_EVIDENCE_INCOMPLETE",
  "NUDGE_BODY_INVALID",
  "RATE_LIMITED",
  "BACKFILL_ACTIVE",
  "UNSUPPORTED_SCOPE",
  "ATTENTION_SNAPSHOT_EXPIRED",
  "LEASE_LOST",
  "INDEX_REQUIRED",
  "BUDGET_EXHAUSTED",
  "EVIDENCE_LIMIT_REACHED",
  "PROVIDER_READ_UNAVAILABLE",
  // Lead progress (LP-01): work closed by a current CRM disposition, and a
  // terminal disposition whose provenance is unresolved.
  "CRM_DISPOSITION_CLOSED",
  "DISPOSITION_REVIEW",
  // S8-REP (addendum §4.2): a rep command outside the E9 allowlist, or on a follow-up it isn't responsible for.
  "FORBIDDEN",
] as const;
export type CsiErrorCode = (typeof CSI_ERROR_CODES)[number];
export const CSI_FLAGS = [
  "ATTENTION_MANIFEST",
  "ENABLED",
  "CAPTURE_WEBHOOK",
  "CAPTURE_CALL_LOG",
  "DIRECTORY_SYNC",
  "ATTACHMENT_REFRESH",
  "OUTREACH_ENSURE",
  "MEDIA_ENABLED",
  "STT_ENABLED",
  "EXTRACTION_ENABLED",
  "EXACT_EVIDENCE_VERIFICATION",
  "AUTO_ATTACH",
  "NUDGE_ENABLED",
  "LIVE_SSE",
  "PROVIDER_READS",
  // LP-01: Lead progress projection, CRM disposition closure and the
  // Priority/Quoted repair fingerprint. Off keeps `ensureLead` and the repair
  // sweep exactly as before so no mass re-nomination happens before the dry run.
  "LEAD_PROGRESS",
  // MA-02: Move assessment nomination/generation in the normal flow. Off keeps
  // the summary/findings pipeline exactly as before; reads still serve retained
  // artifacts and the assessment-only backfill runner injects its own gate.
  "MOVE_ASSESSMENT",
  // Final data spec §9 S2: the Attention closed partition, header metrics and
  // index array. Off keeps the publish and GET /attention as before for the
  // current Admin; the additive row fields are published either way.
  "ATTENTION_V2",
  // Final data spec §9 S4: the Owner timeline on the story readers (§5).
  // Off keeps GET /numbers/:id/timeline exactly as before.
  "TIMELINE_V2",
  // CC-08: the daily webhook-subscription cron may create the all-direction
  // subscription when none owned exists. Off: it only renews/repairs owned ones.
  "WEBHOOK_AUTO_CREATE",
  // Attention and Case File spec (Team 4): the model reads the Case File (AC2); band semantics,
  // completion quality, progress default, first attempts, last activity (AC3–AC5); the Move
  // assessment re-plan on accepted progress to Quoted (AC6, needs MOVE_ASSESSMENT). All off keeps
  // today's behaviour byte-identical.
  "CASE_FILE",
  "ATTENTION_EVOLUTION",
  "PROGRESS_PLAN",
  // Form Lead Contact Numbers: the `attachment-lead:` job creates the Contact Number for a
  // non-duplicate Form Lead's submitted phone before attachment. Off: only calls create numbers.
  "FORM_LEAD_NUMBERS",
  // Team 3 (reconciliation addendum G7, assignment addendum E1–E28). All off keeps today's behaviour.
  // S5c-NUMBERS: the Numbers list hides form-only Numbers (`has_calls = false`) unless `include_form_only`.
  "NUMBERS_HAS_CALLS_DEFAULT",
  // S6-P5: an accepted Granot Priority 5 closes Outreach as `granot_booked` (E1/E2).
  "PRIORITY5_CLOSURE",
  // S6-AGENT: the Outreach responsible rep follows the Lead's `receiver_agent` (`crm_receiver`, E4/E26).
  "RECEIVER_ASSIGNMENT",
  // S6-AGENT: Granot's latest rep replaces an automatic `receiver_agent` (E3/E6; renamed from
  // GRANOT_RECEIVER_AGENT_LATEST_WINS by G10).
  "RECEIVER_LATEST_WINS",
  // S8-REP: the server accepts the signed `rep` role and enforces its scope on every route (E8–E11).
  "REP_ACCESS",
  // S9: band transitions + baseline, the `overview_now` tally, `outreach_rep_days` cron and the
  // overview route (E15–E23, G8).
  "OVERVIEW",
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
export function csiMediaMaxBytes(): number {
  const value = Number(process.env.SALES_INTELLIGENCE_MEDIA_MAX_BYTES ?? 26214400);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid_media_max_bytes");
  return value;
}
/** Server only. Never serialize this configuration into a DTO or log. */
export function csiProviderConfiguration() {
  return {
    gatewayKey: process.env.AI_GATEWAY_API_KEY,
    blobStoreId: process.env.BLOB_STORE_ID,
    blobStoreName: process.env.BLOB_STORE_NAME,
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    mcpEndpoint: process.env.SALES_INTELLIGENCE_MCP_ENDPOINT,
    extractionModel:
      process.env.SALES_INTELLIGENCE_EXTRACTION_MODEL ?? "openai/gpt-5-mini",
    transcriptionModel:
      process.env.SALES_INTELLIGENCE_STT_MODEL ??
      "openai/gpt-4o-mini-transcribe",
    transcriptionCentsPerSecond: Number(process.env.SALES_INTELLIGENCE_STT_CENTS_PER_SECOND),
    // Socket URLs and read-only tokens are deliberately not REST publisher fallbacks.
    redis:
      !isTestMode() &&
      process.env.KV_REST_API_URL &&
      process.env.KV_REST_API_TOKEN
        ? {
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN,
          }
        : null,
  };
}

/** Day count, not a `csiFlag` boolean. Default 0 plans nothing and skips the backfill cron. */
export function csiBackfillDays(): number {
  const raw = process.env.SALES_INTELLIGENCE_BACKFILL_DAYS;
  if (raw === undefined || raw.trim() === "") return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 366)
    throw new Error("Invalid SALES_INTELLIGENCE_BACKFILL_DAYS");
  return parsed;
}

/** Engineering retention defaults, not legal advice. Zero disables that class for the cron. */
export function csiRetentionDays() {
  const value = (suffix: string, fallback: number) => {
    const raw = process.env[`SALES_INTELLIGENCE_RETENTION_${suffix}`];
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 3650)
      throw new Error(`Invalid SALES_INTELLIGENCE_RETENTION_${suffix}`);
    return parsed;
  };
  return {
    audio_days: value("AUDIO_DAYS", 90),
    redacted_days: value("TRANSCRIPT_DAYS", 365),
    activity_days: value("ACTIVITY_DAYS", 730),
  };
}

export const CSI_LIVE_JOB_PRIORITY = 0;
export const CSI_BACKFILL_JOB_PRIORITY = -100;

/** Bootstrap only; callers persist this once, then resolvePolicy reads the active version. */
export function csiBootstrapNumbers() {
  const value = (suffix: string, fallback: number) => {
    const raw = process.env[`SALES_INTELLIGENCE_${suffix}`];
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new Error(`Invalid SALES_INTELLIGENCE_${suffix}`);
    return parsed;
  };
  return {
    first_action_due_staffed_minutes: value(
      "FIRST_ACTION_DUE_STAFFED_MINUTES",
      30,
    ),
    missed_callback_due_staffed_minutes: value(
      "MISSED_CALLBACK_DUE_STAFFED_MINUTES",
      15,
    ),
    going_cold_staffed_minutes: value("GOING_COLD_STAFFED_MINUTES", 1440),
    monthly_ceiling_cents: value("AI_MONTHLY_CEILING_CENTS", 8000),
    per_recording_ceiling_cents: value("AI_PER_RECORDING_CEILING_CENTS", 25),
  };
}

/** Additional hard fence even if a deployment accidentally grants this key a broad route. */
export function isCsiServiceRoute(method: string, path: string): boolean {
  const match =
    /^\/api\/v1\/internal\/sales-intelligence\/runs\/[a-f\d]{24}\/(context|read|submit|submission)\/?$/i.exec(
      path,
    );
  return Boolean(
    match &&
      method.toUpperCase() ===
        (["read", "submit"].includes(match[1]!) ? "POST" : "GET"),
  );
}

/** Only the four closed CSI templates expand a run id; this is not general wildcard routing. */
export function matchesCsiServiceRouteTemplate(
  method: string,
  configuredPath: string,
  path: string,
): boolean {
  if (!isCsiServiceRoute(method, path)) return false;
  return (
    configuredPath === path.replace(/\/runs\/[a-f\d]{24}\//i, "/runs/:id/")
  );
}
