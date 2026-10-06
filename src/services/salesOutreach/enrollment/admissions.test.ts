import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { salesOutreachAdmissionsSchema } from "../../../validation/v1/salesOutreachEnrollment";
import { OutreachError } from "../errors";
import { objectId } from "../subjects/testing";
import { ADMISSIONS_RECENT_LIMIT, ADMISSIONS_RETENTION_DAYS, admissionCountsOf, leadRefOfJob, readEnrollmentAdmissions } from "./admissions";
import { MemoryAdmissionsStore } from "./testing";

/** 2026-10-06 is EDT: the New York day runs 04:00Z → 04:00Z next day. */
const NOW = new Date("2026-10-06T19:00:00.000Z");
const form = () => ({ model: "FormLead", id: objectId() });
const call = () => ({ model: "CallLead", id: objectId() });
const created = (status: string | null, admission: string | null = "intake") => ({ outcome: "created", subject_id: objectId(), reason: null, status, admission });
const refused = (reason: string) => ({ outcome: "not_admitted", subject_id: null, reason, status: null, admission: null });

describe("GET /enrollment/admissions (olr B8: intake refusals are visible)", () => {
  test("admissions read groups completed lead-change results by outcome and reason for the New York day", async () => {
    const store = new MemoryAdmissionsStore();
    const ambiguous = form();
    store
      .complete(form(), "2026-10-06T04:00:00.000Z", created("active")) // the day's first instant (00:00 EDT)
      .complete(call(), "2026-10-06T13:00:00Z", created("active"))
      .complete(ambiguous, "2026-10-06T14:00:00Z", created("review")) // held: ambiguous identity
      .complete(form(), "2026-10-06T14:30:00Z", created("review")) // held: received time missing
      .complete(form(), "2026-10-06T12:00:00Z", { outcome: "created", subject_id: objectId(), reason: null }) // stored before B8
      .complete(form(), "2026-10-06T15:00:00Z", refused("closed_priority"))
      .complete(call(), "2026-10-06T16:00:00Z", refused("closed_priority"))
      .complete(form(), "2026-10-06T17:00:00Z", refused("unsupported_intake_source"))
      .complete(form(), "2026-10-06T18:00:00Z", refused("excluded:duplicate"))
      .complete(form(), "2026-10-06T18:30:00Z", { outcome: "not_admitted", subject_id: null, reason: null })
      // Not admissions: subject refreshes, other days, other stages, unfinished jobs.
      .complete(form(), "2026-10-06T15:30:00Z", { outcome: "updated", subject_id: objectId(), reason: null, status: "active", admission: null })
      .complete(form(), "2026-10-06T15:31:00Z", { outcome: "unchanged", subject_id: objectId(), reason: "repeated_priority", status: "active", admission: null })
      .complete(form(), "2026-10-06T03:59:59.999Z", refused("closed_priority")) // 23:59 on the 5th, New York
      .complete(form(), "2026-10-07T04:00:00.000Z", refused("closed_priority")) // 00:00 on the 7th, New York
      .complete(form(), "2026-10-06T15:00:00Z", refused("closed_priority"), { stage: "outreach_evaluate" })
      .complete(form(), "2026-10-06T15:00:00Z", refused("closed_priority"), { status: "retry" });
    const read = await readEnrollmentAdmissions({ business_day: "2026-10-06" }, { store, now: () => NOW });
    salesOutreachAdmissionsSchema.parse(read);
    assert.deepEqual(read.counts, {
      admitted_intake: 3,
      admitted_review: 2,
      admitted_expansion: 0,
      deferred: 0,
      not_admitted: { closed_priority: 2, "excluded:duplicate": 1, unknown: 1, unsupported_intake_source: 1 },
    });
    assert.deepEqual(
      read.recent_refusals.map((r) => [r.reason, r.at]),
      [
        ["unknown", "2026-10-06T18:30:00.000Z"],
        ["excluded:duplicate", "2026-10-06T18:00:00.000Z"],
        ["unsupported_intake_source", "2026-10-06T17:00:00.000Z"],
        ["closed_priority", "2026-10-06T16:00:00.000Z"],
        ["closed_priority", "2026-10-06T15:00:00.000Z"],
      ],
      "newest first, this day only",
    );
    assert.equal(read.recent_refusals[3]!.lead.model, "CallLead");
    assert.deepEqual([read.business_day, read.as_of, read.timezone, read.retention_days], ["2026-10-06", NOW.toISOString(), "America/New_York", 14]);
  });

  test("defaults to today in New York; the refusal list is bounded and skips a malformed job key", async () => {
    const store = new MemoryAdmissionsStore();
    for (let i = 0; i < ADMISSIONS_RECENT_LIMIT + 5; i++) store.complete(form(), new Date(+NOW - (i + 1) * 60_000).toISOString(), refused("closed_priority"));
    store.complete(form(), new Date(+NOW - 10_000).toISOString(), refused("historical_import"), { subject_key: "outreach-lead:Nope:x", input_refs: ["x"] });
    const read = await readEnrollmentAdmissions({}, { store, now: () => NOW });
    assert.equal(read.business_day, "2026-10-06");
    assert.deepEqual(read.counts.not_admitted, { closed_priority: ADMISSIONS_RECENT_LIMIT + 5, historical_import: 1 });
    assert.equal(read.recent_refusals.length, ADMISSIONS_RECENT_LIMIT - 1, "the malformed row takes a slot but is not listed");
    assert.ok(read.recent_refusals.every((r) => r.reason === "closed_priority"));
    salesOutreachAdmissionsSchema.parse(read);
  });

  test("a day beyond the job retention is retention_exceeded; a future day is refused; the oldest whole day answers", async () => {
    const store = new MemoryAdmissionsStore();
    const issue = async (day: string) => {
      try {
        await readEnrollmentAdmissions({ business_day: day }, { store, now: () => NOW });
        return null;
      } catch (error) {
        assert.ok(error instanceof OutreachError);
        return [error.code, error.issues?.[0]?.code];
      }
    };
    assert.equal(ADMISSIONS_RETENTION_DAYS, 14);
    // 2026-09-23 starts 04:00Z: 13 days and 15 hours before NOW — every job of that day is still kept.
    assert.equal(await issue("2026-09-23"), null);
    assert.deepEqual(await issue("2026-09-22"), ["INVALID_INPUT", "retention_exceeded"]);
    assert.deepEqual(await issue("2026-10-07"), ["INVALID_INPUT", "business_day_in_future"]);
  });

  test("counts: expansion and deferred outcomes (olr B6) are counted apart from intake", () => {
    assert.deepEqual(
      admissionCountsOf([
        { outcome: "created", reason: null, status: "active", admission: "expansion", count: 4 },
        { outcome: "created", reason: null, status: "review", admission: "intake", count: 1 },
        { outcome: "deferred", reason: "deferred_to_intake", status: null, admission: null, count: 2 },
      ]),
      { admitted_intake: 0, admitted_review: 1, admitted_expansion: 4, deferred: 2, not_admitted: {} },
    );
  });

  test("the Lead of a job comes from its subject key", () => {
    const id = "a".repeat(24);
    assert.deepEqual(leadRefOfJob({ subject_key: `outreach-lead:CallLead:${id}`, input_refs: [id] }), { model: "CallLead", id });
    assert.equal(leadRefOfJob({ subject_key: `outreach-lead:Agent:${id}`, input_refs: [id] }), null);
    assert.equal(leadRefOfJob({ subject_key: "sod:evaluate:x", input_refs: [] }), null);
  });
});
