import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatesCronDecision, estimatesDateWindow, estimatesDateChunks, granotCalendarEpoch, newYorkHour, estimatesLatestSlot } from "./estimatesCron";
import { poolCronDecision, poolDiscoveryDateChunks, poolLatestSlot } from "./poolCron";

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

test("the estimates cron runs at 08:00, 13:00, and 18:00 New York, including across daylight saving", () => {
  assert.equal(newYorkHour(new Date("2026-07-13T12:00:00.000Z")), 8);
  assert.equal(estimatesCronDecision(new Date("2026-07-13T12:00:00.000Z")).run, true);
  assert.equal(newYorkHour(new Date("2026-07-13T13:00:00.000Z")), 9);
  assert.deepEqual(estimatesCronDecision(new Date("2026-07-13T13:00:00.000Z")), {
    run: false,
    reason: "outside_estimates_hours",
  });
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
  assert.deepEqual(estimatesLatestSlot(new Date("2026-03-08T11:59:00Z")), { slotKey: "03/07/2026:18", at: new Date("2026-03-07T23:00:00Z") });
  assert.deepEqual(estimatesLatestSlot(new Date("2026-03-08T12:00:00Z")), { slotKey: "03/08/2026:8", at: new Date("2026-03-08T12:00:00Z") });
  assert.deepEqual(estimatesLatestSlot(new Date("2026-11-01T06:30:00Z")), { slotKey: "10/31/2026:18", at: new Date("2026-10-31T22:00:00Z") });
});
