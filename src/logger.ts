import pino, { type LoggerOptions } from "pino";

/**
 * Shared pino logger for the Vantage API runtime.
 *
 * Vercel surfaces stdout JSON in its log viewer, so this logger is
 * configured to emit a stable, search-friendly shape:
 *
 *   - `level` is emitted as the string label (`"info"`, `"warn"`,
 *     `"error"`) instead of pino's default numeric value, so Vercel's
 *     log search picks up plain words.
 *   - `time` is an ISO-8601 timestamp string, which renders correctly
 *     in Vercel logs and any downstream collector.
 *   - `err` is the canonical key for thrown errors (matches the
 *     `{ err: error }` pattern already used across the codebase) and
 *     uses pino's built-in `Error` serializer so stack traces survive.
 *   - `base` adds `service` and `env` (with Vercel's `VERCEL_ENV` and
 *     `VERCEL_REGION` mixed in when present) to every line, so a
 *     single log line is self-identifying without needing extra
 *     context from the Vercel viewer.
 *
 * Safety notes:
 *
 *   - Pino uses `safe-stable-stringify` internally, so passing objects
 *     with circular references or `BigInt` values to `logger.info({...})`
 *     does NOT throw -- the serializer handles them. This is the
 *     primary reason structured logging here is preferred over
 *     `console.log(JSON.stringify(...))`.
 *   - Sensitive request headers (`authorization`, `cookie`,
 *     `x-api-secret`) are stripped via `redact.remove` so they never
 *     reach the log stream, regardless of how they were attached.
 *   - Customer PII (name/email/phone) and the CRM endpoint URL
 *     (which carries `CRM_API_ID`/`CRM_MOVER_REF` query-string secrets)
 *     are sanitized at the call site in `api/services/crm/` using
 *     `summarizeCrmPayloadForLog` and `crmEndpointForLog`. Keeping that
 *     sanitization at the call site means logs stay descriptive
 *     ("phone1: ***2222") instead of just being removed.
 */

const rawLevel = process.env.LOG_LEVEL?.trim();
const isProd = process.env.NODE_ENV === "production";

function resolveEnvLabel(): string {
  // Prefer Vercel's deployment env (`production` / `preview` /
  // `development`) when available; fall back to NODE_ENV; finally
  // default to "development" so the field is never empty.
  return (
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"
  );
}

const baseFields: Record<string, unknown> = {
  service: "vantage-main-server",
  env: resolveEnvLabel(),
};

if (process.env.VERCEL_REGION) {
  baseFields.region = process.env.VERCEL_REGION;
}

const options: LoggerOptions = {
  level: rawLevel && rawLevel.length > 0 ? rawLevel : isProd ? "info" : "debug",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  errorKey: "err",
  base: baseFields,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-secret"]',
      "headers.authorization",
      "headers.cookie",
      'headers["x-api-secret"]',
    ],
    remove: true,
  },
};

export const logger = pino(options);
