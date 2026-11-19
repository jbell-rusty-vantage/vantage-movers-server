import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
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

test("[AC-06] unsupported Booking Action is not upgraded or downgraded by Priority", () => {
  const actual = normalizeGranotReceipt(
    webhookReceipt("booking_status_changed", { event_type: "Released", priority: "1" }),
  );
  assert.equal(actual.normalization_result, "unsupported");
  assert.deepEqual(actual.issues.map((issue) => issue.code), ["unsupported_booking_action"]);
  assert.equal(actual.priority.valid, true);
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
