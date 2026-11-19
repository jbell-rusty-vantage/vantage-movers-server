import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reviewedRepMailboxes } from "../../ringcentral/repSms/mailboxes";
import { deskTimingOf } from "../config/timing";
import {
  cadenceCallCoverage,
  currentSmsMailboxRows,
  goalCallCoverage,
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

  test("a current mailbox without a watermark still yields null; a retired one without a watermark does not", () => {
    const unsynced = syncRows.map((r) => (r.scope === "rep_sms:103" ? { ...r, known_complete_through: null } : r));
    assert.equal(smsCoverage(currentSmsMailboxRows(unsynced, currentAt(NOW))), null);
    const retiredUnsynced = syncRows.map((r) => (r.scope === "rep_sms:101" ? { ...r, known_complete_through: null } : r));
    assert.equal(iso(smsCoverage(currentSmsMailboxRows(retiredUnsynced, currentAt(NOW)))), "2026-10-06T17:25:00.000Z");
    assert.equal(smsCoverage(currentSmsMailboxRows(syncRows, [])), null, "no current mailbox: null, as before");
    assert.deepEqual(currentSmsMailboxRows([{ known_complete_through: at("17:00") }, { scope: null }], ["102"]), [], "rows without a scope never count");
  });
});
