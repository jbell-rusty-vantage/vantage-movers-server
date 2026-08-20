import assert from "node:assert/strict";
import { test } from "node:test";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import {
  assertProjectionSafe,
  collectForbiddenProjectionKeys,
  compareTimelineEntries,
  dueWorkFilter,
  flagsToNamedBooleans,
  maskContactLabel,
  maskLifecycleContact,
  normalizeJobProjectionPath,
  paginateTimeline,
  rankBookingCandidateProjections,
  type GranotTimelineEntry,
} from "./projections";

test("[AC-35] Job path normalization rejects empty values", () => {
  assert.equal(normalizeJobProjectionPath("synthetic-job-100"), "SYNTHETIC JOB 100");
  assert.throws(
    () => normalizeJobProjectionPath("   "),
    (error: unknown) =>
      error instanceof Error && "code" in error &&
      (error as { code: string }).code === GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
  );
});

test("[AC-35] centralized list masking never returns raw contact", () => {
  assert.equal(maskContactLabel({ name: "Synthetic Person" }), "S•••");
  assert.equal(maskContactLabel({ phone_number: "5550001234" }), "•••1234");
  assert.equal(maskContactLabel({ email: "synthetic@example.invalid" }), "s•••@example.invalid");
});

test("[AC-23] candidate ranking pins the suggested Lead, then high confidence, and is stable", () => {
  const rows = [
    { id: "medium-first", confidence: "medium" as const, suggested: false },
    { id: "high-first", confidence: "high" as const, suggested: false },
    { id: "medium-second", confidence: "medium" as const, suggested: false },
    { id: "suggested", confidence: "medium" as const, suggested: true },
    { id: "high-second", confidence: "high" as const, suggested: false },
  ];
  assert.deepEqual(
    rankBookingCandidateProjections(rows).map((row) => row.id),
    ["suggested", "high-first", "high-second", "medium-first", "medium-second"],
  );
});

test("[AC-35] lifecycle detail contact projection masks every contact field", () => {
  const raw = {
    first_name: "Privacy",
    last_name: "Canary",
    phone_number: "+1 (212) 555-0199",
    email: "unit31-private-canary@example.invalid",
  };
  const projected = maskLifecycleContact(raw);
  assert.deepEqual(projected, {
    name: "P•••",
    phone_number: "•••0199",
    email: "u•••@example.invalid",
  });
  assert.equal(JSON.stringify(projected).includes("unit31-private-canary"), false);
});

test("[AC-20] [AC-36] [AC-40] timeline order is stable and evidence is not collapsed", () => {
  const entries: GranotTimelineEntry[] = [
    { id: "b", type: "booking_action", event_at: "2026-08-17T16:00:00.000Z", type_priority: 30, data: { observation_id: "obs-b", action: "booked" } },
    { id: "a", type: "booking_action", event_at: "2026-08-17T16:00:00.000Z", type_priority: 30, data: { observation_id: "obs-a", action: "release" } },
    { id: "obs", type: "observation", event_at: "2026-08-17T16:00:00.000Z", type_priority: 10, data: { observation_id: "obs", receipt_id: "receipt", normalization_result: "valid", issue_codes: [] } },
  ];
  assert.deepEqual([...entries].sort(compareTimelineEntries).map((entry) => entry.id), ["obs", "a", "b"]);
  const page = paginateTimeline({ items: entries, current: {}, capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true } }, { limit: 2 });
  assert.deepEqual(page.items.map((entry) => entry.id), ["obs", "a"]);
  assert.ok(page.next_cursor);
  const next = paginateTimeline({ items: entries, current: {}, capabilities: page.capabilities }, { limit: 2, cursor: page.next_cursor ?? undefined });
  assert.deepEqual(next.items.map((entry) => entry.id), ["b"]);
});

test("[AC-35] lifecycle DTO recursive guard rejects raw transport and credentials", () => {
  const safe = { items: [], next_cursor: null, current: {}, capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true } };
  assertProjectionSafe(safe);
  assert.deepEqual(collectForbiddenProjectionKeys({ ...safe, payload: { authorization: "redacted" } }).sort(), ["authorization", "payload"]);
});

test("[AC-31] health flag names match the ten centralized lifecycle flags and do not promote effects", () => {
  const flags = flagsToNamedBooleans(GRANOT_LIFECYCLE_FLAG_DEFAULTS);
  assert.equal(flags.GRANOT_LIFECYCLE_PROCESSING_ENABLED, true);
  assert.equal(flags.GRANOT_LIFECYCLE_SHADOW_MODE, true);
  assert.equal(flags.GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_EMAIL_ENABLED, false);
});

test("[AC-37] due work includes expired claims and excludes unexpired claimed leases", () => {
  const now = new Date("2026-08-19T16:00:00.000Z");
  const filter = dueWorkFilter(now);
  assert.deepEqual(filter["processing.state"], { $in: ["pending", "retry_scheduled", "claimed"] });
  assert.deepEqual(filter["processing.next_attempt_at"], { $lte: now });
  assert.deepEqual(filter.$or, [
    { "processing.state": { $ne: "claimed" } },
    { "processing.leased_until": { $lte: now } },
  ]);
});
