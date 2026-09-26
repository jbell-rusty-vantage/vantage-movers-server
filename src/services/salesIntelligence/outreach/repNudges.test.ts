import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { getOwnerRepNudgeModel } from "../../../models/OwnerRepNudge";
import { nudgeDtoSchema } from "../nudges/reads";
import { REP_NUDGE_LIMIT, repNudgePage } from "./reads";

/** S12-REPNUDGE (UI-2 §5 server): a rep's detail reads only the nudges on the record addressed to its Agent, in the Owner's item shape. */
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID ||= "csi-local-proof";
const RECORD = "6ab5ab1072ee2eb383d941fd", DANA = "6ab5ab0d72ee2eb383d940a7";
const row = (id: string, agent: string | null) => ({ _id: new mongoose.Types.ObjectId(id), revision: 2, outreach_record_id: new mongoose.Types.ObjectId(RECORD),
  rc_account_id: "acct", rc_extension_id: "101", rep_identity_link_id: null, agent_id: agent ? new mongoose.Types.ObjectId(agent) : null,
  actor: { kind: "owner", id: "owner-user" }, channel: "team_messaging", purpose: "call_suggestion", template_key: "call_suggestion", template_version: 1,
  body_as_sent: "Please call Maria (…0143) back today.", status: "sent", fallback_channel: null, error_code: null,
  createdAt: new Date("2026-09-25T12:00:00.000Z"), updatedAt: new Date("2026-09-25T12:00:02.000Z"), sent_at: new Date("2026-09-25T12:00:02.000Z") });

test("S12-REPNUDGE: repNudgePage filters on the record and the rep's Agent, newest first, bounded, no cursor; Owner item shape", async t => {
  const seen: Array<{ filter: Record<string, unknown>; sort?: unknown; limit?: number }> = [];
  t.mock.method(getOwnerRepNudgeModel(), "find", ((filter: Record<string, unknown>) => {
    const call: { filter: Record<string, unknown>; sort?: unknown; limit?: number } = { filter }; seen.push(call);
    const chain = { sort: (s: unknown) => { call.sort = s; return chain; }, limit: (n: number) => { call.limit = n; return chain; },
      lean: async () => [row("6ab5ab2072ee2eb383d95001", DANA)] };
    return chain;
  }) as never);
  const page = await repNudgePage(RECORD, DANA);
  assert.equal(seen.length, 1);
  assert.equal(String(seen[0]!.filter.outreach_record_id), RECORD);
  assert.equal(String(seen[0]!.filter.agent_id), DANA, "a nudge to another rep, or with no resolved Agent, never matches");
  assert.deepEqual(seen[0]!.sort, { _id: -1 }); assert.equal(seen[0]!.limit, REP_NUDGE_LIMIT);
  assert.equal(page.next_cursor, null);
  assert.equal(page.items.length, 1);
  const item = nudgeDtoSchema.parse(page.items[0]);
  assert.deepEqual([item.agent_id, item.body_as_sent, item.status, item.sent_at], [DANA, "Please call Maria (…0143) back today.", "sent", "2026-09-25T12:00:02.000Z"]);
  // A malformed Agent or record id reads nothing.
  assert.deepEqual(await repNudgePage(RECORD, "not-an-id"), { items: [], next_cursor: null });
  assert.equal(seen.length, 1);
});
