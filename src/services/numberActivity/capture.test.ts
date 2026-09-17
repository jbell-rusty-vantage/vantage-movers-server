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
import { nextState, resolveWindowStart, type ReconcileConfig, type WindowResult } from "./reconcileCallLog";

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
  overlapMinutes: 15,
  maxPages: 20,
  perPage: 250,
  finalizationLagMinutes: 15,
  leaseTtlMs: 300_000,
};

function window(partial: Partial<WindowResult> & Pick<WindowResult, "from" | "to">): WindowResult {
  return {
    kind: "rolling",
    pages: 1,
    records: 0,
    upserts: 0,
    noops: 0,
    failures: 0,
    complete: true,
    incomplete_before: null,
    error_code: null,
    ...partial,
  };
}

test("window start honors the twelve-hour floor and the cursor overlap", () => {
  const now = at(0);
  assert.equal(resolveWindowStart(now, {}, config).toISOString(), at(-720 * 60).toISOString());
  const recent = { cursor: { last_sync_to: at(-600) } };
  assert.equal(resolveWindowStart(now, recent, config).toISOString(), at(-720 * 60).toISOString(), "recent cursor: floor wins");
  const stale = { cursor: { last_sync_to: at(-20 * 3600) } };
  assert.equal(resolveWindowStart(now, stale, config).toISOString(), at(-20 * 3600 - 15 * 60).toISOString(), "stale cursor: overlap start wins");
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
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      for (const marker of forbidden) {
        assert.equal(specifier.includes(marker), false, `${file} imports forbidden module ${specifier}`);
      }
    }
  }
});
