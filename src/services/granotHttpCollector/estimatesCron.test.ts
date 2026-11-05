import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatesCronDecision, estimatesDateWindow, estimatesDateChunks, granotCalendarEpoch, newYorkHour, estimatesLatestSlot, ESTIMATES_RUN_HOURS, estimatesSlotInstant, estimatesCoverageIsLate } from "./estimatesCron";
import { poolCronDuties, poolCronDecision, poolDiscoveryDateChunks, poolLatestSlot } from "./poolCron";

test("Pool has its own deterministic NY refresh and daily historical discovery slots", () => {
  const discovery = poolCronDecision(new Date('2026-10-14T10:00:00Z'));
  assert.ok(discovery.run);
  assert.equal(discovery.lane, 'pool_discovery');
  assert.deepEqual(discovery.dateWindow, { from:'01/01/2020', to:'10/14/2026' });
  const refresh = poolCronDecision(new Date('2026-10-14T12:00:00Z'));
  assert.ok(refresh.run);
  assert.equal(refresh.lane, 'pool_refresh');
  assert.deepEqual(refresh.dateWindow, estimatesDateWindow(new Date('2026-10-14T12:00:00Z')));
  const all = estimatesCronDecision(new Date('2026-10-14T12:00:00Z'));
  assert.ok(all.run);
  assert.notEqual(all.slotKey, refresh.slotKey);
  assert.equal(poolCronDecision(new Date('2026-10-14T11:00:00Z')).run, false);
  assert.equal(poolLatestSlot(new Date('2026-03-08T10:00:00Z'), 'pool_discovery').slotKey, '03/08/2026:6:pool_discovery');
  const chunks = poolDiscoveryDateChunks(discovery.dateWindow);
  assert.equal(chunks.length, 80);
  assert.equal(chunks[0]!.from, '01/01/2020');
  assert.equal(chunks.at(-1)!.to, '10/14/2026');
  for (let i=1;i<chunks.length;i++) assert.equal(granotCalendarEpoch(chunks[i]!.from)-granotCalendarEpoch(chunks[i-1]!.to),86400000);
});

test("the estimates cron retains historical slots and adds daytime hourly runs", () => {
  assert.equal(newYorkHour(new Date("2026-07-13T12:00:00.000Z")), 8);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T12:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-07-13T13:00:00.000Z")), 9);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T13:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-01-13T13:00:00.000Z")), 8);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T13:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-07-13T22:00:00.000Z")), 18);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T22:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-01-13T18:00:00.000Z")), 13);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T18:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-01-13T23:00:00.000Z")), 18);
  assert.equal(estimatesCronDecision(new Date("2026-01-13T23:00:00.000Z")).run, true);
});

test("every estimates run uses the trailing 90 Open Dates in New York", () => {
  assert.deepEqual(estimatesDateWindow(new Date("2026-07-13T12:00:00.000Z")), {
    from: "04/15/2026",
    to: "07/13/2026",
  });
  assert.deepEqual(estimatesDateWindow(new Date("2026-07-13T22:00:00.000Z")), {
    from: "04/15/2026",
    to: "07/13/2026",
  });
  assert.deepEqual(estimatesDateWindow(new Date("2026-01-13T13:00:00.000Z")), {
    from: "10/16/2025",
    to: "01/13/2026",
  });
  const yearBoundary = estimatesDateWindow(new Date("2026-01-01T13:00:00.000Z"));
  assert.deepEqual(yearBoundary, { from: "10/04/2025", to: "01/01/2026" });
});


test("cron retries share a slot identity, while the next scheduled hour gets a new identity", () => {
  const first = estimatesCronDecision(new Date("2026-10-13T12:00:00Z"));
  const retry = estimatesCronDecision(new Date("2026-10-13T12:59:59Z"));
  const next = estimatesCronDecision(new Date("2026-10-13T17:00:00Z"));
  assert.ok(first.run && retry.run && next.run);
  assert.equal(first.slotKey, retry.slotKey);
  assert.notEqual(first.slotKey, next.slotKey);
});

test("scheduled chunks cover every day exactly once across month/year and DST boundaries", () => {
  for (const now of ["2026-01-01T13:00:00Z", "2026-03-09T12:00:00Z", "2026-11-02T13:00:00Z"]) {
    const window = estimatesDateWindow(new Date(now));
    const chunks = estimatesDateChunks(window);
    assert.equal(chunks.length, 13);
    assert.equal(chunks[0]!.from, window.from);
    assert.equal(chunks.at(-1)!.to, window.to);
    let days = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const count = (granotCalendarEpoch(chunk.to) - granotCalendarEpoch(chunk.from)) / 86_400_000 + 1;
      assert.ok(count >= 1 && count <= 7);
      days += count;
      if (i) assert.equal(granotCalendarEpoch(chunk.from) - granotCalendarEpoch(chunks[i - 1]!.to), 86_400_000);
    }
    assert.equal(days, 90);
  }
  assert.throws(() => estimatesDateChunks({ from: "02/30/2026", to: "03/01/2026" }));
});

test("freshness uses the latest actual New York slot through overnight and DST transitions", () => {
  assert.deepEqual(estimatesLatestSlot(new Date("2026-03-08T11:59:00Z")), { slotKey: "03/08/2026:6", at: new Date("2026-03-08T10:00:00Z") });
  assert.deepEqual(estimatesLatestSlot(new Date("2026-03-08T12:00:00Z")), { slotKey: "03/08/2026:8", at: new Date("2026-03-08T12:00:00Z") });
  assert.deepEqual(estimatesLatestSlot(new Date("2026-11-01T06:30:00Z")), { slotKey: "11/01/2026:0", at: new Date("2026-11-01T04:00:00Z") });
});


test("exact ordinary, spring and fall local slots and independent 06:00 Pool duties", () => {
  for (const [start, end, count] of [
    ['2026-11-04T05:00:00Z', '2026-11-05T05:00:00Z', 18],
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 17],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 18],
  ] as const) {
    const slots: string[] = [], hours: number[] = [];
    for (let ms = +new Date(start); ms < +new Date(end); ms += 3600000) {
      const decision = estimatesCronDecision(new Date(ms));
      if (decision.run) { slots.push(decision.slotKey); hours.push(newYorkHour(new Date(ms))); assert.equal(+estimatesSlotInstant(decision.slotKey), ms); }
    }
    assert.equal(slots.length, count); assert.equal(new Set(slots).size, count);
    assert.deepEqual(hours, ESTIMATES_RUN_HOURS.filter(hour => count !== 17 || hour !== 2));
  }
  const at = new Date('2026-11-04T11:00:00Z');
  assert.equal(estimatesCronDecision(at).run, true);
  assert.deepEqual(poolCronDuties(at).map(d => d.lane), ['pool_refresh', 'pool_discovery']);
  assert.equal(poolLatestSlot(at, 'pool_refresh').slotKey, '11/04/2026:6:pool_refresh');
});

test("hourly misses remain late; later complete slots supersede old misses across calendar boundaries", () => {
  for (const now of ['2026-11-04T14:40:00Z', '2026-11-04T15:40:00Z']) {
    assert.equal(estimatesCoverageIsLate(new Date(now), null), true);
    assert.equal(estimatesCoverageIsLate(new Date(now), new Date('2026-11-04T11:00:00Z')), true);
    assert.equal(estimatesCoverageIsLate(new Date(now), new Date('2026-11-04T14:00:00Z')), false);
  }
  assert.equal(estimatesLatestSlot(new Date('2027-01-01T04:59:00Z')).slotKey, '12/31/2026:22');
  assert.equal(estimatesLatestSlot(new Date('2027-01-01T05:00:00Z')).slotKey, '01/01/2027:0');
  assert.equal(estimatesSlotInstant('10/14/2026:13').toISOString(), '2026-10-14T17:00:00.000Z');
  assert.equal(estimatesLatestSlot(new Date('2026-11-05T02:00:00Z')).slotKey, '11/04/2026:20');
});
