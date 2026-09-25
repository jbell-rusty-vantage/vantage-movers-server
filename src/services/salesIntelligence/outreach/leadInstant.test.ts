import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { leadReceivedSource } from "../story/sources";
import { leadInstant, leadTimestampConvention, wallClockToInstant } from "./leadInstant";

const at = (iso: string) => new Date(iso);
const form = (timestamp: Date, ingestion_origin: string | null = "wordpress_form") => ({ timestamp, ingestion_origin });

test("S11-TIME: a Form Lead received at 10:00 ET in EST is the instant 15:00Z", () => {
  const stored = toFloridaTimestamp(at("2026-01-15T15:00:00.000Z"));
  assert.equal(stored.toISOString(), "2026-01-15T10:00:00.000Z", "stored as ET wall clock");
  assert.equal(leadInstant(form(stored)).toISOString(), "2026-01-15T15:00:00.000Z");
});

test("S11-TIME: a Form Lead received at 10:00 ET in EDT is the instant 14:00Z", () => {
  const stored = toFloridaTimestamp(at("2026-07-15T14:00:00.000Z"));
  assert.equal(stored.toISOString(), "2026-07-15T10:00:00.000Z");
  assert.equal(leadInstant(form(stored)).toISOString(), "2026-07-15T14:00:00.000Z");
});

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

test("S11-TIME: a RingCentral Call Lead and every other origin (and none) are wall clock; milliseconds kept", () => {
  const started = at("2026-09-24T18:41:07.456Z");
  for (const origin of ["ringcentral", "best_relocation_sheet", "vantage_admin", "legacy_import", "legacy_unknown", null]) {
    assert.equal(leadTimestampConvention({ ingestion_origin: origin }), "wall_clock", String(origin));
    assert.equal(leadInstant({ timestamp: toFloridaTimestamp(started), ingestion_origin: origin }).toISOString(), started.toISOString(), String(origin));
  }
});

test("S11-TIME: round trip over a year, every 37 minutes, except the second pass of the fall-back hour", () => {
  let checked = 0;
  for (let t = Date.parse("2026-01-01T00:00:00Z"); t < Date.parse("2027-01-01T00:00:00Z"); t += 37 * 60_000) {
    const real = new Date(t), back = wallClockToInstant(toFloridaTimestamp(real));
    const secondPass = t >= Date.parse("2026-11-01T06:00:00Z") && t < Date.parse("2026-11-01T07:00:00Z");
    assert.equal(+back, secondPass ? t - 3_600_000 : t, real.toISOString());
    checked++;
  }
  assert.ok(checked > 14_000);
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

test("S11-TIME: a missing or invalid timestamp is null", () => {
  assert.equal(leadInstant({ timestamp: null }), null);
  assert.equal(leadInstant({ timestamp: new Date(Number.NaN) }), null);
});

test("S11-TIME (TL-AUDIT N1): the Owner timeline's lead_received is the real instant; a Granot Lead is unchanged", async () => {
  const received = at("2026-09-22T14:05:00.000Z");
  const leads = [
    { _id: new Types.ObjectId(), model: "FormLead" as const, timestamp: toFloridaTimestamp(received), createdAt: at("2026-09-22T14:05:02.000Z"), ingestion_origin: "wordpress_form" },
    { _id: new Types.ObjectId(), model: "CallLead" as const, timestamp: received, createdAt: at("2026-09-22T14:05:03.000Z"), ingestion_origin: "granot_lead_created" },
  ];
  const lead_refs = leads.map(l => ({ model: l.model, id: String(l._id) }));
  const subject = { contact_number_id: null, e164: null, lead_refs, outreach_record_ids: [], conversation_ids: [], as_of: at("2026-09-23T00:00:00.000Z") };
  const timeline = { scope: "outreach" as const, after: null, kinds: null, subject_keys: [], records: [], lead_refs, leads: leads as never };
  const { events } = await leadReceivedSource(subject, 10, { timeline });
  const byId = new Map(events.filter(e => e.kind === "lead_received").map(e => [(e.detail as { lead_ref: { id: string } }).lead_ref.id, e.happened_at]));
  assert.equal(byId.get(String(leads[0]!._id)), "2026-09-22T14:05:00.000Z", "ingested Form Lead: the instant, not the 10:05Z wall clock");
  assert.equal(byId.get(String(leads[1]!._id)), "2026-09-22T14:05:00.000Z", "Granot Lead: its timestamp");
});
