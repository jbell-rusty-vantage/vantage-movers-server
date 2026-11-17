/** No application imports: callers establish this boundary before loading server code. */
export type LocalIdentity = { uri: string; database: string; replicaSet: string; address: string };
export const AGENT_LOCAL: LocalIdentity = {
  uri: "mongodb://127.0.0.1:27017/?directConnection=true", database: "testvantagemovers_agent",
  replicaSet: "rs0", address: "127.0.0.1:27017",
};
export const GRANOT_REHEARSAL: LocalIdentity = {
  ...AGENT_LOCAL, database: "testvantagemovers_granot_trace",
};
export class OperatorError extends Error {
  constructor(public readonly code: string, public readonly exitCode = 3, public readonly evidenceFile?: string) { super(code); }
}
export function assertLocalIdentity(identity: LocalIdentity): void {
  const expected = identity.database === GRANOT_REHEARSAL.database ? GRANOT_REHEARSAL : AGENT_LOCAL;
  if (identity.database !== expected.database || identity.uri !== expected.uri ||
      identity.address !== expected.address || identity.replicaSet !== expected.replicaSet) {
    throw new OperatorError("unsafe_local_identity");
  }
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
/** Error messages from drivers can contain URIs, customer payloads and credentials. */
export function publicFailure(error: unknown): { status: string; code: string; exitCode: number; evidenceFile?: string } {
  if (error instanceof OperatorError) return { status: error.exitCode === 4 ? "unsupported" : error.exitCode === 5 ? "failed" : error.exitCode === 2 ? "usage" : "refused", code: error.code, exitCode: error.exitCode,
    ...(error.evidenceFile ? { evidenceFile: error.evidenceFile } : {}) };
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === 13 || code === 18) return { status: "permission_denied", code: "mongo_permission_denied", exitCode: 3 };
  return { status: "unknown", code: "operation_failed_details_redacted", exitCode: 3 };
}
