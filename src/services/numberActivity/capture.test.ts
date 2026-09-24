import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  accountIdFromProviderPath,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import { EMPTY_DIRECTORY_LOOKUP } from "./directory";
import { at, syntheticDirectory, SYNTHETIC_QUEUE_EXTENSION, SYNTHETIC_SALES_DID } from "./fixtures";
import { classifyEndpoint, toE164, toNationalTenDigit } from "./phone";
import { nextState, resolveWindowPlan, resolveWindowStart, type ReconcileConfig, type WindowResult } from "./reconcileCallLog";

const directory = syntheticDirectory();

test("phone classification: external, company DID, extension, withheld, service code, malformed", () => {
  assert.equal(classifyEndpoint({ phoneNumber: "(555) 010-0200" }, directory).kind, "external");
  assert.equal(classifyEndpoint({ phoneNumber: "+15550100200" }, directory).e164, "+15550100200");
  assert.equal(classifyEndpoint({ phoneNumber: SYNTHETIC_SALES_DID }, directory).kind, "company_did");
  assert.equal(classifyEndpoint({ phoneNumber: SYNTHETIC_SALES_DID }, EMPTY_DIRECTORY_LOOKUP).kind, "external", "no directory: company classification is not guessed");
  assert.equal(classifyEndpoint({ phoneNumber: null, extensionId: SYNTHETIC_QUEUE_EXTENSION.id }, directory).kind, "extension");
  assert.equal(classifyEndpoint({ phoneNumber: "101" }, directory).kind, "extension");
  assert.equal(classifyEndpoint({ phoneNumber: "101" }, directory).e164, null);
  assert.equal(classifyEndpoint({ phoneNumber: null, name: "Anonymous" }, directory).kind, "withheld");
  assert.equal(classifyEndpoint({ phoneNumber: "anonymous" }, directory).kind, "withheld");
  assert.equal(classifyEndpoint({ phoneNumber: "0000000000" }, directory).kind, "withheld");
  assert.equal(classifyEndpoint({ phoneNumber: "911" }, directory).kind, "service_code");
  assert.equal(classifyEndpoint({ phoneNumber: "*67" }, directory).kind, "service_code");
  const malformed = classifyEndpoint({ phoneNumber: "+1" }, directory);
  assert.equal(malformed.kind, "malformed");
  assert.equal(malformed.raw, "+1");
  assert.equal(malformed.e164, null);
  assert.equal(classifyEndpoint({ phoneNumber: "abc-def" }, directory).kind, "malformed");
  assert.equal(toE164("5550100200"), "+15550100200");
  assert.equal(toNationalTenDigit("+15550100200"), "5550100200");
  assert.equal(toNationalTenDigit("+445550100200"), null);
});

test("provider account resolution never fabricates or silently picks between accounts", () => {
  assert.equal(accountIdFromProviderPath("/restapi/v1.0/account/800000000001/telephony/sessions"), "800000000001");
  assert.equal(accountIdFromProviderPath("https://x/restapi/v1.0/account/800000000001/call-log/abc"), "800000000001");
  assert.equal(accountIdFromProviderPath("/restapi/v1.0/account/~/call-log"), null);
  assert.equal(resolveProviderAccountId(["800000000001", null, "800000000001"], null), "800000000001");
  assert.equal(resolveProviderAccountId([null, undefined], "800000000001"), "800000000001");
  assert.equal(resolveProviderAccountId(["~"], "800000000001"), "800000000001");
  assert.throws(() => resolveProviderAccountId([null], null), (e: unknown) => e instanceof ProviderAccountError && e.code === "account_unresolved");
  assert.throws(() => resolveProviderAccountId(["1", "2"], null), (e: unknown) => e instanceof ProviderAccountError && e.code === "account_mismatch");
  assert.throws(() => resolveProviderAccountId(["1"], "2"), (e: unknown) => e instanceof ProviderAccountError && e.code === "account_mismatch");
});

const config: ReconcileConfig = {
  rollingLookbackMinutes: 720,
  safetyLookbackMinutes: 90,
  overlapMinutes: 15,
  maxPages: 20,
  perPage: 250,
  finalizationLagMinutes: 15,
  leaseTtlMs: 300_000,
  settleHorizonMinutes: 240,
  quarantineAfter: 3,
  quarantineRetriesPerRun: 5,
  stragglerReadsPerRun: 10,
  syncMode: "off",
  sweepLookbackHours: 36,
};

function window(partial: Partial<WindowResult> & Pick<WindowResult, "from" | "to">): WindowResult {
  return {
    kind: "rolling",
    pages: 1,
    records: 0,
    upserts: 0,
    noops: 0,
    failures: 0,
    quarantined: 0,
    complete: true,
    incomplete_before: null,
    error_code: null,
    ...partial,
  };
}

test("window start is a watermark with a bounded safety lookback, and records what it skipped", () => {
  const now = at(0);
  // Cold start: no cursor, no gaps, so the full lookback is the honest reach.
  assert.equal(resolveWindowStart(now, {}, config).toISOString(), at(-720 * 60).toISOString());
  assert.equal(resolveWindowPlan(now, {}, config).skipped, null);

  // Steady state: the cursor part of the window is a watermark that moves
  // FORWARD. It used to be able to move it only earlier, so every run
  // re-projected a full twelve hours.
  const recent = { cursor: { last_sync_to: at(-600) } };
  const incremental = resolveWindowPlan(now, recent, config, 10);
  assert.equal(incremental.from.toISOString(), at(-600 - 15 * 60).toISOString(), "cursor minus overlap");
  assert.equal(incremental.incremental_from.toISOString(), at(-600 - 15 * 60).toISOString());
  assert.equal(incremental.skipped, null);

  // Stale cursor: the incremental part is clamped to the safety lookback and
  // whatever the clamp left behind is returned, never silently skipped.
  const stale = { cursor: { last_sync_to: at(-20 * 3600) } };
  const clamped = resolveWindowPlan(now, stale, config, 60);
  assert.equal(clamped.from.toISOString(), at(-90 * 60).toISOString(), "clamped to the safety lookback");
  assert.deepEqual(
    [clamped.skipped?.from.toISOString(), clamped.skipped?.to.toISOString()],
    [at(-20 * 3600 - 15 * 60).toISOString(), at(-90 * 60).toISOString()],
  );
});

test("CC-03: the window always reaches back the settle horizon, and the clamp gap is still opened", () => {
  const now = at(0);
  // Fresh cursor: the incremental start is 20 minutes back, the window 240.
  const fresh = resolveWindowPlan(now, { cursor: { last_sync_to: at(-5 * 60) } }, config);
  assert.equal(fresh.from.toISOString(), at(-240 * 60).toISOString(), "now minus the settle horizon");
  assert.equal(fresh.incremental_from.toISOString(), at(-20 * 60).toISOString());
  assert.equal(fresh.skipped, null);

  // Stale cursor: the horizon reaches past the safety clamp, but the clamp
  // gap is about the incremental start and is opened exactly as before.
  const stale = resolveWindowPlan(now, { cursor: { last_sync_to: at(-20 * 3600) } }, config);
  assert.equal(stale.from.toISOString(), at(-240 * 60).toISOString());
  assert.deepEqual(
    [stale.skipped?.from.toISOString(), stale.skipped?.to.toISOString()],
    [at(-20 * 3600 - 15 * 60).toISOString(), at(-90 * 60).toISOString()],
  );
  const gaps = nextState({ gaps: [] as never[] }, [window({ from: stale.from, to: now })], now, at(1), config, stale.skipped);
  assert.deepEqual(gaps.gaps.map((g) => g.reason), ["watermark_clamp"]);

  // With Call Log Sync driving, the window narrows to the safety net (90).
  assert.equal(resolveWindowPlan(now, { cursor: { last_sync_to: at(-5 * 60) } }, config, config.safetyLookbackMinutes).from.toISOString(), at(-90 * 60).toISOString());
});

test("CC-03: known_complete_through never passes the oldest provisional start inside the horizon", () => {
  const capped = nextState({ known_complete_through: at(-7200) }, [window({ from: at(-240 * 60), to: at(0) })], at(0), at(1), config, null, {
    completeThroughCap: at(-3000),
  });
  assert.equal(capped.known_complete_through?.toISOString(), at(-3000).toISOString());
  const behind = nextState({ known_complete_through: at(-2000) }, [window({ from: at(-240 * 60), to: at(0) })], at(0), at(1), config, null, {
    completeThroughCap: at(-3000),
  });
  assert.equal(behind.known_complete_through?.toISOString(), at(-2000).toISOString(), "an older provisional row holds it: never raised, never lowered");
  const overflow = nextState({ gaps: [] as never[] }, [window({ from: at(-240 * 60), to: at(0) })], at(0), at(1), config, null, {
    overflow: [{ from: at(-50_000), to: at(-49_940) }],
  });
  assert.deepEqual(overflow.gaps.map((g) => g.reason), ["quarantine_overflow"], "an evicted quarantine entry becomes a repairable gap");
});

test("a clamped window opens a repairable gap instead of losing the range", () => {
  const skipped = { from: at(-20 * 3600 - 15 * 60), to: at(-90 * 60) };
  const opened = nextState({ gaps: [] as never[] }, [window({ from: at(-90 * 60), to: at(0) })], at(0), at(1), config, skipped);
  assert.equal(opened.cursor_advanced, true, "the incremental window still completed");
  assert.deepEqual(
    opened.gaps.map((g) => [g.from.toISOString(), g.to.toISOString(), g.reason]),
    [[skipped.from.toISOString(), skipped.to.toISOString(), "watermark_clamp"]],
    "gap repair, which already runs oldest-first on leftover budget, covers it",
  );
  assert.equal(opened.opened.length, 1);

  // Re-clamping on a later run widens the same gap rather than accumulating duplicates.
  const again = nextState({ gaps: opened.gaps }, [window({ from: at(-90 * 60), to: at(0) })], at(0), at(1), config,
    { from: at(-30 * 3600), to: at(-90 * 60) });
  assert.equal(again.gaps.length, 1);
  assert.equal(again.gaps[0]!.from.toISOString(), at(-30 * 3600).toISOString());
  assert.equal(again.opened.length, 0);
});

test("coverage: complete rolling window advances cursor and watermark, closes covered gaps", () => {
  const state = {
    known_complete_through: at(-7200),
    gaps: [
      { from: at(-3000), to: at(-2000), reason: "provider_request_failed", opened_at: at(-1900) },
      { from: at(-90000), to: at(-80000), reason: "provider_throttled", opened_at: at(-79000) },
    ],
  };
  const result = nextState(state, [window({ from: at(-43200), to: at(0) })], at(0), at(1), config);
  assert.equal(result.cursor_advanced, true);
  assert.equal(result.known_complete_through?.toISOString(), at(-900).toISOString(), "windowTo minus finalization lag");
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]!.reason, "provider_throttled", "gap outside the window stays open");
  assert.equal(result.closed.length, 1);
});

test("coverage: partial page failure never advances complete-through and records the missing range", () => {
  const state = { known_complete_through: at(-7200), gaps: [] as never[] };
  const failed = nextState(
    state,
    [window({ from: at(-43200), to: at(0), pages: 3, complete: false, error_code: "provider_request_failed" })],
    at(0),
    at(1),
    config,
  );
  assert.equal(failed.cursor_advanced, false);
  assert.equal(failed.known_complete_through?.toISOString(), at(-7200).toISOString());
  assert.deepEqual(failed.gaps.map((g) => [g.from.toISOString(), g.to.toISOString(), g.reason]), [
    [at(-43200).toISOString(), at(0).toISOString(), "provider_request_failed"],
  ]);
  assert.equal(failed.opened.length, 1);

  const pageLimit = nextState(
    state,
    [window({ from: at(-43200), to: at(0), pages: 20, complete: false, error_code: "page_limit", incomplete_before: at(-5000) })],
    at(0),
    at(1),
    config,
  );
  assert.equal(pageLimit.cursor_advanced, false);
  assert.deepEqual(pageLimit.gaps.map((g) => [g.from.toISOString(), g.to.toISOString(), g.reason]), [
    [at(-43200).toISOString(), at(-5000).toISOString(), "page_limit"],
  ]);

  const throttled = nextState(
    state,
    [window({ from: at(-43200), to: at(0), pages: 0, complete: false, error_code: "provider_throttled" })],
    at(0),
    at(1),
    config,
  );
  assert.equal(throttled.gaps[0]!.reason, "provider_throttled");
  assert.equal(throttled.known_complete_through?.toISOString(), at(-7200).toISOString());
});

test("coverage: gap repair removes a repaired gap, narrows a partially repaired one, and never drops gaps past the bound", () => {
  const gap = { from: at(-90000), to: at(-80000), reason: "provider_throttled", opened_at: at(-79000) };
  const repaired = nextState(
    { gaps: [gap] },
    [window({ from: at(-43200), to: at(0) }), window({ kind: "gap_repair", from: gap.from, to: gap.to })],
    at(0),
    at(1),
    config,
  );
  assert.equal(repaired.gaps.length, 0);
  const narrowed = nextState(
    { gaps: [gap] },
    [window({ kind: "gap_repair", from: gap.from, to: gap.to, complete: false, error_code: "page_limit", incomplete_before: at(-85000) })],
    at(0),
    at(1),
    config,
  );
  assert.equal(narrowed.gaps.length, 1);
  assert.equal(narrowed.gaps[0]!.to.toISOString(), at(-85000).toISOString());
  const many = Array.from({ length: 50 }, (_, i) => ({
    from: at(-1_000_000 + i * 1000),
    to: at(-1_000_000 + i * 1000 + 500),
    reason: "provider_request_failed",
    opened_at: at(0),
  }));
  const bounded = nextState(
    { gaps: many },
    [window({ from: at(-43200), to: at(0), complete: false, error_code: "provider_throttled" })],
    at(0),
    at(1),
    config,
  );
  assert.equal(bounded.gaps.length, 50);
  assert.equal(bounded.gaps[0]!.reason, "coalesced");
  assert.equal(bounded.gaps[0]!.from.toISOString(), many[0]!.from.toISOString());
  assert.equal(bounded.gaps[0]!.to.toISOString(), many[1]!.to.toISOString());
  assert.equal(bounded.gaps.at(-1)!.reason, "provider_throttled");
});

test("import boundary: numberActivity never imports qualification, ingest, convergence or Lead write services", () => {
  const dir = path.join(process.cwd(), "src", "services", "numberActivity");
  const forbidden = [
    "ringcentral-call-lead-ingest.service",
    "call-log-vetting",
    "call-candidate-",
    "call-session-",
    "callLeadConvergence.service",
    "call-log-sync",
    "/leads/",
  ];
  // Explicit exemption: the parity test may import the qualification evaluator
  // read-only to prove TERMINAL_PARTY_STATUSES stays in sync (03 §2.3 asks for
  // reuse while §0 forbids the runtime import; runtime uses a local constant).
  const testOnlyExemptions = new Map<string, string[]>([
    ["interactionProjection.test.ts", ["../ringcentral/call-candidate-evaluator"]],
  ]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    const allowed = testOnlyExemptions.get(file) ?? [];
    for (const specifier of imports) {
      if (allowed.includes(specifier)) {
        assert.equal(file.endsWith(".test.ts"), true, `${file}: exemption is test-only`);
        continue;
      }
      for (const marker of forbidden) {
        assert.equal(specifier.includes(marker), false, `${file} imports forbidden module ${specifier}`);
      }
    }
  }
});
