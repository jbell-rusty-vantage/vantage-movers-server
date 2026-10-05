import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { dailyOperationsLeadOf } from "../granotLifecycle/createLeadFromGranot";
import { buildDaySeed, easternDayKey, easternHour, seedHourlyBuckets } from "./dayDocument";
import { recordCallLeadDailyOperationsFact, recordFormLeadDailyOperationsFact, type LeadDailyOperationsSnapshot } from "./recordDomainFacts";
import { applyLeadRows, applyMessageRows, messageDayEvents, type RebuildLeadRow, type RebuildMessageRow } from "./rebuild";
import { clearCapturedDailyOperationsFacts, getCapturedDailyOperationsFacts, installTestDailyOperationsSink } from "./testDailyOperationsSink";

/**
 * SRV-9 (SPECIFICATION §14): live Daily Operations recording and the open-day rebuild agree.
 * (A) A Granot-created Lead records the canonical Lead fact after commit, and both paths place every Lead
 *     on the New York day/hour of its real arrival instant (wall-clock and instant `timestamp` conventions).
 * (B) A scheduled confirmation created overnight and sent the next day counts deferred on the accept day
 *     and successful on the send day in both paths; a sent one with no recorded send time is labelled.
 */

type LeadFixture = { id: string; kind: "form" | "call"; row: RebuildLeadRow; name: string };

const leads: LeadFixture[] = [
  // ET wall clock in a UTC Date: 01:30 ET on 2026-10-05 (live used to file it under the 4th).
  { id: "1".repeat(24), kind: "form", name: "wall-clock night", row: { timestamp: new Date("2026-10-05T01:30:00.000Z"), createdAt: new Date("2026-10-05T05:30:02.000Z"), ingestion_origin: "wordpress_form" } },
  // Granot-created: real instant 22:00 EDT on the 5th (= 02:00Z on the 6th; rebuild used to file it under the 6th).
  { id: "2".repeat(24), kind: "form", name: "granot evening", row: { timestamp: new Date("2026-10-06T02:00:00.000Z"), createdAt: new Date("2026-10-06T02:00:01.000Z"), ingestion_origin: "granot_lead_created" } },
  { id: "3".repeat(24), kind: "call", name: "granot call", row: { timestamp: new Date("2026-10-05T15:10:00.000Z"), createdAt: new Date("2026-10-05T15:10:01.000Z"), ingestion_origin: "granot_lead_created" } },
  { id: "4".repeat(24), kind: "form", name: "duplicate", row: { timestamp: new Date("2026-10-05T09:00:00.000Z"), createdAt: new Date("2026-10-05T13:00:01.000Z"), ingestion_origin: "wordpress_form", duplicate: true } },
  { id: "5".repeat(24), kind: "call", name: "unmatched", row: { timestamp: new Date("2026-10-05T10:00:00.000Z"), createdAt: new Date("2026-10-05T14:00:01.000Z"), ingestion_origin: "ringcentral", created_on_unmatched: true } },
  // ET wall clock 23:30 on the 5th (stored 23:30Z): still the 5th.
  { id: "6".repeat(24), kind: "call", name: "late evening wall clock", row: { timestamp: new Date("2026-10-05T23:30:00.000Z"), createdAt: new Date("2026-10-06T03:30:01.000Z"), ingestion_origin: "ringcentral" } },
];

async function liveFacts() {
  installTestDailyOperationsSink();
  clearCapturedDailyOperationsFacts();
  for (const lead of leads) {
    const snapshot = { lead: { _id: { toString: () => lead.id }, ...lead.row } as LeadDailyOperationsSnapshot["lead"] };
    if (lead.kind === "form") await recordFormLeadDailyOperationsFact(snapshot);
    else await recordCallLeadDailyOperationsFact(snapshot);
  }
  return getCapturedDailyOperationsFacts().map((f) => f.input);
}

test("SRV-9 (A): live Lead facts and the rebuild agree on day, hour and classification for both timestamp conventions", async () => {
  const facts = await liveFacts();
  // Live: tally the 2026-10-05 Lead facts the way the day document would.
  const live = { total: 0, form: 0, call: 0, duplicate_form: 0, unmatched_call: 0, hours: new Map<number, number>() };
  for (const fact of facts) {
    if (!fact.occurred_at || easternDayKey(fact.occurred_at) !== "2026-10-05") continue;
    if (fact.kind === "form_lead.created" || fact.kind === "call_lead.created") {
      live.total++;
      live[fact.kind === "form_lead.created" ? "form" : "call"]++;
      const hour = easternHour(fact.occurred_at);
      live.hours.set(hour, (live.hours.get(hour) ?? 0) + 1);
    }
    if (fact.kind === "form_lead.duplicate") live.duplicate_form++;
    if (fact.kind === "call_lead.unmatched") live.unmatched_call++;
  }
  // Rebuild over the same rows (the scan range is a superset; the instant rule picks the day).
  const seed = buildDaySeed("2026-10-05");
  const hourly = seedHourlyBuckets();
  applyLeadRows("2026-10-05", seed, hourly, { form: leads.filter((l) => l.kind === "form").map((l) => l.row), call: leads.filter((l) => l.kind === "call").map((l) => l.row) });
  const rebuiltHours = new Map(hourly.filter((h) => h.leads > 0).map((h) => [h.hour, h.leads]));
  assert.deepEqual(
    [seed.leads.total, seed.leads.form, seed.leads.call, seed.leads.duplicate_form, seed.leads.unmatched_call],
    [live.total, live.form, live.call, live.duplicate_form, live.unmatched_call],
  );
  assert.deepEqual(rebuiltHours, live.hours);
  assert.deepEqual([...live.hours.entries()].sort((a, b) => a[0] - b[0]), [[1, 1], [11, 1], [22, 1], [23, 1]], "01:30 wall clock, 11:10 and 22:00 Granot instants, 23:30 wall clock");
  assert.equal(seed.origins.granot_lead_created, 2);
  // The next day's rebuild does not count the Granot evening Lead again.
  const next = buildDaySeed("2026-10-06");
  applyLeadRows("2026-10-06", next, seedHourlyBuckets(), { form: leads.filter((l) => l.kind === "form").map((l) => l.row), call: [] });
  assert.equal(next.leads.total, 0);
});

test("SRV-9 (A): createLeadFromGranot records the canonical Lead fact once, after granot.minted, from the created Lead", async () => {
  const source = await readFile(path.join(__dirname, "../granotLifecycle/createLeadFromGranot.ts"), "utf8");
  const start = source.indexOf("finalize: async (pending)");
  const body = source.slice(start, source.indexOf("return {", start));
  const minted = body.indexOf("recordGranotMintedDailyOperationsFact");
  assert.ok(minted > 0 && body.indexOf("recordFormLeadDailyOperationsFact") > minted && body.indexOf("recordCallLeadDailyOperationsFact") > minted);
  assert.equal(body.match(/recordFormLeadDailyOperationsFact\(/g)?.length, 1);
  assert.equal(body.match(/recordCallLeadDailyOperationsFact\(/g)?.length, 1);
  const lead = dailyOperationsLeadOf({ _id: "7".repeat(24), timestamp: new Date("2026-10-06T02:00:00.000Z"), ingestion_origin: "granot_lead_created", name: "Synthetic", job_no: "P1" });
  installTestDailyOperationsSink();
  clearCapturedDailyOperationsFacts();
  await recordFormLeadDailyOperationsFact({ source_company: "vantage", lead });
  const [fact] = getCapturedDailyOperationsFacts();
  assert.deepEqual([fact?.input.kind, fact?.input.dedupe_key, fact?.input.occurred_at && easternDayKey(fact.input.occurred_at)], [
    "form_lead.created",
    `form_lead:${"7".repeat(24)}:created`,
    "2026-10-05",
  ]);
});

const at = (iso: string) => new Date(iso);
const scheduledOvernight: RebuildMessageRow = {
  status: "delivered",
  provider_status: "delivered",
  createdAt: at("2026-10-05T06:14:00.000Z"), // 02:14 ET
  accepted_at: at("2026-10-05T06:14:01.000Z"),
  sent_at: at("2026-10-05T12:00:00.000Z"), // callback 08:00 ET (the next morning's send)
  delivered_at: at("2026-10-05T12:00:05.000Z"),
  status_history: [
    { status: "scheduled", received_at: at("2026-10-05T06:14:01.000Z") },
    { status: "sent", received_at: at("2026-10-05T12:00:00.000Z") },
    { status: "delivered", received_at: at("2026-10-05T12:00:05.000Z") },
  ],
};

test("SRV-9 (B): an overnight scheduled confirmation is deferred on its accept day and successful on its send day, in live and rebuild alike", () => {
  // Created/accepted 23:50 ET on the 4th, sent 08:00 ET on the 5th.
  const overnight: RebuildMessageRow = {
    ...scheduledOvernight,
    createdAt: at("2026-10-05T03:50:00.000Z"),
    accepted_at: at("2026-10-05T03:50:01.000Z"),
    status_history: [{ status: "scheduled", received_at: at("2026-10-05T03:50:01.000Z") }, ...scheduledOvernight.status_history!.slice(1)],
  };
  const immediate: RebuildMessageRow = { status: "sent", provider_status: "sent", createdAt: at("2026-10-05T14:00:00.000Z"), accepted_at: at("2026-10-05T14:00:01.000Z"), sent_at: at("2026-10-05T14:00:01.000Z"), status_history: [{ status: "sent", received_at: at("2026-10-05T14:00:01.000Z") }] };
  const unrecorded: RebuildMessageRow = { status: "sent", provider_status: "sent", createdAt: at("2026-10-05T05:00:00.000Z"), accepted_at: at("2026-10-05T05:00:01.000Z"), status_history: [{ status: "scheduled", received_at: at("2026-10-05T05:00:01.000Z") }] };
  // Live: Twilio accept records `text.deferred` (scheduled) or `text.sent` at accept; the first sent/delivered
  // callback records `text.sent` at callback time (dedupe key message:<id>:successful).
  const liveDay = (rows: RebuildMessageRow[], day: string) => {
    const out = { deferred: 0, successful: 0 };
    for (const r of rows) {
      const scheduled = r.status_history?.some((h) => h.status === "scheduled");
      if (scheduled && easternDayKey(r.accepted_at!) === day) out.deferred++;
      const success = scheduled ? r.status_history?.find((h) => h.status === "sent" || h.status === "delivered")?.received_at : r.accepted_at;
      if (success && easternDayKey(success) === day) out.successful++;
    }
    return out;
  };
  const rows = [overnight, immediate, unrecorded];
  for (const day of ["2026-10-04", "2026-10-05"]) {
    const seed = buildDaySeed(day);
    const hourly = seedHourlyBuckets();
    applyMessageRows(day, seed, hourly, rows);
    assert.deepEqual({ deferred: seed.messages.deferred, successful: seed.messages.successful }, liveDay(rows, day), day);
    if (day === "2026-10-05") {
      assert.equal(hourly[8]!.messages, 1, "the overnight send counts in the 08:00 hour");
      assert.equal(seed.messages.unreconstructable_sent_day, 1, "a sent scheduled message with no recorded send time is labelled, not moved");
    }
  }
  assert.deepEqual(messageDayEvents(scheduledOvernight), {
    deferred: scheduledOvernight.accepted_at,
    successful: at("2026-10-05T12:00:00.000Z"),
  });
  assert.deepEqual(messageDayEvents({ status: "skipped", createdAt: at("2026-10-05T12:00:00.000Z") }), { skipped: at("2026-10-05T12:00:00.000Z") });
});
