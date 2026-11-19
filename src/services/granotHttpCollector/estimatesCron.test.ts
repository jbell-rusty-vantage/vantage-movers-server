import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatesCronDecision, estimatesDateWindow, estimatesDateChunks, granotCalendarEpoch, newYorkHour, estimatesSlotInstant } from "./estimatesCron";
import { poolCronDuties, poolLatestSlot } from "./poolCron";

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

test("exact ordinary, spring and fall local slots and independent 08:00 Pool duties", () => {
  const ordinaryHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  for (const [start, end, count] of [
    ['2026-11-04T05:00:00Z', '2026-11-05T05:00:00Z', 13],
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 13],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 13],
  ] as const) {
    const slots: string[] = [], hours: number[] = [];
    for (let ms = +new Date(start); ms < +new Date(end); ms += 3600000) {
      const at = new Date(ms);
      const hour = newYorkHour(at);
      const decision = estimatesCronDecision(at);
      const duties = poolCronDuties(at);
      assert.deepEqual(duties.filter(d => d.lane === 'pool_discovery').map(d => d.slotKey),
        hour === 8 ? [estimatesDateWindow(at).to + ':6:pool_discovery'] : []);
      assert.deepEqual(duties.filter(d => d.lane === 'pool_refresh').map(d => d.slotKey),
        decision.run ? [decision.slotKey + ':pool_refresh'] : []);
      if (decision.run) {
        slots.push(decision.slotKey);
        hours.push(hour);
        assert.equal(+estimatesSlotInstant(decision.slotKey), ms);
      }
    }
    assert.equal(slots.length, count); assert.equal(new Set(slots).size, count);
    assert.deepEqual(hours, ordinaryHours);
  }
  const at = new Date('2026-11-04T13:00:00Z');
  assert.equal(estimatesCronDecision(at).run, true);
  assert.deepEqual(poolCronDuties(at).map(d => d.lane), ['pool_refresh', 'pool_discovery']);
  assert.equal(poolLatestSlot(at, 'pool_refresh').slotKey, '11/04/2026:8:pool_refresh');
});
