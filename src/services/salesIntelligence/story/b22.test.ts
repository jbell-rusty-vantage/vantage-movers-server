import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleSubjectStory, resolveStorySubject } from "./assemble";
import { installFakeMongo } from "./fakeMongo.fixtures";
import { storyToReadContent } from "./page";
import * as baseline from "./sources.baseline";
import * as current from "./sources";
import { buildS4TimelineDocs, S4_AS_OF, S4_IDS } from "./timeline.fixtures";
import type { StorySubject } from "./types";

/**
 * B22 (S4-TIMELINE): the model's Subject Story is byte-identical before and after the timeline reader
 * changes when the readers are called without the timeline options. `sources.baseline.ts` is the
 * pre-change reader file; both run over the same in-memory documents (every source, ties, slack rows,
 * undated Bookings, audit-timed cancels, truncation at small limits) and must produce identical JSON,
 * reader by reader and for the whole story page the model reads.
 *
 * S5c-CALLS (G2) adds Owner-only capture keys to each `call` detail (`terminal`, `call_log_state`,
 * `in_progress`, `sources`, `observed_reason`, `capture_recovery`). The assembler strips them for the
 * model (`modelCallEvent`), so the reader-level comparison applies the same strip; the whole-page
 * comparison below needs none.
 */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const coverage = { known_through: S4_AS_OF.toISOString(), gaps: [], capabilities: {}, ai_paused: false };
const EARLIER = new Date("2026-08-20T12:00:00.000Z");

async function subjects(): Promise<Array<[string, StorySubject]>> {
  const out: Array<[string, StorySubject]> = [];
  for (const as_of of [S4_AS_OF, EARLIER]) {
    const inputs: Array<[string, Parameters<typeof resolveStorySubject>[0]]> = [
      ["number N1", { contact_number_id: String(S4_IDS.n1), as_of }], ["number N2", { contact_number_id: String(S4_IDS.n2), as_of }],
      ["lead A", { lead: { model: "FormLead", id: String(S4_IDS.leadA) }, as_of }], ["lead B", { lead: { model: "CallLead", id: String(S4_IDS.leadB) }, as_of }],
      ["lead-only L", { lead: { model: "FormLead", id: String(S4_IDS.leadL) }, as_of }], ["rejected lead C", { lead: { model: "FormLead", id: String(S4_IDS.leadC) }, as_of }],
    ];
    for (const [label, input] of inputs) {
      const subject = await resolveStorySubject(input);
      assert.ok(subject, label);
      out.push([`${label} @ ${as_of.toISOString()}`, subject]);
    }
  }
  return out;
}

test("B22: every story reader returns byte-identical output to the pre-change readers", async t => {
  installFakeMongo(t, buildS4TimelineDocs());
  assert.deepEqual(Object.keys(current.STORY_SOURCES), Object.keys(baseline.STORY_SOURCES));
  let compared = 0, events = 0;
  for (const [label, subject] of await subjects()) {
    for (const limit of [400, 25, 5, 1]) {
      for (const name of Object.keys(baseline.STORY_SOURCES)) {
        const before = JSON.stringify(await baseline.STORY_SOURCES[name]!(subject, limit));
        const read = await current.STORY_SOURCES[name]!(subject, limit);
        const after = JSON.stringify({ ...read, events: read.events.map(current.modelCallEvent) });
        assert.equal(after, before, `${label} · ${name} · limit ${limit}`);
        compared++;
        events += (JSON.parse(before) as { events: unknown[] }).events.length;
      }
    }
  }
  assert.ok(compared >= 500 && events >= 3000, `compared ${compared} reads, ${events} events`);
});

test("B22: the whole story page (assembled, collapsed, rendered) is byte-identical", async t => {
  installFakeMongo(t, buildS4TimelineDocs());
  const sources = current.STORY_SOURCES as Record<string, current.StorySource>;
  const saved = { ...sources };
  const page = async (subject: StorySubject, limit: number) => {
    const story = await assembleSubjectStory(subject, { limit_events: limit });
    return JSON.stringify({ story, page: storyToReadContent(story, coverage) });
  };
  let pages = 0;
  for (const [label, subject] of await subjects()) {
    for (const limit of [400, 30]) {
      const after = await page(subject, limit);
      Object.assign(sources, baseline.STORY_SOURCES);
      let before: string;
      try { before = await page(subject, limit); } finally { Object.assign(sources, saved); }
      assert.equal(after, before, `${label} · limit_events ${limit}`);
      pages++;
    }
  }
  const n1 = await assembleSubjectStory((await resolveStorySubject({ contact_number_id: String(S4_IDS.n1), as_of: S4_AS_OF }))!);
  assert.ok(n1.events.length >= 60 && n1.prose.length > 5000, "the N1 page is substantial");
  assert.equal(pages, 24);
});
