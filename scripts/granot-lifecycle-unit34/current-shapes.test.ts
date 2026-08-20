import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  normalizeGranotReceipt,
  type NormalizationReceiptInput,
} from "../../src/services/granotLifecycle/normalization";
import type { GranotRouteEventClass } from "../../src/services/granotLifecycle/types";
import {
  scanSanitizedPayloads,
  type JsonValue,
  type SanitizedPayloadFamily,
} from "./sanitizer";

const routeClasses = new Set<GranotRouteEventClass>([
  "lead_created",
  "priority_updated",
  "booking_status_changed",
]);
const supportedRouteClasses = [...routeClasses];

function readFamilies(): SanitizedPayloadFamily[] {
  try {
    const inputPath = process.env.GRANOT_UNIT34_SANITIZED_INPUT_FILE?.trim();
    if (!inputPath || !path.isAbsolute(inputPath)) throw new Error("missing input");
    const parsed: unknown = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("invalid input");
    return parsed as SanitizedPayloadFamily[];
  } catch {
    throw new Error("UNIT-34 could not read the approved sanitized derivative");
  }
}

function assertNoInternalInjection(value: unknown): void {
  const forbidden = new Set([
    "actor",
    "initiator",
    "source_scope",
    "official_booking",
    "official_cancellation",
    "command",
    "headers",
    "raw_headers",
    "payload",
  ]);
  const walk = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      candidate.forEach(walk);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      assert.equal(forbidden.has(key.toLowerCase()), false);
      walk(nested);
    }
  };
  walk(value);
}

test("[UNIT-34][AC-01][AC-05][AC-06][AC-25][AC-29][AC-35] approved current shapes normalize safely", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_UNIT34_TESTS !== "true") {
    t.skip("Current-shape certification is opt-in through the guarded Unit 34 runner.");
    return;
  }

  const families = readFamilies();
  assert.ok(families.length > 0);
  for (const [familyIndex, family] of families.entries()) {
    await t.test(`current_shape_${String(familyIndex + 1).padStart(3, "0")}`, () => {
      assert.equal(family.schema_version, 1);
      assert.match(family.schema_fingerprint, /^[a-f\d]{64}$/);
      assert.equal(family.occurrence_count, family.sanitized_payloads.length);
      assert.ok(family.sanitized_payloads.length > 0);
      assert.equal(scanSanitizedPayloads(family.sanitized_payloads).length, 0);
      const routesToExercise =
        typeof family.route_event_class === "string" &&
        routeClasses.has(family.route_event_class as GranotRouteEventClass)
          ? [family.route_event_class as GranotRouteEventClass]
          : supportedRouteClasses;

      if (family.route_event_class === null) {
        assert.ok(
          family.sanitized_payloads.every(
            (payload) =>
              payload !== null &&
              !Array.isArray(payload) &&
              typeof payload === "object" &&
              Object.keys(payload).length === 0,
          ),
          "Only an empty current payload family may lack route metadata",
        );
      }

      for (const payload of family.sanitized_payloads) {
        for (const routeEventClass of routesToExercise) {
          const receipt: NormalizationReceiptInput = {
            observation_channel: "granot_webhook",
            route_event_class: routeEventClass,
            captured_at: new Date("2030-01-15T12:00:00.000Z"),
            payload: payload as JsonValue,
          };
          const normalized = normalizeGranotReceipt(receipt);
          assert.ok(["valid", "valid_with_issues", "invalid", "unsupported"].includes(
            normalized.normalization_result,
          ));
          if (family.route_event_class === null) {
            assert.deepEqual(normalized.identity, {});
            assert.deepEqual(normalized.contact, {});
            assert.deepEqual(normalized.move, {});
            assert.equal(
              normalized.normalization_result,
              routeEventClass === "lead_created"
                ? "valid_with_issues"
                : routeEventClass === "priority_updated"
                  ? "invalid"
                  : "unsupported",
            );
          }
          assertNoInternalInjection(normalized);
        }
      }
    });
  }
});
