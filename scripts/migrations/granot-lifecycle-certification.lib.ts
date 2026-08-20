import { createHash } from "node:crypto";

export const GRANOT_LIFECYCLE_CERTIFICATION_VERSION = "granot-lifecycle-certification/1";
export const UNIT31_PRIVACY_CANARIES = [
  "unit31-private-canary@example.invalid",
  "unit31-secret-canary",
] as const;

export type PrivacyFindingCode =
  | "canary_present"
  | "mongodb_uri_present"
  | "authorization_value_present"
  | "credential_value_present";

export type PrivacyFinding = { artifact: string; code: PrivacyFindingCode };

export function scanUnit31Artifact(input: {
  artifact: string;
  text: string;
}): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  if (UNIT31_PRIVACY_CANARIES.some((canary) => input.text.includes(canary))) {
    findings.push({ artifact: input.artifact, code: "canary_present" });
  }
  if (/mongodb(?:\+srv)?:\/\/[^\s"']+/i.test(input.text)) {
    findings.push({ artifact: input.artifact, code: "mongodb_uri_present" });
  }
  if (/authorization["']?\s*[:=]\s*["'](?:bearer\s+)?[^"']{4,}/i.test(input.text)) {
    findings.push({ artifact: input.artifact, code: "authorization_value_present" });
  }
  if (/(?:x-api-secret|granot[_-]?webhook[_-]?secret)["']?\s*[:=]\s*["'][^"']{4,}/i.test(input.text)) {
    findings.push({ artifact: input.artifact, code: "credential_value_present" });
  }
  return findings;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildUnit31Certification(input: {
  repositories: Array<{ name: string; branch: string; commit: string; dirty: boolean }>;
  environment: { database_mode: "test" | "production"; database_name: string; replica_set: boolean; sheet_sync_mode: string; external_delivery: "disabled" };
  flags: Record<string, boolean>;
  activation: { present: boolean; masked_id?: string; processor_version?: string };
  migration_manifests: Array<{ command: string; mode: string; file_hash: string; verify_ok?: boolean }>;
  shadow?: { report_hash: string; passed: boolean; selected_count: number; zero_forbidden_effects: boolean; activation_unchanged: boolean };
  health: { dead_letter_count: number; open_case_count: number; open_discrepancy_count: number; decision_mode_counts: Record<string, number> };
  privacy_findings: PrivacyFinding[];
}) {
  const effectFlags = Object.entries(input.flags).filter(([name, enabled]) => enabled && !["GRANOT_LIFECYCLE_PROCESSING_ENABLED", "GRANOT_LIFECYCLE_SHADOW_MODE"].includes(name));
  const migrationsGreen = input.migration_manifests.length >= 15 && input.migration_manifests.filter((item) => item.mode === "verify").every((item) => item.verify_ok !== false);
  const passed =
    input.environment.database_mode === "test" &&
    input.environment.replica_set &&
    input.environment.sheet_sync_mode === "disabled" &&
    effectFlags.length === 0 &&
    input.privacy_findings.length === 0 &&
    migrationsGreen &&
    input.shadow?.passed === true &&
    input.shadow.zero_forbidden_effects &&
    input.shadow.activation_unchanged;
  return {
    certification_version: GRANOT_LIFECYCLE_CERTIFICATION_VERSION,
    scope: "unit_31_disposable_certification",
    repositories: [...input.repositories].sort((a, b) => a.name.localeCompare(b.name)),
    environment: input.environment,
    flags: Object.fromEntries(Object.entries(input.flags).sort(([a], [b]) => a.localeCompare(b))),
    activation: input.activation,
    migration_manifests: [...input.migration_manifests].sort((a, b) => `${a.command}:${a.mode}:${a.file_hash}`.localeCompare(`${b.command}:${b.mode}:${b.file_hash}`)),
    shadow: input.shadow ?? null,
    health: input.health,
    privacy: { finding_count: input.privacy_findings.length, findings: input.privacy_findings },
    assertions: {
      disposable_test_database: input.environment.database_mode === "test",
      replica_set: input.environment.replica_set,
      external_delivery_disabled: input.environment.external_delivery === "disabled" && input.environment.sheet_sync_mode === "disabled",
      all_effect_flags_false: effectFlags.length === 0,
      migration_package_complete: migrationsGreen,
      privacy_scan_green: input.privacy_findings.length === 0,
      historical_shadow_green: input.shadow?.passed === true,
      zero_forbidden_effects: input.shadow?.zero_forbidden_effects === true,
      activation_unchanged: input.shadow?.activation_unchanged === true,
    },
    passed,
  };
}

export function certificationMarkdown(report: ReturnType<typeof buildUnit31Certification>): string {
  const status = report.passed ? "PASS" : "FAIL";
  return [
    "# Unit 31 disposable certification",
    "",
    `Status: **${status}**`,
    "",
    `Certification version: \`${report.certification_version}\``,
    `Database mode: \`${report.environment.database_mode}\``,
    `Replica set verified: \`${report.environment.replica_set}\``,
    `Sheet/external delivery disabled: \`${report.assertions.external_delivery_disabled}\``,
    `Migration package complete: \`${report.assertions.migration_package_complete}\``,
    `Historical shadow green: \`${report.assertions.historical_shadow_green}\``,
    `Zero forbidden effects: \`${report.assertions.zero_forbidden_effects}\``,
    `Privacy findings: \`${report.privacy.finding_count}\``,
    "",
    "This artifact contains counts, modes, hashes, and masked identifiers only. It is not production authorization.",
    "",
  ].join("\n");
}
