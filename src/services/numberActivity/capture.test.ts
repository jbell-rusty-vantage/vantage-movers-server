import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  accountIdFromProviderPath,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import { at } from "./fixtures";
import { nextState, type ReconcileConfig, type WindowResult } from "./reconcileCallLog";

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

test("A3: observed ignores the provisional cap but honours the ISync cap", () => {
  const rolling = [window({ from: at(-240 * 60), to: at(0) })];
  // A stuck provisional row 50 minutes back caps `known`; `observed` keeps only the 15-minute lag.
  const provisional = nextState({ known_complete_through: at(-7200) }, rolling, at(0), at(1), config, null, {
    completeThroughCap: at(-3000),
    observedThroughCap: null,
  });
  assert.equal(provisional.known_complete_through?.toISOString(), at(-3000).toISOString());
  assert.equal(provisional.observed_complete_through?.toISOString(), at(-900).toISOString(), "windowTo minus the finalization lag");
  // The ISync cap (provider sync time − lag) binds both.
  const synced = nextState({ known_complete_through: at(-7200) }, rolling, at(0), at(1), config, null, {
    completeThroughCap: at(-3000),
    observedThroughCap: at(-1500),
  });
  assert.equal(synced.known_complete_through?.toISOString(), at(-3000).toISOString());
  assert.equal(synced.observed_complete_through?.toISOString(), at(-1500).toISOString());
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
