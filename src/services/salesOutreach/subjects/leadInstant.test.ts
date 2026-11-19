import assert from "node:assert/strict";
import { test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { leadInstant, leadTimestampConvention } from "./leadInstant";

const at = (iso: string) => new Date(iso);
const form = (timestamp: Date, ingestion_origin: string | null = "wordpress_form") => ({ timestamp, ingestion_origin });

test("S11-TIME: spring forward (2026-03-08): 02:30 never happens; read at UTC−5 (07:30Z = 03:30 EDT)", () => {
  assert.equal(leadInstant(form(at("2026-03-08T02:30:00.000Z"))).toISOString(), "2026-03-08T07:30:00.000Z");
  // Around the gap every stored wall clock maps back to its own instant.
  assert.equal(leadInstant(form(toFloridaTimestamp(at("2026-03-08T06:59:59.000Z")))).toISOString(), "2026-03-08T06:59:59.000Z", "01:59:59 EST");
  assert.equal(leadInstant(form(toFloridaTimestamp(at("2026-03-08T07:00:00.000Z")))).toISOString(), "2026-03-08T07:00:00.000Z", "03:00 EDT");
});

test("S11-TIME: fall back (2026-11-01): 01:30 happens twice; the first occurrence (EDT) is chosen", () => {
  const first = at("2026-11-01T05:30:00.000Z"), second = at("2026-11-01T06:30:00.000Z");
  assert.equal(toFloridaTimestamp(first).toISOString(), toFloridaTimestamp(second).toISOString(), "both store 01:30");
  assert.equal(leadInstant(form(toFloridaTimestamp(second))).toISOString(), first.toISOString());
  // Either side of the repeated hour is unambiguous.
  assert.equal(leadInstant(form(toFloridaTimestamp(at("2026-11-01T04:59:00.000Z")))).toISOString(), "2026-11-01T04:59:00.000Z", "00:59 EDT");
  assert.equal(leadInstant(form(toFloridaTimestamp(at("2026-11-01T07:00:00.000Z")))).toISOString(), "2026-11-01T07:00:00.000Z", "02:00 EST");
});

test("S11-TIME: a Granot-created Lead's timestamp is already an instant and passes through", () => {
  const captured = at("2026-07-15T14:00:00.123Z");
  assert.equal(leadTimestampConvention({ ingestion_origin: "granot_lead_created" }), "instant");
  assert.equal(leadInstant(form(captured, "granot_lead_created")), captured);
});

test("S11-TIME: a row that would arrive after its own creation is an instant (historical consolidation, schema default); live and imported rows are wall clock", () => {
  const instant = at("2025-03-04T15:12:00.000Z");
  const imported = { timestamp: instant, createdAt: instant, ingestion_origin: "legacy_unknown" };
  assert.equal(leadTimestampConvention(imported), "instant");
  assert.equal(leadInstant(imported), instant);
  const live = { timestamp: toFloridaTimestamp(instant), createdAt: new Date(+instant + 1_500), ingestion_origin: "legacy_unknown" };
  assert.equal(leadTimestampConvention(live), "wall_clock");
  assert.equal(leadInstant(live).toISOString(), instant.toISOString());
  // A default `Date.now` timestamp a few minutes before `createdAt`: read as wall clock it would arrive 4 h after creation.
  assert.equal(leadTimestampConvention({ timestamp: instant, createdAt: new Date(+instant + 7 * 60_000), ingestion_origin: "legacy_unknown" }), "instant");
  // A client clock 30 minutes ahead of the server is still a wall clock (inside the hour of slack).
  assert.equal(leadTimestampConvention({ timestamp: toFloridaTimestamp(new Date(+instant + 30 * 60_000)), createdAt: instant, ingestion_origin: "wordpress_form" }), "wall_clock");
  // An import long after the fact is a wall clock.
  assert.equal(leadTimestampConvention({ timestamp: toFloridaTimestamp(instant), createdAt: at("2026-06-01T00:00:00.000Z"), ingestion_origin: "best_relocation_sheet" }), "wall_clock");
});
