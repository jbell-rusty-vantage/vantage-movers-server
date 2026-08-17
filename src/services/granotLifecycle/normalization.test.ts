import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  NORMALIZATION_FIELD_BOUNDS,
  PRIORITY_BROAD_ENRICHMENT_CANONICALS,
  VANTAGE_BUSINESS_TIMEZONE,
  calendarDateInBusinessTimezone,
  normalizeGranotReceipt,
  type NormalizationReceiptInput,
} from "./normalization";
import { normalizationFixtures } from "./testSupport/fixtures";
import type { NormalizationFixture } from "./testSupport/normalizationFixture";

const capturedAt = new Date("2026-08-17T16:00:00.000Z");

function receiptFromFixture(fixture: NormalizationFixture): NormalizationReceiptInput {
  return {
    _id: new mongoose.Types.ObjectId(),
    observation_channel: fixture.channel,
    captured_at: capturedAt,
    route_event_class:
      fixture.channel === "granot_webhook" ? fixture.route_event_class : undefined,
    channel_operation_kind:
      fixture.channel === "granot_webhook" ? undefined : fixture.operation_kind,
    channel_operation_id:
      fixture.channel === "granot_webhook" ? undefined : fixture.operation_id,
    payload: fixture.input.value,
  };
}

function webhookReceipt(
  route: NormalizationReceiptInput["route_event_class"],
  payload: unknown,
): NormalizationReceiptInput {
  return {
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    route_event_class: route,
    payload,
  };
}

function extensionReceipt(
  operation: NormalizationReceiptInput["channel_operation_kind"],
  payload: unknown,
): NormalizationReceiptInput {
  return {
    observation_channel: "browser_extension",
    captured_at: capturedAt,
    channel_operation_kind: operation,
    channel_operation_id: "77777777-7777-4777-8777-777777777777",
    payload,
  };
}

test("[AC-05][AC-06][AC-25][AC-29] every Unit 01 fixture produces the expected normalized facts", () => {
  for (const fixture of normalizationFixtures) {
    const actual = normalizeGranotReceipt(receiptFromFixture(fixture));
    assert.equal(
      actual.kind,
      fixture.expected.observation_kind,
      fixture.fixture_id,
    );
    assert.equal(
      actual.normalization_result,
      fixture.expected.normalization_result,
      fixture.fixture_id,
    );
    assert.deepEqual(
      actual.issues.map((issue) => issue.code),
      fixture.expected.issue_codes,
      fixture.fixture_id,
    );
    if (fixture.expected.priority) {
      assert.equal(actual.priority.valid, fixture.expected.priority.valid, fixture.fixture_id);
      if ("raw" in fixture.expected.priority) {
        assert.deepEqual(actual.priority.raw, fixture.expected.priority.raw, fixture.fixture_id);
      }
      if ("canonical" in fixture.expected.priority) {
        assert.equal(
          actual.priority.canonical,
          fixture.expected.priority.canonical,
          fixture.fixture_id,
        );
      }
    }
    if (fixture.expected.booking_action) {
      assert.equal(
        actual.booking_action.raw,
        fixture.expected.booking_action.raw,
        fixture.fixture_id,
      );
      assert.equal(
        actual.booking_action.normalized,
        fixture.expected.booking_action.normalized,
        fixture.fixture_id,
      );
    }
    if (fixture.expected.source_label) {
      assert.equal(
        actual.source_label_raw,
        fixture.expected.source_label.raw,
        fixture.fixture_id,
      );
      assert.equal(
        actual.normalized_source_label,
        fixture.expected.source_label.normalized,
        fixture.fixture_id,
      );
    }
    if (fixture.expected.identity) {
      assert.equal(
        actual.identity.job_no_raw,
        fixture.expected.identity.job_no_raw,
        fixture.fixture_id,
      );
      assert.equal(
        actual.identity.normalized_job_no,
        fixture.expected.identity.normalized_job_no,
        fixture.fixture_id,
      );
      assert.equal(
        actual.identity.form_ref_raw,
        fixture.expected.identity.form_ref_raw,
        fixture.fixture_id,
      );
      assert.equal(
        actual.identity.normalized_form_ref,
        fixture.expected.identity.normalized_form_ref,
        fixture.fixture_id,
      );
    }
    if (fixture.expected.provider_context) {
      assert.equal(
        actual.provider_context.type_raw,
        fixture.expected.provider_context.type_raw,
        fixture.fixture_id,
      );
    }
    assert.equal("quoted" in actual, false, fixture.fixture_id);
    assert.equal("granot_crm_source_id" in actual, false, fixture.fixture_id);
  }
});

test("[AC-05] Priority 0, 1, 5, 8, 05, all-zero, and 12-digit retain raw/canonical/valid without enrichment", () => {
  const cases: Array<{ raw: unknown; canonical: string }> = [
    { raw: 0, canonical: "0" },
    { raw: "1", canonical: "1" },
    { raw: 5, canonical: "5" },
    { raw: "8", canonical: "8" },
    { raw: "05", canonical: "5" },
    { raw: "000", canonical: "0" },
    { raw: "123456789012", canonical: "123456789012" },
  ];
  for (const entry of cases) {
    const actual = normalizeGranotReceipt(
      webhookReceipt("priority_updated", {
        event_type: "priority_updated",
        priority: entry.raw,
      }),
    );
    assert.equal(actual.priority.valid, true);
    assert.equal(actual.priority.raw, entry.raw);
    assert.equal(actual.priority.canonical, entry.canonical);
    assert.equal(actual.normalization_result, "valid");
    assert.equal("quoted" in actual, false);
    assert.deepEqual([...PRIORITY_BROAD_ENRICHMENT_CANONICALS], ["1", "5"]);
  }
});

test("[AC-06] missing or malformed Priority invalidates Priority Update only", () => {
  const missing = normalizeGranotReceipt(
    webhookReceipt("priority_updated", { event_type: "priority_update" }),
  );
  assert.equal(missing.normalization_result, "invalid");
  assert.deepEqual(missing.issues.map((issue) => issue.code), ["invalid_priority"]);
  assert.equal(missing.priority.valid, false);

  const malformedUpdate = normalizeGranotReceipt(
    webhookReceipt("priority_updated", {
      event_type: "priority_updated",
      priority: "invalid-priority",
    }),
  );
  assert.equal(malformedUpdate.normalization_result, "invalid");
  assert.equal(malformedUpdate.priority.valid, false);

  const leadCreated = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      priority: "invalid-priority",
    }),
  );
  assert.equal(leadCreated.normalization_result, "valid_with_issues");
  assert.equal(leadCreated.kind, "lead_snapshot");
  assert.deepEqual(leadCreated.issues.map((issue) => issue.code), ["invalid_priority"]);

  const booked = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", { event_type: "Booked", priority: "5.0" }),
  );
  assert.equal(booked.normalization_result, "valid_with_issues");
  assert.equal(booked.booking_action.normalized, "booked");
});

test("[AC-25] exact Booked, Releas, and Release aliases normalize; Released and prefixes do not", () => {
  assert.equal(
    normalizeGranotReceipt(webhookReceipt("booking_status_changed", { event_type: "Booked" }))
      .booking_action.normalized,
    "booked",
  );
  assert.equal(
    normalizeGranotReceipt(webhookReceipt("booking_status_changed", { event_type: "bOoKeD" }))
      .booking_action.normalized,
    "booked",
  );
  assert.equal(
    normalizeGranotReceipt(webhookReceipt("booking_status_changed", { event_type: "Releas" }))
      .booking_action.normalized,
    "release",
  );
  assert.equal(
    normalizeGranotReceipt(webhookReceipt("booking_status_changed", { event_type: "Release" }))
      .booking_action.normalized,
    "release",
  );
  const released = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", { event_type: "Released" }),
  );
  assert.equal(released.normalization_result, "unsupported");
  assert.deepEqual(released.issues.map((issue) => issue.code), ["unsupported_booking_action"]);
  assert.equal(released.booking_action.normalized, undefined);
  const prefix = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", { event_type: "Rel" }),
  );
  assert.equal(prefix.normalization_result, "unsupported");
  assert.equal(prefix.booking_action.normalized, undefined);
});

test("[AC-29] type=AUTO stays provider context and does not supply source classification", () => {
  const actual = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      type: "AUTO",
      label: "Paid Overflow",
    }),
  );
  assert.equal(actual.provider_context.type_raw, "AUTO");
  assert.equal(actual.source_label_raw, "Paid Overflow");
  assert.equal(actual.normalized_source_label, "paid overflow");
  assert.equal("granot_crm_source_id" in actual, false);
  const autoLabel = normalizeGranotReceipt(
    extensionReceipt("lead_snapshot_apply", { label: "Auto", type: "AUTO" }),
  );
  assert.equal(autoLabel.normalized_source_label, "auto");
  assert.equal(autoLabel.provider_context.type_raw, "AUTO");
});

test("[AC-05] webhook, extension, and automation parity fixtures share normalized business fields", () => {
  const lead = normalizationFixtures.filter((fixture) =>
    fixture.fixture_id.startsWith("synthetic_ac05_lead_parity_"),
  );
  const booking = normalizationFixtures.filter((fixture) =>
    fixture.fixture_id.startsWith("synthetic_ac06_booking_parity_"),
  );
  assert.equal(lead.length, 3);
  assert.equal(booking.length, 3);
  const leadResults = lead.map((fixture) => normalizeGranotReceipt(receiptFromFixture(fixture)));
  const bookingResults = booking.map((fixture) =>
    normalizeGranotReceipt(receiptFromFixture(fixture)),
  );
  for (const actual of leadResults.slice(1)) {
    assert.equal(actual.kind, leadResults[0]?.kind);
    assert.equal(actual.normalization_result, leadResults[0]?.normalization_result);
    assert.deepEqual(actual.priority, leadResults[0]?.priority);
    assert.equal(actual.normalized_source_label, leadResults[0]?.normalized_source_label);
    assert.deepEqual(actual.identity, leadResults[0]?.identity);
    assert.deepEqual(actual.contact, leadResults[0]?.contact);
  }
  for (const actual of bookingResults.slice(1)) {
    assert.equal(actual.kind, bookingResults[0]?.kind);
    assert.equal(actual.booking_action.normalized, bookingResults[0]?.booking_action.normalized);
    assert.deepEqual(actual.priority, bookingResults[0]?.priority);
    assert.deepEqual(actual.identity, bookingResults[0]?.identity);
  }
});

test("[AC-06] lead_created payload event type is accepted case-insensitively", () => {
  const actual = normalizeGranotReceipt(
    webhookReceipt("lead_created", { event_type: "LEAD_CREATED", priority: "1" }),
  );
  assert.equal(actual.normalization_result, "valid");
  assert.equal(actual.payload_event_type_raw, "LEAD_CREATED");
  assert.deepEqual(actual.issues, []);
});

test("[AC-06] non-object payload and route/event conflicts persist as terminal invalid vocabulary", () => {
  const arrayPayload = normalizeGranotReceipt(webhookReceipt("lead_created", ["not-an-object"]));
  assert.equal(arrayPayload.normalization_result, "invalid");
  assert.deepEqual(arrayPayload.issues.map((issue) => issue.code), ["payload_not_object"]);

  const missingEvent = normalizeGranotReceipt(webhookReceipt("lead_created", { priority: "1" }));
  assert.equal(missingEvent.normalization_result, "valid_with_issues");
  assert.deepEqual(missingEvent.issues.map((issue) => issue.code), ["missing_payload_event_type"]);

  const conflict = normalizeGranotReceipt(
    webhookReceipt("lead_created", { event_type: "priority_updated", priority: "1" }),
  );
  assert.equal(conflict.normalization_result, "invalid");
  assert.deepEqual(conflict.issues.map((issue) => issue.code), ["route_payload_event_conflict"]);
  assert.equal(conflict.priority.valid, true);

  const snapshotBooked = normalizeGranotReceipt(
    extensionReceipt("lead_snapshot_apply", { event_type: "Booked", priority: "1" }),
  );
  assert.equal(snapshotBooked.normalization_result, "invalid");
  assert.deepEqual(snapshotBooked.issues.map((issue) => issue.code), [
    "route_payload_event_conflict",
  ]);
  assert.equal(snapshotBooked.kind, "lead_snapshot");
});

test("[AC-06] unsupported Booking Action is not upgraded or downgraded by Priority", () => {
  const actual = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", { event_type: "Released", priority: "1" }),
  );
  assert.equal(actual.normalization_result, "unsupported");
  assert.deepEqual(actual.issues.map((issue) => issue.code), ["unsupported_booking_action"]);
  assert.equal(actual.priority.valid, true);
});

test("[AC-05][AC-29] source, identity, contact, move, money, and agent rules cover NFKC, bounds, and invalid dates", () => {
  const nfkc = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      label: "  Synthetic\u00a0Forms  ",
    }),
  );
  assert.equal(nfkc.normalized_source_label, "synthetic forms");

  const control = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      label: "Synthetic\u0001Forms",
    }),
  );
  assert.equal(control.normalization_result, "valid_with_issues");
  assert.ok(control.issues.some((issue) => issue.code === "invalid_source_label"));
  assert.equal(control.normalized_source_label, undefined);

  const bidi = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      label: "Synthetic\u202eForms",
    }),
  );
  assert.ok(bidi.issues.some((issue) => issue.code === "invalid_source_label"));

  const overBound = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      label: "S".repeat(NORMALIZATION_FIELD_BOUNDS.source_label + 1),
    }),
  );
  assert.ok(overBound.issues.some((issue) => issue.code === "invalid_source_label"));
  assert.equal(overBound.normalized_source_label, undefined);
  assert.equal(overBound.source_label_raw?.length, NORMALIZATION_FIELD_BOUNDS.source_label);

  const objectJob = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      job_no: { nested: true },
    }),
  );
  assert.equal(objectJob.identity.normalized_job_no, undefined);
  assert.equal(objectJob.identity.job_no_raw, undefined);

  const impossible = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      move_date: "02/30/2026",
    }),
  );
  assert.ok(impossible.issues.some((issue) => issue.code === "invalid_move_date"));
  assert.equal(impossible.move.move_date, undefined);

  const validDate = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      move_date: "03/08/2026",
    }),
  );
  assert.ok(validDate.move.move_date);
  assert.equal(VANTAGE_BUSINESS_TIMEZONE, "America/New_York");
  const stored = calendarDateInBusinessTimezone(2026, 3, 8);
  assert.ok(stored);
  assert.equal(validDate.move.move_date?.toISOString(), stored.toISOString());

  const money = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", {
      event_type: "Booked",
      estimate: "2400.00",
      payment: "-1",
    }),
  );
  assert.equal(money.display_money.estimate?.canonical, "2400.00");
  assert.ok(money.issues.some((issue) => issue.code === "invalid_money"));
  assert.equal(money.display_money.payment?.canonical, undefined);

  const state = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      from_state: "Alabama",
      from_city: "Synthetic City",
    }),
  );
  assert.ok(state.issues.some((issue) => issue.code === "invalid_state"));
  assert.equal(state.move.origin?.state, undefined);
  assert.equal(state.move.origin?.city, "Synthetic City");

  const agent = normalizeGranotReceipt(
    webhookReceipt("lead_created", {
      event_type: "lead_created",
      user: "Fixture Operator",
      rep: "Fixture Operator",
    }),
  );
  assert.equal(agent.agent_identity.user_raw, "Fixture Operator");
  assert.equal(agent.agent_identity.rep_raw, "Fixture Operator");
  assert.ok(!agent.issues.some((issue) => issue.code === "granot_agent_identity_conflict"));
});

test("[AC-05] display money never becomes domain command input", () => {
  const actual = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", {
      event_type: "Booked",
      estimate: "100.5",
      payment: "10.00",
      balance: "90.50",
    }),
  );
  assert.equal(actual.display_money.estimate?.canonical, "100.5");
  assert.equal(actual.display_money.payment?.canonical, "10.00");
  assert.equal(actual.display_money.balance?.canonical, "90.50");
  const json = actual as unknown as Record<string, unknown>;
  assert.equal("binder" in json, false);
  assert.equal("deposit" in json, false);
  assert.equal("refund" in json, false);
});
