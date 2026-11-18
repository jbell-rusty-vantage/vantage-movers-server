/** No application imports: callers establish this boundary before loading server code. */
export type LocalIdentity = { uri: string; database: string; replicaSet: string; address: string };
export const AGENT_LOCAL: LocalIdentity = {
  uri: "mongodb://127.0.0.1:27017/?directConnection=true", database: "testvantagemovers_agent",
  replicaSet: "rs0", address: "127.0.0.1:27017",
};
export const GRANOT_REHEARSAL: LocalIdentity = {
  ...AGENT_LOCAL, database: "testvantagemovers_granot_trace",
};
export const SHEET_REPLICA: LocalIdentity = {
  uri: "mongodb://127.0.0.1:27129/?directConnection=true", database: "testvantagemovers_sheetrecovery",
  replicaSet: "sheetRecoveryProof", address: "127.0.0.1:27129",
};
export class OperatorError extends Error {
  constructor(public readonly code: string, public readonly exitCode = 3, public readonly evidenceFile?: string) { super(code); }
}
export function assertLocalIdentity(identity: LocalIdentity): void {
  if (identity.database === GRANOT_REHEARSAL.database) {
    if (identity.uri !== GRANOT_REHEARSAL.uri || identity.address !== GRANOT_REHEARSAL.address ||
        identity.replicaSet !== GRANOT_REHEARSAL.replicaSet) throw new OperatorError("unsafe_local_identity");
    return;
  }
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(identity.address)
    || identity.uri !== `mongodb://${identity.address}/?directConnection=true`
    || !/^testvantagemovers_(agent|sheetrecovery\d*)$/.test(identity.database)
    || !/^(rs0|sheetRecoveryProof)$/.test(identity.replicaSet)) throw new OperatorError("unsafe_local_identity");
}
export function assertLocalHello(hello: Record<string, unknown>, identity: LocalIdentity): void {
  assertLocalIdentity(identity);
  if (["hosts", "passives", "arbiters"].some((field) => hello[field] !== undefined && !Array.isArray(hello[field]))) {
    throw new OperatorError("local_primary_replica_identity_mismatch");
  }
  const members = [...(Array.isArray(hello.hosts) ? hello.hosts : []),
    ...(Array.isArray(hello.passives) ? hello.passives : []), ...(Array.isArray(hello.arbiters) ? hello.arbiters : [])];
  if (hello.isWritablePrimary !== true || hello.setName !== identity.replicaSet
    || hello.me !== identity.address || hello.primary !== identity.address
    || !members.length || members.some((host) => host !== identity.address)) {
    throw new OperatorError("local_primary_replica_identity_mismatch");
  }
}
/** Allowlisting prevents future provider credentials and NODE_OPTIONS from leaking to children. */
export function localChildEnvironment(parent: NodeJS.ProcessEnv, identity: LocalIdentity): NodeJS.ProcessEnv {
  assertLocalIdentity(identity);
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]);
  for (const [key, value] of Object.entries(parent)) if (allowed.has(key.toUpperCase())) env[key] = value;
  return Object.assign(env, {
    // Windows restores USERPROFILE when omitted. Force an unreadable credential-home location.
    HOME: process.platform === "win32" ? "NUL" : "/dev/null",
    USERPROFILE: process.platform === "win32" ? "NUL" : "/dev/null",
    MONGO_URI: identity.uri, TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: identity.database,
    NODE_ENV: "test", VANTAGE_TEST_RUNNER: "true", SHEET_SYNC_MODE: "disabled",
    WRITE_SOURCE_LEAD_SHEETS: "false", LEAD_MESSAGING_MODE: "disabled",
    RINGCENTRAL_WEBHOOK_ENABLED: "false", RINGCENTRAL_CALL_LOG_SYNC_ENABLED: "false",
    RINGCENTRAL_CREATE_CALL_LEADS: "false", RINGCENTRAL_SHADOW_CALL_LEADS: "false",
    SALES_INTELLIGENCE_ENABLED: "false", REPORTING_GOOGLE_DELIVERY_ENABLED: "false",
    GRANOT_LIFECYCLE_PROCESSING_ENABLED: "false", GRANOT_AUTOMATION_APPLY_ENABLED: "false",
    DOTENV_CONFIG_PATH: process.platform === "win32" ? "NUL" : "/dev/null",
  });
}
/** Error messages from drivers can contain URIs, customer payloads and credentials. */
export function publicFailure(error: unknown): { status: string; code: string; exitCode: number; evidenceFile?: string } {
  if (error instanceof OperatorError) return { status: error.exitCode === 4 ? "unsupported" : error.exitCode === 5 ? "failed" : error.exitCode === 2 ? "usage" : "refused", code: error.code, exitCode: error.exitCode,
    ...(error.evidenceFile ? { evidenceFile: error.evidenceFile } : {}) };
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === 13 || code === 18) return { status: "permission_denied", code: "mongo_permission_denied", exitCode: 3 };
  return { status: "unknown", code: "operation_failed_details_redacted", exitCode: 3 };
}
