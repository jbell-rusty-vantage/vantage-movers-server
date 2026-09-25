import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { formLeadBackfillProductionRefusal } from "./form-lead-numbers-backfill";

/**
 * V-T3 M6: `backfill-form-lead-contact-numbers.ts` refuses the production database unless BOTH `--apply` and
 * `--allow-production` are given (its dry run executes and aborts real transactions, so it must never run there).
 */
test("M6: production needs both --apply and --allow-production; every other database is unaffected", () => {
  const argv = (...flags: string[]) => ["node", "scripts/dev_ops/backfill-form-lead-contact-numbers.ts", ...flags];
  assert.match(formLeadBackfillProductionRefusal("vantagemovers", argv())!, /Refusing vantagemovers.*got neither/);
  assert.match(formLeadBackfillProductionRefusal("vantagemovers", argv("--allow-production"))!, /got --allow-production\)$/);
  assert.match(formLeadBackfillProductionRefusal("vantagemovers", argv("--apply"))!, /got --apply\)$/);
  assert.match(formLeadBackfillProductionRefusal("vantagemovers", argv("--apply", "--resume"))!, /Refusing/);
  assert.equal(formLeadBackfillProductionRefusal("vantagemovers", argv("--apply", "--allow-production")), null);
  assert.equal(formLeadBackfillProductionRefusal("vantagemovers", argv("--allow-production", "--apply", "--resume")), null);
  assert.equal(formLeadBackfillProductionRefusal("testvantagemovers_t3bform", argv()), null, "a replica dry run stays allowed");
  assert.equal(formLeadBackfillProductionRefusal("testvantagemovers", argv("--apply")), null);
});

test("M6: the CLI refuses a production dry run before it connects (no Mongo reachable, exits at once)", () => {
  // Not test mode, so the database resolves to `vantagemovers`; the URI points nowhere, so any connection attempt would hang
  // for the server-selection timeout instead of exiting with the refusal.
  const env: NodeJS.ProcessEnv = { ...process.env, MONGO_URI: "mongodb://127.0.0.1:9/?serverSelectionTimeoutMS=60000", SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-refusal-proof" };
  delete env.TEST_MODE; delete env.TEST_MONGO_DATABASE_NAME; delete env.CSI_REPLICA_TEST;
  for (const flags of [[], ["--allow-production"], ["--apply"], ["--limit=1"]]) {
    const started = Date.now();
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev_ops/backfill-form-lead-contact-numbers.ts", ...flags], { env, encoding: "utf8", timeout: 45_000 });
    assert.equal(run.status, 1, `${flags.join(" ") || "(dry run)"}: ${run.stderr}`);
    assert.match(run.stderr, /Refusing vantagemovers: this script's dry run executes and aborts real transactions/, flags.join(" "));
    assert.doesNotMatch(run.stdout, /"phase":"started"/, "never reached the run");
    assert.ok(Date.now() - started < 40_000, "refused before any connection attempt");
  }
});
