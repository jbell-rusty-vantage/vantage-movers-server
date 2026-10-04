import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Server-admin slimming SPECIFICATION §7.1/§7.2: no runnable server code calls an AI vendor, stores
 * call media or reads the dropped AI collections. This checks the deployed source tree (`src`, `api`)
 * without tests; the purge tooling under `ops/slimming` names the dropped collections on purpose.
 */
const root = process.cwd();
function sources(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(relative);
    return /\.(ts|mts)$/.test(entry.name) && !/\.test\.ts$|\.fixtures\.ts$/.test(entry.name) ? [relative] : [];
  });
}
const files = [...sources("src"), ...sources("api")].map((file) => ({ file: file.split(path.sep).join("/"), text: readFileSync(path.join(root, file), "utf8") }));

const VENDOR_IMPORT = /(?:from|import\()\s*["'](ai|openai|@ai-sdk\/[^"']+|@vercel\/blob)["']/;
const RETIRED_COLLECTIONS = [
  "lead_conversations",
  "intelligence_runs",
  "intelligence_evidence_snapshots",
  "intelligence_submissions",
  "intelligence_findings",
  "intelligence_effects",
  "intelligence_owner_assessments",
  "move_assessment_artifacts",
  "sales_intelligence_ai_budget",
  "sales_intelligence_ai_reservations",
];

test("no deployed server module imports an AI SDK, an AI vendor client or the Blob media store", () => {
  assert.ok(files.length > 100, "the scan found the source tree");
  assert.deepEqual(files.filter(({ text }) => VENDOR_IMPORT.test(text)).map(({ file }) => file), []);
});

test("no deployed server module names a dropped AI/media collection", () => {
  const hits = files.flatMap(({ file, text }) =>
    RETIRED_COLLECTIONS.filter((name) => text.includes(`"${name}"`) || text.includes(`'${name}'`) || text.includes(`\`${name}\``)).map((name) => `${file}: ${name}`));
  assert.deepEqual(hits, []);
});

test("no deployed server module imports a retired AI/media module", () => {
  const retired = /from\s*["'][^"']*(?:services\/conversations\/|salesIntelligence\/(?:analysis|assessment|conversations|story)\/|models\/(?:LeadConversation|Intelligence[A-Za-z]+|MoveAssessmentArtifact|SalesIntelligenceAi[A-Za-z]+)["']|models\/salesIntelligence\/(?:intelligence|assessment)["']|validation\/intelligence\/|config\/domain\/conversations["']|salesIntelligence\/(?:aiBudget|budgetPeriod|evidence|companyContext)["'])/;
  assert.deepEqual(files.filter(({ text }) => retired.test(text)).map(({ file }) => file), []);
});
