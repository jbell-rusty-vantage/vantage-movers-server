import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingJobNumberCore,
  bookingJobNumberFilter,
  bookingJobNumberKey,
  bookingJobNumbersEquivalent,
  classifyBookingJobNumber,
} from "./bookingJobNumber";

const accepted = (raw: string, jobClass: string, core: string) => {
  const verdict = classifyBookingJobNumber(raw);
  assert.equal(verdict.valid, true, `${JSON.stringify(raw)} must be accepted`);
  if (!verdict.valid) return;
  assert.equal(verdict.job_class, jobClass, JSON.stringify(raw));
  assert.equal(verdict.core, core, JSON.stringify(raw));
};
const rejected = (raw: unknown, reason: string) => {
  const verdict = classifyBookingJobNumber(raw);
  assert.equal(verdict.valid, false, `${JSON.stringify(raw)} must be rejected`);
  if (!verdict.valid) assert.equal(verdict.reason, reason, JSON.stringify(raw));
};

test("bare 7-digit Granot Job Numbers (Bookings, Leads, Record Links)", () => {
  accepted("5556835", "digits", "5556835");
  accepted("0012345", "digits", "0012345");
});

test("letter-prefixed Job Numbers: P (Granot), RF, AT and any other ASCII prefix", () => {
  accepted("P5556818", "prefixed", "5556818");
  accepted("RF5555499", "prefixed", "5555499");
  accepted("AT5564415", "prefixed", "5564415");
  accepted("EJBA5555555", "prefixed", "5555555");
  accepted("PA5556818", "prefixed", "5556818");
  accepted("X5556818", "prefixed", "5556818");
});

test("input that normalizes to a valid class: case, whitespace, width, punctuation", () => {
  for (const raw of ["p5556818", " P5556818 ", "P5556818\n", "\tp5556818", "Ｐ５５５６８１８", "#P5556818", "P5556818."])
    accepted(raw, "prefixed", "5556818");
  accepted(" 5556835 ", "digits", "5556835");
});

test("separated prefix: a hyphen or space between prefix and digits", () => {
  for (const raw of ["P-5556818", "P 5556818", "p_5556818", "P - 5556818", "RF-5555499"])
    accepted(raw, "separated_prefix", raw.toUpperCase().startsWith("RF") ? "5555499" : "5556818");
});

test("Granot annotations after the Job Number (Form Leads and Record Links: new, VIP, RIGOS)", () => {
  accepted("P5556759 new", "annotated", "5556759");
  accepted("P5556759 NEW", "annotated", "5556759");
  accepted("P5556759 VIP", "annotated", "5556759");
  accepted("P5556759 VIP RIGOS", "annotated", "5556759");
  accepted("P-5556759 (VIP)", "annotated", "5556759");
  accepted("Job #5556759", "separated_prefix", "5556759");
});

test("digit-core length bounds: 4 to 9 digits", () => {
  accepted("1234", "digits", "1234");
  accepted("P123456789", "prefixed", "123456789");
  rejected("123", "digit_core_length");
  rejected("P12", "digit_core_length");
  rejected("2125550101", "digit_core_length");
});

test("values that cannot be a Job Number are rejected with a reason", () => {
  rejected(undefined, "missing");
  rejected(null, "missing");
  rejected(5556835, "missing");
  rejected("", "missing");
  rejected("   ", "missing");
  rejected("-", "missing");
  rejected("Jane Customer", "no_digits");
  rejected("pending", "no_digits");
  rejected("EJBA03-LL-20260908-A", "multiple_numbers");
  rejected("P5556759 P5556760", "multiple_numbers");
  rejected("5556759A", "mixed_token");
  rejected("LNS03W01", "mixed_token");
});

test("equivalence and identity keys use the digit core of every valid class", () => {
  assert.equal(bookingJobNumberCore("P5556759 NEW"), "5556759");
  assert.equal(bookingJobNumberCore("P 5556759"), "5556759");
  assert.equal(bookingJobNumberCore("JANE CUSTOMER"), undefined);
  // Matching is structural: the write-time 4-9 digit bound never breaks an existing equivalence.
  assert.equal(bookingJobNumberCore("POOLTEST100"), "100");
  assert.equal(bookingJobNumbersEquivalent("P100", "100"), true);
  assert.equal(bookingJobNumbersEquivalent("P5556759 NEW", "5556759"), true);
  assert.equal(bookingJobNumbersEquivalent("P 5556759", "RF5556759"), true);
  assert.equal(bookingJobNumbersEquivalent("P5556759", "P5556760"), false);
  assert.equal(bookingJobNumbersEquivalent("JANE CUSTOMER", "JANE CUSTOMER"), true);
  assert.equal(bookingJobNumberKey("P5556759 VIP"), "core:5556759");
  assert.equal(bookingJobNumberKey("JANE CUSTOMER"), "job:JANE CUSTOMER");
});

test("Booking job filter: exact keys plus one anchored digit-core regex on the normalized index", () => {
  assert.deepEqual(bookingJobNumberFilter(["JANE CUSTOMER"]), { normalized_job_no: { $type: "string", $in: ["JANE CUSTOMER"] } });
  const filter = bookingJobNumberFilter(["P5556759", "5556760 NEW"]) as { $or: Array<{ normalized_job_no: Record<string, unknown> }> };
  assert.deepEqual(filter.$or[0]!.normalized_job_no.$in, ["P5556759", "5556760 NEW", "5556759", "5556760"]);
  const regex = new RegExp(String(filter.$or[1]!.normalized_job_no.$regex));
  for (const key of ["5556759", "P5556759", "RF5556760", "P 5556759", "P5556760 NEW", "JOB P5556759 VIP RIGOS"])
    assert.equal(regex.test(key), true, key);
  for (const key of ["15556759", "P55567590", "P5556761", "5556759A"]) assert.equal(regex.test(key), false, key);
});
