import assert from "node:assert/strict";
import test from "node:test";
import { buildUnit31Certification, certificationMarkdown, scanUnit31Artifact } from "./granot-lifecycle-certification.lib.js";

test("[AC-35] certification scanner reports only bounded artifact/code findings", () => {
  const findings = scanUnit31Artifact({ artifact: "synthetic.json", text: '{"value":"unit31-private-canary@example.invalid","uri":"mongodb+srv://private"}' });
  assert.deepEqual(findings, [
    { artifact: "synthetic.json", code: "canary_present" },
    { artifact: "synthetic.json", code: "mongodb_uri_present" },
  ]);
  assert.equal(JSON.stringify(findings).includes("private"), false);
});

test("[AC-31][AC-35][AC-37][AC-38] certification fails closed until every package assertion is green", () => {
  const modes = ["report", "apply", "verify"];
  const commands = ["receipts", "sources", "leads", "revisions", "indexes"];
  const input: Parameters<typeof buildUnit31Certification>[0] = {
    repositories: [{ name: "server", branch: "granot-lead-lifecycle", commit: "abc", dirty: true }],
    environment: { database_mode: "test", database_name: "testvantagemovers", replica_set: true, sheet_sync_mode: "disabled", external_delivery: "disabled" },
    flags: { GRANOT_LIFECYCLE_PROCESSING_ENABLED: true, GRANOT_LIFECYCLE_SHADOW_MODE: true, GRANOT_LIFECYCLE_EMAIL_ENABLED: false },
    activation: { present: false },
    migration_manifests: commands.flatMap((command) => modes.map((mode) => ({ command, mode, file_hash: `${command}-${mode}`, verify_ok: true }))),
    shadow: { report_hash: "shadow", passed: true, selected_count: 2, zero_forbidden_effects: true, activation_unchanged: true },
    health: { dead_letter_count: 0, open_case_count: 0, open_discrepancy_count: 0, decision_mode_counts: { historical_shadow: 2 } },
    privacy_findings: [],
  };
  const report = buildUnit31Certification(input);
  assert.equal(report.passed, true);
  assert.match(certificationMarkdown(report), /Status: \*\*PASS\*\*/);
  const failed = buildUnit31Certification({ ...input, privacy_findings: [{ artifact: "x", code: "canary_present" }] });
  assert.equal(failed.passed, false);
});
