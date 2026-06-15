import { AsyncLocalStorage } from "node:async_hooks";
import type { SheetSyncMode } from "./sheetSync";
import {
  SHEET_CONTAINER_ENV_VARS,
  type RuntimeSheetContainerEnvVar,
  type SheetContainerEnvVar,
} from "./sheets";
import { SOURCE_COMPANY_CONFIGS, type SourceCompany } from "./sources";

/**
 * Runtime configuration helpers backed by `process.env`.
 *
 * This module is the single place where `TEST_MODE` is interpreted for
 * Mongo, Google Sheets containers, and required-env access. Other modules
 * (e.g. `./googleAuth.ts`) defer their TEST_MODE branching to `isTestMode`
 * here so that mode handling stays consistent.
 *
 * Behavior preserved from the original `api/config/domain.ts`:
 *   - `isTestMode` re-reads `process.env.TEST_MODE` on every call.
 *   - `MONGO_DATABASE_NAME` is captured at module load. Callers that need
 *     a live value can call `getMongoDatabaseName()` directly.
 *   - `getRuntimeSheetContainerEnvVar` prefixes the requested env var name
 *     with `TEST_` when running in test mode, so sheet container IDs come
 *     from `TEST_*` env vars and never collide with production sheets.
 *   - `getRequiredEnv` throws with the env-var name in the message when
 *     the value is unset or blank after trim.
 */

export type RuntimeDomainOverrides = {
  testMode?: boolean;
  sheetSyncMode?: SheetSyncMode;
};

const runtimeDomainOverrides =
  new AsyncLocalStorage<RuntimeDomainOverrides>();

declare global {
  var __vantageTestRunner: boolean | undefined;
}

export function getRuntimeDomainOverrides(): RuntimeDomainOverrides {
  return runtimeDomainOverrides.getStore() ?? {};
}

export function withRuntimeDomainOverrides<T>(
  overrides: RuntimeDomainOverrides,
  fn: () => T,
): T {
  return runtimeDomainOverrides.run(
    { ...getRuntimeDomainOverrides(), ...overrides },
    fn,
  );
}

export function isTestMode(): boolean {
  const override = getRuntimeDomainOverrides().testMode;
  if (override !== undefined) {
    return override;
  }

  return process.env.TEST_MODE?.trim().toLowerCase() === "true";
}

export function markVantageTestRunner(): void {
  globalThis.__vantageTestRunner = true;
}

export function isVantageTestRunner(): boolean {
  return (
    globalThis.__vantageTestRunner === true ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.VANTAGE_TEST_RUNNER === "true"
  );
}

/**
 * Whether lead syncs should also write to the source-company-specific lead
 * sheets in addition to the Master Leads sheet.
 *
 * Defaults to `false` (master-only) so the source sheets can become formula
 * derivatives of the master. Set `WRITE_SOURCE_LEAD_SHEETS=true` to restore
 * dual writes. The source-target plumbing is retained either way; this flag
 * only controls whether those targets are selected for writes.
 */
export function shouldWriteSourceLeadSheets(): boolean {
  return (
    process.env.WRITE_SOURCE_LEAD_SHEETS?.trim().toLowerCase() === "true"
  );
}

export function getMongoDatabaseName(): "vantagemovers" | "testvantagemovers" {
  return isTestMode() ? "testvantagemovers" : "vantagemovers";
}

export const MONGO_DATABASE_NAME = getMongoDatabaseName();

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

export function getRuntimeSheetContainerEnvVar(
  envVar: SheetContainerEnvVar,
): RuntimeSheetContainerEnvVar {
  return isTestMode() ? (`TEST_${envVar}` as const) : envVar;
}

export function getMasterLeadsSheetContainerId(): string {
  return getRequiredEnv(
    getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterLeads),
  );
}

export function getMasterBookedSheetContainerId(): string {
  return getRequiredEnv(
    getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterBooked),
  );
}

export function getSourceLeadSheetContainerId(
  sourceCompany: SourceCompany,
): string | undefined {
  const envVar = SOURCE_COMPANY_CONFIGS[sourceCompany].leadSheetEnvVar;
  return envVar
    ? getRequiredEnv(getRuntimeSheetContainerEnvVar(envVar))
    : undefined;
}
