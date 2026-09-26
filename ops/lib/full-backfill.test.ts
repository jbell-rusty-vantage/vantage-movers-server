import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireRepairLock, releaseRepairLock, repairLockPath, numberVerdict, bucketize, budgetHeadroom, configurePaidProcess, isOwnDedupe, numberExclusion, p95, parseCliOptions, pickCost, resumeDecision,
  summarize, targetContractsDigest, targetVersions, type FullBackfillManifest,
} from "./full-backfill";
import {
  CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION, FINDINGS_PROMPT_VERSION, STRUCTURED_PIPELINE, SUMMARY_PROMPT_VERSION, structuredStepContracts,
} from "../../src/services/salesIntelligence/analysis/structuredPrompt";

test("CLI: estimate by default, Case File by default, bounded concurrency, no --release-holds", () => {
  const base = parseCliOptions(["node", "script"]);
  assert.equal(base.mode, "estimate");
  assert.equal(base.layout, "case_file");
  assert.equal(base.s10Holds, "drive", "an S10-held scheduled synthesis IS the Number's one synthesis: drive by default");
  assert.equal(base.repairIdleMinutes, 60, "the repair child is stopped after 60 minutes without output");
  assert.equal(parseCliOptions(["n", "s", "--repair-idle-minutes", "15"]).repairIdleMinutes, 15);
  assert.throws(() => parseCliOptions(["n", "s", "--repair-timeout-minutes", "720"]), /repair-idle-minutes/);
  assert.equal(base.concurrency, 2);
  const apply = parseCliOptions(["node", "s", "--confirm-write", "--allow-production", "--concurrency", "3", "--numbers", "aaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbb",
    "--max-numbers", "5", "--since", "2026-09-01T00:00:00Z", "--layout", "default", "--s10-holds", "leave", "--resume"]);
  assert.deepEqual([apply.mode, apply.allowProduction, apply.concurrency, apply.numbers?.length, apply.maxNumbers, apply.layout, apply.s10Holds, apply.resume],
    ["apply", true, 3, 2, 5, "default", "leave", true]);
  assert.equal(apply.since?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.throws(() => parseCliOptions(["n", "s", "--release-holds"]), /release-holds/);
  assert.throws(() => parseCliOptions(["n", "s", "--confirm-write", "--allow-schema-drift"]), /allow-schema-drift/);
  assert.throws(() => parseCliOptions(["n", "s", "--estimate", "--confirm-write"]), /read-only/);
  assert.throws(() => parseCliOptions(["n", "s", "--concurrency", "4"]), /1\.\.3/);
  assert.throws(() => parseCliOptions(["n", "s", "--numbers", "not-an-id"]), /Contact Number ids/);
  assert.throws(() => parseCliOptions(["n", "s", "--layout", "story"]), /layout/);
  assert.throws(() => parseCliOptions(["n", "s", "--s10-holds", "release"]), /s10-holds/);
});

test("target versions come from structuredPrompt.ts for each layout", () => {
  assert.deepEqual([targetVersions("case_file").summary, targetVersions("case_file").findings], [CASE_FILE_SUMMARY_PROMPT_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION]);
  assert.deepEqual([targetVersions("default").summary, targetVersions("default").findings], [SUMMARY_PROMPT_VERSION, FINDINGS_PROMPT_VERSION]);
  assert.notEqual(targetContractsDigest("case_file"), targetContractsDigest("default"));
});

test("paid process: personal key only, queue identity removed, Move assessment and re-plan off, refuses without pricing", () => {
  const env: NodeJS.ProcessEnv = { PERSONAL_AI_GATEWAY_API_KEY: "personal", AI_GATEWAY_API_KEY: "company", VERCEL_OIDC_TOKEN: "oidc", VERCEL: "1", VERCEL_REGION: "iad1",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "d", SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: "p1", SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION: "10",
    SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION: "40", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true", SALES_INTELLIGENCE_PROGRESS_PLAN: "true",
    SALES_INTELLIGENCE_STT_CENTS_PER_SECOND: "0.005", RC_TOKEN_STORE: "mongo" };
  const out = configurePaidProcess(env, "case_file");
  assert.equal(env.AI_GATEWAY_API_KEY, "personal");
  for (const name of ["VERCEL_OIDC_TOKEN", "VERCEL", "VERCEL_REGION"]) assert.equal(env[name], undefined, name);
  assert.equal(env.SALES_INTELLIGENCE_PERSONAL_LEDGER, "true");
  assert.equal(env.SALES_INTELLIGENCE_MOVE_ASSESSMENT, "false");
  assert.equal(env.SALES_INTELLIGENCE_PROGRESS_PLAN, "false");
  assert.equal(env.SALES_INTELLIGENCE_CASE_FILE, "true");
  assert.equal(env.SALES_INTELLIGENCE_STT_CENTS_PER_SECOND, "0.003");
  assert.equal(env.RC_TOKEN_STORE, "file");
  assert.equal(out.rcTokenStore, "mongo");
  const layoutDefault: NodeJS.ProcessEnv = { ...env, PERSONAL_AI_GATEWAY_API_KEY: "personal" };
  configurePaidProcess(layoutDefault, "default");
  assert.equal(layoutDefault.SALES_INTELLIGENCE_CASE_FILE, "false");
  assert.throws(() => configurePaidProcess({ SALES_INTELLIGENCE_DEPLOYMENT_ID: "d" }, "case_file"), /PERSONAL_AI_GATEWAY_API_KEY.*PRICING_VERSION/);
  assert.throws(() => configurePaidProcess({ ...env, PERSONAL_AI_GATEWAY_API_KEY: "k", SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/other" }, "case_file"), /CSI_EXTRACTION_MODELS/);
});

test("budget preflight refuses without an active period or with less than 12 h left", () => {
  const now = new Date("2026-09-30T20:00:00Z");
  const period = { month: "2026-09", period_start: new Date("2026-09-01T04:00:00Z"), period_end: new Date("2026-10-01T04:00:00Z"), activated_at: new Date("2026-09-01T04:00:00Z") };
  assert.equal(budgetHeadroom(null, now).ok, false);
  assert.match(String(budgetHeadroom(period, now).reason), /ends_in_8\.0h/);
  assert.equal(budgetHeadroom(period, new Date("2026-09-30T15:59:00Z")).ok, true);
  assert.equal(budgetHeadroom({ ...period, activated_at: null }, new Date("2026-09-20T00:00:00Z")).ok, false);
});

test("exclusions: purged, internal, suppression, active restriction, --since", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const ok = { kind: "external", classification: "customer", contact_eligibility: { state: "allowed" }, last_activity_at: now };
  assert.equal(numberExclusion(ok, now, null), null);
  assert.equal(numberExclusion(null, now, null), "number_missing");
  assert.equal(numberExclusion({ ...ok, content_purge_pending: true }, now, null), "purged");
  assert.equal(numberExclusion({ ...ok, kind: "company_did" }, now, null), "internal");
  assert.equal(numberExclusion({ ...ok, classification: "non_customer" }, now, null), "internal");
  assert.equal(numberExclusion({ ...ok, contact_eligibility: { state: "suppressed" } }, now, null), "suppressed");
  assert.equal(numberExclusion({ ...ok, contact_eligibility: { state: "temporarily_blocked", until: new Date("2026-10-01") } }, now, null), "restricted");
  assert.equal(numberExclusion({ ...ok, contact_eligibility: { state: "temporarily_blocked", until: new Date("2026-09-01") } }, now, null), null);
  assert.equal(numberExclusion({ ...ok, last_activity_at: new Date("2026-08-01") }, now, new Date("2026-09-01")), "inactive_since");
});

test("cost basis: p95 by ledger × step × subject, personal first, nominal fallback", () => {
  assert.equal(p95([]), null);
  assert.equal(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), 19);
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({ ledger: "personal", kind: "findings" as const, subject: "number" as const, cents: i + 3 })),
    ...Array.from({ length: 5 }, () => ({ ledger: "owner", kind: "summary" as const, subject: "conversation" as const, cents: 1 })),
  ];
  const buckets = bucketize(rows);
  assert.deepEqual(pickCost(buckets, "findings", "number"), { cents: 21, mean: 12.5, basis: "personal_p95_n20" });
  assert.equal(pickCost(buckets, "summary", "conversation").basis, "nominal");
  assert.equal(pickCost(buckets, "summary", "conversation").cents, 2);
  assert.equal(buckets.find(b => b.ledger === "all" && b.kind === "findings")?.n, 20);
});

test("a failed job is re-armed only when its run resumes under the target layout and model", () => {
  const digest = targetContractsDigest("case_file"), model = "openai/gpt-5.6-luna";
  const run = { analysis_pipeline: STRUCTURED_PIPELINE, model_version: model, step_contracts: structuredStepContracts("case_file"), status: "paused" };
  assert.deepEqual(resumeDecision(null, digest, model), { resumable: true, reason: "no_run" });
  assert.equal(resumeDecision(run, digest, model).resumable, true);
  assert.equal(resumeDecision({ ...run, step_contracts: structuredStepContracts("legacy") }, digest, model).reason, "layout_differs");
  assert.equal(resumeDecision({ ...run, model_version: "openai/gpt-5-mini" }, digest, model).reason, "model_differs");
  assert.equal(resumeDecision({ ...run, analysis_pipeline: null }, digest, model).reason, "legacy_pipeline");
  assert.equal(resumeDecision({ ...run, purged_at: new Date() }, digest, model).reason, "run_purged");
  assert.equal(resumeDecision({ ...run, status: "stale" }, digest, model).reason, "run_stale");
});

test("own work is recognizable by its dedupe namespace", () => {
  assert.equal(isOwnDedupe("csi:analysis:conversation:x:v1:full-backfill:sales_intelligence_analyze_v5"), true);
  assert.equal(isOwnDedupe("csi:number-analysis:full-backfill:x:v5:1"), true);
  assert.equal(isOwnDedupe("csi:analysis:conversation:x:v1"), false);
  assert.equal(isOwnDedupe("csi:number-analysis:x:3"), false);
});

test("summary counts peer paid units and prior re-arms", () => {
  const manifest = { numbers: [{ state: "done", conversations: [{ state: "done", units: [
    { stage: "analysis", job_id: "1", outcome: "done", by: "prior", paid: true, prior: { status: "paused", reason: "permission_denied", result_reason: "schema_exhausted", attempts: 1, action: "rearmed" } },
    { stage: "application", job_id: "2", outcome: "done", by: "peer", paid: false }] }],
    synthesis: [{ stage: "number_refresh", job_id: "3", outcome: "done", by: "peer", paid: true }] }], holds: [], foreign_holds: [],
    phases: { verify: { complete: false, leftovers: [{ number_id: "n9" }] } } } as unknown as FullBackfillManifest;
  const summary = summarize(manifest);
  assert.equal(summary.peer_paid_units, 1);
  assert.equal(summary.rearmed, 1);
  assert.deepEqual(summary.numbers, { done: 1 });
  assert.equal(summary.complete, false, "never reads complete while a Number is left over");
  assert.deepEqual(summary.leftovers, ["n9"]);
});

test("verification: a Number passes only with a current summary, a matching (or expected-mismatch) fingerprint and nothing left", () => {
  const base = { number_id: "n", state: "done", reason: null, summary_current: true, fingerprint_match: true as boolean | null, expected_mismatch: null as string | null, conversations_left: 0 };
  assert.equal(numberVerdict(base).pass, true);
  assert.equal(numberVerdict({ ...base, summary_current: false }).pass, false);
  assert.equal(numberVerdict({ ...base, fingerprint_match: false }).pass, false);
  assert.equal(numberVerdict({ ...base, fingerprint_match: null }).pass, false);
  assert.equal(numberVerdict({ ...base, fingerprint_match: false, expected_mismatch: "s10_hold_left" }).pass, true, "--s10-holds leave: the mismatch is expected, not a failure");
  assert.equal(numberVerdict({ ...base, conversations_left: 1 }).pass, false);
  assert.equal(numberVerdict({ ...base, state: "blocked" }).pass, true, "state alone does not decide: the §7 checks do");
});

test("phase 1 lock: a live repair child refuses a second start; a stale lock is taken over; release clears only its own", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-lock-"));
  try {
    const path = repairLockPath(join(dir, "csi-full-backfill.json"));
    assert.ok(path.endsWith("csi-full-backfill.repair.lock"));
    const lock = (pid: number) => ({ pid, started_at: "2026-09-25T00:00:00.000Z", repair_manifest: "r.json" });
    assert.deepEqual(await acquireRepairLock(path, lock(111), () => false), { replaced_stale: false });
    await assert.rejects(() => acquireRepairLock(path, lock(222), pid => pid === 111), /pid 111.*still running/);
    assert.deepEqual(await acquireRepairLock(path, lock(333), () => false), { replaced_stale: true }, "a dead PID's lock is stale");
    await releaseRepairLock(path, 111);
    assert.equal(JSON.parse(await readFile(path, "utf8")).pid, 333, "another run's lock is left alone");
    await releaseRepairLock(path, 333);
    await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
