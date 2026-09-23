import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { cutOverview, latestSummaryFromRun, officialStatus, OVERVIEW_MAX_CHARS } from "./detailDto";

process.env.TEST_MODE = "true";
const id = () => new mongoose.Types.ObjectId();
const sentence = (n: number, word = "word") => `${Array.from({ length: n }, () => word).join(" ")}.`;

test("cutOverview: table (data spec §4.1, final spec §11.1)", () => {
  const long = `${sentence(20, "alpha")} ${sentence(20, "bravo")} ${sentence(20, "charlie")}`; // 3 × 120 chars
  const rows: Array<[string, unknown, string | null]> = [
    ["not a string", 42, null],
    ["empty", "   ", null],
    ["short kept whole", "Customer is moving a two-bedroom apartment.", "Customer is moving a two-bedroom apartment."],
    ["whitespace collapsed", "Moving  in\nOctober.  Wants a quote.", "Moving in October. Wants a quote."],
    ["exactly max kept", "x".repeat(OVERVIEW_MAX_CHARS), "x".repeat(OVERVIEW_MAX_CHARS)],
    ["cut at the last sentence that fits", long, `${sentence(20, "alpha")} ${sentence(20, "bravo")} …`],
    ["abbreviation is not a boundary", `Spoke with Mr. Smith ${"about the move ".repeat(15)}today. ${sentence(30, "tail")}`, null],
    ["one long sentence cut at a word", `${"longword ".repeat(60)}end.`, null],
    ["one unbroken token hard-cut", "y".repeat(400), `${"y".repeat(OVERVIEW_MAX_CHARS - 1)}…`],
    ["question and exclamation end sentences", `Is the date firm? Yes! ${"z".repeat(300)}`, "Is the date firm? Yes! …"],
    ["closing quote kept with its sentence", `He said "call Friday." ${"q".repeat(300)}`, `He said "call Friday." …`],
  ];
  for (const [name, input, expected] of rows) {
    const out = cutOverview(input);
    if (expected !== null || typeof input !== "string" || !input.trim()) assert.equal(out, expected, name);
    if (out) assert.ok(out.length <= OVERVIEW_MAX_CHARS, `${name}: ${out.length} ≤ ${OVERVIEW_MAX_CHARS}`);
  }
  const abbreviated = cutOverview(rows[6]![1])!;
  assert.ok(abbreviated.startsWith("Spoke with Mr. Smith") && abbreviated.endsWith("today. …"), "Mr. did not end the sentence");
  const worded = cutOverview(rows[7]![1])!;
  assert.match(worded, /^(longword )+longword …$/);
});

test("cutOverview redacts before cutting", () => {
  const out = cutOverview("Customer emailed jane.doe@example.com and gave SSN 123-45-6789.")!;
  assert.doesNotMatch(out, /jane.doe@example.com|123-45-6789/);
});

test("latestSummaryFromRun: Number run, conversation run, legacy and unusable runs", () => {
  const at = new Date("2026-09-20T12:00:00Z");
  const number = { _id: id(), conversation_id: null, completed_at: at, output: { summary: { overview: "The move is set for October." } },
    step_artifacts: { summaries: [id(), id(), id()] } };
  assert.deepEqual(latestSummaryFromRun(number), { run_id: String(number._id), run_kind: "number", completed_at: at.toISOString(),
    overview: "The move is set for October.", conversations_covered: 3 });
  const conversation = { ...number, _id: id(), conversation_id: id(), step_artifacts: { summaries: [id()] } };
  assert.equal(latestSummaryFromRun(conversation)?.run_kind, "conversation");
  assert.equal(latestSummaryFromRun(conversation)?.conversations_covered, 1);
  // Legacy (pre-structured) runs carry no step artifacts: a conversation run covered one call; a Number run cannot say.
  assert.equal(latestSummaryFromRun({ ...conversation, step_artifacts: null })?.conversations_covered, 1);
  assert.equal(latestSummaryFromRun({ ...number, step_artifacts: null })?.conversations_covered, null);
  assert.equal(latestSummaryFromRun({ ...number, output: null }), null);
  assert.equal(latestSummaryFromRun({ ...number, output: { summary: { overview: "  " } } }), null);
  assert.equal(latestSummaryFromRun(null), null);
});

test("officialStatus: every status, exact booking fallback, Priority label", () => {
  const booking = { _id: id(), book_date: new Date("2026-09-10T00:00:00Z") };
  const older = { _id: id(), book_date: new Date("2026-08-10T00:00:00Z") };
  const none = new Set<string>();
  assert.equal(officialStatus(null, [], none), null, "Number-only subject has no official status");
  assert.deepEqual(officialStatus({}, [], none), { status: "open_lead", booking_id: null, priority: null });
  assert.equal(officialStatus({ booked: true }, [booking], none)?.status, "booked");
  assert.equal(officialStatus({ cancelled: true, booked: true }, [booking], none)?.status, "cancelled");
  assert.equal(officialStatus({ duplicate: true }, [], none)?.status, "duplicate");
  assert.equal(officialStatus({ bad_lead: { reason: "x" } }, [], none)?.status, "bad_lead");
  assert.equal(officialStatus({ no_sync: true }, [], none)?.status, "no_sync");
  // The exact booked_leads row closes even when the Lead mirror lags; its cancellation wins.
  assert.deepEqual(officialStatus({}, [older, booking], none), { status: "booked", booking_id: String(booking._id), priority: null });
  assert.equal(officialStatus({}, [booking], new Set([String(booking._id)]))?.status, "cancelled");
  assert.deepEqual(officialStatus({ granot_priority: 1 }, [], none)?.priority, { code: "1", label: "Quoted" });
  assert.deepEqual(officialStatus({ granot_priority: " 8 " }, [], none)?.priority, { code: "8", label: "CRM dead opportunity" });
  assert.deepEqual(officialStatus({ granot_priority: "42" }, [], none)?.priority, { code: "42", label: "Unknown meaning" });
});
