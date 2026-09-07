import assert from "node:assert/strict";
import { test } from "node:test";
import { closeDailyOperationsDay } from "./closeDay";

test("close sets yesterday status closed when it is still open", async () => {
  const days = new Map<string, { day: string; status: "open" | "closed"; closed_at: Date | null }>([
    ["2026-09-05", { day: "2026-09-05", status: "open", closed_at: null }],
    ["2026-09-06", { day: "2026-09-06", status: "open", closed_at: null }],
  ]);

  const result = await closeDailyOperationsDay({
    now: () => new Date("2026-09-06T04:10:00.000Z"),
    closeOpenDaysBefore: async (today, closedAt) => {
      const closed: string[] = [];
      for (const row of days.values()) {
        if (row.day < today && row.status === "open") {
          row.status = "closed";
          row.closed_at = closedAt;
          closed.push(row.day);
        }
      }
      return closed;
    },
  });

  assert.equal(result.today, "2026-09-06");
  assert.deepEqual(result.closed_days, ["2026-09-05"]);
  assert.equal(result.already_closed, false);
  assert.equal(days.get("2026-09-05")?.status, "closed");
  assert.ok(days.get("2026-09-05")?.closed_at);
  assert.equal(days.get("2026-09-06")?.status, "open");
});

test("close is a no-op when yesterday is already closed", async () => {
  let calls = 0;
  const result = await closeDailyOperationsDay({
    now: () => new Date("2026-09-06T04:10:00.000Z"),
    closeOpenDaysBefore: async () => {
      calls += 1;
      return [];
    },
  });
  assert.equal(result.already_closed, true);
  assert.deepEqual(result.closed_days, []);
  assert.equal(calls, 1);
});

test("close also seals older open days, not only yesterday", async () => {
  const result = await closeDailyOperationsDay({
    now: () => new Date("2026-09-06T04:10:00.000Z"),
    closeOpenDaysBefore: async (today) =>
      ["2026-09-04", "2026-09-05"].filter((day) => day < today),
  });
  assert.deepEqual(result.closed_days, ["2026-09-04", "2026-09-05"]);
});
