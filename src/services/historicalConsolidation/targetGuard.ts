import type { HistoricalManifest } from "./types";

export type ApplyAuthorization = {
  apply: boolean;
  production_apply: boolean;
  target: "testvantagemovers" | "vantagemovers";
  database_confirmation?: string;
  manifest_hash_confirmation?: string;
  git_sha?: string;
  backup_id?: string;
  restore_test_evidence?: string;
  rehearsal_evidence?: { manifest_hash: string; first_apply_verified: boolean; second_apply_noop: boolean; rollback_verified: boolean };
  human_confirmation?: string;
};

export function assertApplyAuthorized(
  manifest: HistoricalManifest,
  connectedDatabase: string,
  authorization: ApplyAuthorization,
): void {
  if (connectedDatabase !== authorization.target) {
    throw new Error(`Connected database ${connectedDatabase} does not match selected target ${authorization.target}`);
  }
  if (!authorization.apply) throw new Error("Apply is dry-run by default; pass --apply to authorize mutation");
  if (authorization.target === "testvantagemovers") {
    if (authorization.production_apply) throw new Error("Production authorization cannot be used for a rehearsal target");
    return;
  }
  const failures: string[] = [];
  if (!authorization.production_apply) failures.push("--production-apply");
  if (authorization.database_confirmation !== "vantagemovers") failures.push("--confirm-database=vantagemovers");
  if (authorization.manifest_hash_confirmation !== manifest.manifest_hash) failures.push("exact --confirm-manifest-hash");
  if (!authorization.git_sha || authorization.git_sha !== manifest.git_sha) failures.push("reviewed Git SHA");
  if (!authorization.backup_id) failures.push("--backup-id");
  if (!authorization.restore_test_evidence) failures.push("--restore-test-evidence");
  const rehearsal = authorization.rehearsal_evidence;
  if (!rehearsal || rehearsal.manifest_hash !== manifest.manifest_hash || !rehearsal.first_apply_verified || !rehearsal.second_apply_noop || !rehearsal.rollback_verified) failures.push("successful rehearsal evidence");
  if (authorization.human_confirmation !== `APPLY ${manifest.manifest_hash} TO vantagemovers`) failures.push("exact immediate human confirmation");
  if (manifest.conflicts.some((entry) => entry.blocking && entry.status !== "decision_supplied")) failures.push("zero unresolved blocking conflicts");
  if (failures.length) throw new Error(`Production apply authorization failed: ${failures.join(", ")}`);
}

export function assertRollbackAuthorized(target: string, manifestHash: string, apply: boolean, databaseConfirmation?: string, manifestHashConfirmation?: string, humanConfirmation?: string): void {
  if (!apply) throw new Error("Rollback is dry-run by default; pass --apply to authorize mutation");
  if (target === "vantagemovers" && (databaseConfirmation !== "vantagemovers" || manifestHashConfirmation !== manifestHash || humanConfirmation !== `ROLLBACK ${manifestHash} FROM vantagemovers`)) {
    throw new Error("Production rollback requires exact database, manifest hash, and immediate human confirmation");
  }
}
