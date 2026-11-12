import assert from "node:assert/strict";
import test from "node:test";
import { groupPoolEpisodeIntervals } from "./episodeIntervals";

test("grouping preserves half-open Pool membership, including re-entry and overlapping subjects", () => {
  const episode = (subject_id: string, start: number, end: number) =>
    ({ subject_id, event_at: { $gte: new Date(start), $lt: new Date(end) } });
  const episodes = [episode("a", 1, 5), episode("b", 1, 5), episode("a", 7, 10), episode("c", 2, 7)];
  const grouped = groupPoolEpisodeIntervals(episodes);
  assert.equal(grouped.length, 3);
  for (const subject of ["a", "b", "c", "outside"]) {
    for (let time = 0; time <= 11; time++) {
      const inside = (range: typeof episodes[number]["event_at"]) => +range.$gte <= time && time < +range.$lt;
      assert.equal(grouped.some(g => g.subject_id.$in.includes(subject) && inside(g.event_at)),
        episodes.some(e => e.subject_id === subject && inside(e.event_at)));
    }
  }
});
