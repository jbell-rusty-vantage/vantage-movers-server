import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  FINDING_TRANSLATION_TABLE,
  TRANSLATED_HEALTH_CODES,
  translateFinding,
} from "./findingTranslation";

const healthSource = readFileSync(
  join(process.cwd(), "src/services/operationsRegistry/queries/health.ts"),
  "utf8",
);

function emittedHealthCodes(): string[] {
  const literal = [
    ...healthSource.matchAll(/code:\s*"registry\.([a-z0-9_]+)"/g),
  ].map((match) => `registry.${match[1]}`);
  const dynamic = healthSource.includes("registry.source_${kind}_ambiguous")
    ? ["registry.source_crm_label_ambiguous", "registry.source_source_site_ambiguous"]
    : [];
  return [...new Set([...literal, ...dynamic])].sort();
}

test("translation table covers every code health.ts can emit", () => {
  const emitted = emittedHealthCodes();
  assert.ok(emitted.length >= 20, "health.ts should emit a known set of codes");
  for (const code of emitted) {
    assert.equal(
      Boolean(FINDING_TRANSLATION_TABLE[code]),
      true,
      `missing translation for ${code}`,
    );
  }
  assert.deepEqual(TRANSLATED_HEALTH_CODES, Object.keys(FINDING_TRANSLATION_TABLE).sort());
});

test("every translation has a non-empty owner action and deep link", () => {
  for (const [code, row] of Object.entries(FINDING_TRANSLATION_TABLE)) {
    assert.ok(row.owner_action.trim(), `${code} missing owner_action`);
    assert.ok(row.deep_link.startsWith("/admin/"), `${code} missing deep_link`);
    assert.ok(row.owner_message.trim(), `${code} missing owner_message`);
    assert.match(row.severity, /^(blocking|reviewable)$/);
  }
});

test("unknown codes surface as themselves and are never dropped", () => {
  const finding = translateFinding(
    { code: "registry.brand_new_untranslated_code", summary: "New inconsistency." },
    { lead_source_id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(finding.code, "registry.brand_new_untranslated_code");
  assert.equal(finding.advanced.raw_code, "registry.brand_new_untranslated_code");
  assert.ok(finding.owner_action.includes("registry.brand_new_untranslated_code"));
  assert.ok(finding.deep_link);
});

test("active RingCentral validation failure uses the stopped-filing sentence", () => {
  const finding = translateFinding(
    { code: "registry.ringcentral_validation_failed" },
    { lead_source_id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(finding.owner_message, "This number has stopped filing calls.");
  assert.equal(finding.severity, "blocking");
});

test("assignment inconsistency states the operational cost with the number", () => {
  const finding = translateFinding(
    {
      code: "registry.ringcentral_assignment_inconsistent",
      evidence: { phone_number: "(954) 555-0142" },
    },
    { lead_source_id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(
    finding.owner_message,
    "Calls to (954) 555-0142 are not being filed anywhere.",
  );
});
