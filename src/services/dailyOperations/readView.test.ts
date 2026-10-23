import assert from "node:assert/strict";
import { test } from "node:test";
import type { DailyOperationsReadViewDocument } from "../../models/DailyOperationsReadView";
import { getDailyOperationsBoard } from "./readView";
import { getDailyOperationsSnapshot } from "./snapshot";
import type { DailyOperationsReadViewStore } from "./readViewCache";
import type { DailyOperationsEventItem } from "./eventsPage";

test("board sources execute five bounded queries once and source-free cache hits", async () => {
  let queries = 0; let cached: DailyOperationsReadViewDocument | null = null;
  const instant = new Date("2026-10-23T18:00:00Z");
  const stores: DailyOperationsReadViewStore = {
    read: async () => cached,
    claim: async ({ key, now, token, intervalMs }) => ({ _id: key, generation: 1, lease_token: token, next_attempt_at: new Date(+now + intervalMs), lease_expires_at: new Date(+now + 15000) }),
    publish: async ({ key, payload, hash, now }) => { cached = { _id: key, generation: 1, payload, content_hash: hash, generated_at: now, revision: 1, next_attempt_at: new Date(+now + 60000), lease_token: null, lease_expires_at: now }; return cached; },
    fail: async () => undefined,
  };
  const event = (i: number): DailyOperationsEventItem => ({ event_id: `fixture-${i}`, day: "2026-10-23", occurred_at: instant.toISOString(), lane: "lead", kind: "form_lead.created", title: "Fixture", source_company: null, ingestion_origin: null, lead_kind: "form", job_no: null, entity_type: null, entity_id: null, parent_receipt_id: null, links: {}, card: {}, metric_touches: [] });
  const deps = {
    now: () => instant, stores,
    getSnapshot: async () => getDailyOperationsSnapshot({ now: () => instant,
      loadDays: async () => { queries++; return [null, null, null]; },
      countOpenIntakes: async () => { queries++; return 2; },
      countHeldMessages: async () => { queries++; return 3; },
    }),
    listEvents: async (_day: string, milestones: boolean) => { queries++; return Array.from({ length: milestones ? 51 : 81 }, (_, i) => event(i)); },
  };
  const board = await getDailyOperationsBoard(deps);
  assert.equal(queries, 5);
  assert.equal(board.events.length, 80); assert.equal(board.milestones.length, 50);
  assert.deepEqual(board.truncation, { events: true, milestones: true });
  assert.equal(board.snapshot.metrics.texts.held_now, 3);
  assert.equal(board.schema_version, 2); assert.equal(board.poll_after_ms, 60000);
  assert.deepEqual(await getDailyOperationsBoard(deps), board);
  assert.equal(queries, 5);
});
