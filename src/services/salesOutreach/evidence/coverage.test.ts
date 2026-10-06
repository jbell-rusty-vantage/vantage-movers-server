import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reviewedRepMailboxes } from "../../ringcentral/repSms/mailboxes";
import { deskTimingOf } from "../config/timing";
import { completeConfigurationInput } from "../evaluation/testing";
import { engineCoverageOf } from "../evaluation/inputs";
import { readFreshness } from "../reads/common";
import { activeInspection, MemoryReadStore } from "../reads/testing";
import {
  cadenceCallCoverage,
  callWatermarksOf,
  currentSmsMailboxRows,
  goalCallCoverage,
  NO_CALL_WATERMARKS,
  smsCoverage,
  type CallWatermarks,
} from "./coverage";

const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const DEFAULT = deskTimingOf(null);

/** Capture capped 50 min behind by a stuck provisional row; observed only the 15-min lag behind. */
const marks: CallWatermarks = {
  capture_known: t("19:06"),
  capture_observed: t("19:41"),
  derived_known: t("19:06"),
  derived_observed: t("19:41"),
  coverage_from: t("04:00"),
};

describe("evidence coverage (olr A3)", () => {
  test("cadence coverage = min(capped capture − allowance, derivation watermark)", () => {
    assert.equal(iso(cadenceCallCoverage(marks, DEFAULT)), "2026-10-05T19:04:00.000Z", "capture − 2 min binds");
    assert.equal(iso(cadenceCallCoverage({ ...marks, derived_known: t("18:30") }, DEFAULT)), "2026-10-05T18:30:00.000Z", "derivation behind binds (F2)");
    assert.equal(cadenceCallCoverage({ ...marks, derived_known: null }, DEFAULT), null, "nothing derived yet: unknowable");
    assert.equal(cadenceCallCoverage({ ...marks, capture_known: null }, DEFAULT), null);
  });

  test("goal coverage ignores the provisional cap (D-A3) but keeps the allowance and the derivation bound", () => {
    assert.equal(iso(goalCallCoverage(marks, DEFAULT)), "2026-10-05T19:39:00.000Z", "observed − 2 min");
    assert.equal(iso(goalCallCoverage({ ...marks, derived_observed: t("19:20") }, DEFAULT)), "2026-10-05T19:20:00.000Z", "never past what was derived");
    assert.ok(+goalCallCoverage(marks, DEFAULT)! > +cadenceCallCoverage(marks, DEFAULT)!, "the cadence engine keeps the cap");
  });

  test("goal coverage falls back to the capped watermarks before the first A3 run writes the observed ones", () => {
    const legacy = { ...marks, capture_observed: null, derived_observed: null };
    assert.equal(iso(goalCallCoverage(legacy, DEFAULT)), iso(cadenceCallCoverage(legacy, DEFAULT)));
    // Capture already observed, sweep not yet: the derived known bounds it.
    assert.equal(iso(goalCallCoverage({ ...marks, derived_observed: null }, DEFAULT)), "2026-10-05T19:06:00.000Z");
    assert.equal(goalCallCoverage(NO_CALL_WATERMARKS, DEFAULT), null);
    // An observed value older than its capped twin (never written by A3 code) is read as the capped one.
    const stale = { ...marks, derived_known: t("19:30"), derived_observed: t("19:00") };
    assert.equal(iso(goalCallCoverage(stale, DEFAULT)), "2026-10-05T19:30:00.000Z");
    assert.ok(+goalCallCoverage(stale, DEFAULT)! >= +cadenceCallCoverage(stale, DEFAULT)!, "goal coverage is never behind cadence coverage");
  });

  test("the settlement allowance comes from configuration", () => {
    const five = deskTimingOf({ evidence: { call_settlement_allowance_minutes: 5 } } as never);
    assert.equal(iso(cadenceCallCoverage(marks, five)), "2026-10-05T19:01:00.000Z");
    assert.equal(iso(goalCallCoverage(marks, five)), "2026-10-05T19:36:00.000Z");
    const zero = deskTimingOf({ evidence: { call_settlement_allowance_minutes: 0 } } as never);
    assert.equal(iso(cadenceCallCoverage(marks, zero)), "2026-10-05T19:06:00.000Z");
  });

  test("callWatermarksOf maps the two sync-state rows, in any order, either missing", () => {
    const rows = [
      { scope: "outreach_contact_calls", known_complete_through: t("19:00"), observed_complete_through: t("19:30"), cursor: { outreach_coverage_from: t("04:00") } },
      { scope: "rep_sms:101", known_complete_through: t("12:00") },
      { scope: "call_log_all_directions", known_complete_through: t("19:05"), observed_complete_through: t("19:35") },
    ];
    assert.deepEqual(callWatermarksOf(rows), {
      capture_known: t("19:05"),
      capture_observed: t("19:35"),
      derived_known: t("19:00"),
      derived_observed: t("19:30"),
      coverage_from: t("04:00"),
    });
    assert.deepEqual(callWatermarksOf([]), NO_CALL_WATERMARKS);
    assert.deepEqual(callWatermarksOf([{ scope: "call_log_all_directions", known_complete_through: t("19:05") }]), {
      ...NO_CALL_WATERMARKS,
      capture_known: t("19:05"),
    });
  });

  test("SMS coverage is the worst mailbox; none, or any mailbox without coverage, is unknowable", () => {
    assert.equal(iso(smsCoverage([{ known_complete_through: t("19:00") }, { known_complete_through: t("18:20") }, { known_complete_through: t("19:10") }])), "2026-10-05T18:20:00.000Z");
    assert.equal(smsCoverage([]), null);
    assert.equal(smsCoverage([{ known_complete_through: t("19:00") }, { known_complete_through: null }]), null);
    assert.equal(smsCoverage([{ known_complete_through: t("19:00") }, {}]), null);
  });
});

/**
 * olr hotfix (2026-10-06 16:52Z): connecting a rep in Accounts retired 4 of 13 mailbox links; their
 * `rep_sms:<extension>` rows stopped at 16:48–16:50Z and never advance again. SMS coverage is taken over the
 * current reviewed `sales_rep` mailboxes only, by the evaluation and the reads alike.
 */
describe("SMS coverage over the current rep mailboxes (olr hotfix)", () => {
  const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00Z`);
  const NOW = at("17:30");
  const ACCOUNT = "4001";
  const link = (id: string, extension: string, overrides: Record<string, unknown> = {}) => ({
    _id: id,
    revision: 1,
    agent_id: `agent-${extension}`,
    rc_account_id: ACCOUNT,
    rc_extension_id: extension,
    role_kind: "sales_rep",
    status: "reviewed",
    effective_from: at("09:00"),
    effective_to: null as Date | null,
    reviewed_at: at("09:00"),
    reviewed_by: "owner",
    ...overrides,
  });
  /** 101 was retired at 16:52 (its row froze at 16:48); 102/103 stay reviewed; 104 was re-linked to another role. */
  const links = [
    link("l101", "101", { status: "retired", effective_to: at("16:52") }),
    link("l102", "102"),
    link("l103", "103"),
    link("l104", "104", { effective_to: at("16:52"), status: "retired" }),
    link("l104b", "104", { role_kind: "service", effective_from: at("16:52") }),
  ];
  const syncRows = [
    { scope: "rep_sms:101", known_complete_through: at("16:48") },
    { scope: "rep_sms:102", known_complete_through: at("17:28") },
    { scope: "rep_sms:103", known_complete_through: at("17:25") },
    { scope: "rep_sms:104", known_complete_through: at("16:50") },
  ];
  const currentAt = (instant: Date) => reviewedRepMailboxes(links as never, ACCOUNT, instant).map((m) => m.extension_id);

  test("the current set is the reviewed sales_rep mailboxes at the instant (retired and re-roled links drop out)", () => {
    assert.deepEqual(currentAt(at("16:00")), ["101", "102", "103", "104"]);
    assert.deepEqual(currentAt(NOW), ["102", "103"]);
  });

  test("a retired mailbox with an old watermark does not hold coverage back", () => {
    assert.equal(iso(smsCoverage(syncRows)), "2026-10-06T16:48:00.000Z", "over every row (the bug): frozen at the retired mailbox");
    assert.deepEqual(currentSmsMailboxRows(syncRows, currentAt(NOW)).map((r) => r.scope), ["rep_sms:102", "rep_sms:103"]);
    assert.equal(iso(smsCoverage(currentSmsMailboxRows(syncRows, currentAt(NOW)))), "2026-10-06T17:25:00.000Z");
  });

  test("a current mailbox without a watermark still yields null; a retired one without a watermark does not", () => {
    const unsynced = syncRows.map((r) => (r.scope === "rep_sms:103" ? { ...r, known_complete_through: null } : r));
    assert.equal(smsCoverage(currentSmsMailboxRows(unsynced, currentAt(NOW))), null);
    const retiredUnsynced = syncRows.map((r) => (r.scope === "rep_sms:101" ? { ...r, known_complete_through: null } : r));
    assert.equal(iso(smsCoverage(currentSmsMailboxRows(retiredUnsynced, currentAt(NOW)))), "2026-10-06T17:25:00.000Z");
    assert.equal(smsCoverage(currentSmsMailboxRows(syncRows, [])), null, "no current mailbox: null, as before");
    assert.deepEqual(currentSmsMailboxRows([{ known_complete_through: at("17:00") }, { scope: null }], ["102"]), [], "rows without a scope never count");
  });

  test("the evaluation and the reads agree on the SMS coverage", async () => {
    const current = currentAt(NOW);
    // Evaluation: `loadCoverage` → `engineCoverageOf` (call watermarks irrelevant here).
    const engine = engineCoverageOf({ calls: NO_CALL_WATERMARKS, sms_known_complete_through: smsCoverage(currentSmsMailboxRows(syncRows, current)) }, DEFAULT);
    // Reads: `readSmsMailboxes(now)` → `readFreshness` (cadence, capture and the SMS freshness chip).
    const store = new MemoryReadStore();
    store.mailboxes = currentSmsMailboxRows(
      syncRows.map((r) => ({ ...r, last_finished_at: r.known_complete_through, last_error_code: null })),
      current,
    );
    const read = await readFreshness(store, activeInspection(completeConfigurationInput({ rep_sms_capture_enabled: true })) as never, NOW);
    assert.equal(iso(engine.sms), "2026-10-06T17:25:00.000Z");
    assert.deepEqual(
      [iso(read.coverage.cadence.sms), iso(read.coverage.capture.sms), read.freshness.sms.known_complete_through],
      [iso(engine.sms), iso(engine.sms), iso(engine.sms)],
    );
  });
});
