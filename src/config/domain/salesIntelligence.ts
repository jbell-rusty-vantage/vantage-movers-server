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
export const CSI_TOOLS = [
  "get_intelligence_context",
  "get_call_transcript",
  "list_number_activity",
  "search_leads",
  "get_lead",
  "search_bookings",
  "get_booking",
  "get_rep_identity",
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
  "RATE_LIMITED",
  "BACKFILL_ACTIVE",
  "UNSUPPORTED_SCOPE",
  "ATTENTION_SNAPSHOT_EXPIRED",
  "LEASE_LOST",
  "INDEX_REQUIRED",
  "BUDGET_EXHAUSTED",
] as const;
export type CsiErrorCode = (typeof CSI_ERROR_CODES)[number];
export const CSI_FLAGS = [
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
  "NUDGE_ENABLED",
  "LIVE_SSE",
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
