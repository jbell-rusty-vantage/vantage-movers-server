import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLeadTabWritesAllowed, assertLeadTargetWritesAllowed, LEAD_TAB_MIGRATION_FENCE_SCOPE, LeadTabWritesFencedError, readLeadTabWriterFence } from "./writerFence";

const now = new Date("2026-11-03T20:00:00Z");
const until = new Date(+now + 60_000);

test("live durable topology lease blocks every lead destination and carries a retryable result", async () => {
  const lookedUp: string[] = [];
  const options = { now, lookup: async (scope: string) => { lookedUp.push(scope); return { leased_until: until, lease_owner: "migration-run" }; } };
  for (const prefix of ["master", "source"]) for (const tab of ["forms", "duplicates", "bad_leads", "calls", "duplicate_calls", "bad_calls"]) {
    await assert.rejects(assertLeadTargetWritesAllowed([{ target: `${prefix}_${tab}` }], options), (error: unknown) => error instanceof LeadTabWritesFencedError && error.retryable && error.retry_after === until && error.code === "lead_sheet_tab_migration_in_progress");
  }
  assert.equal(lookedUp.length, 12);
  assert.ok(lookedUp.every((scope) => scope === LEAD_TAB_MIGRATION_FENCE_SCOPE));
});

test("expired/released lease resumes writes without a cache or permanent flag", async () => {
  let lease: { leased_until: Date } | null = { leased_until: until };
  const lookup = async () => lease;
  await assert.rejects(assertLeadTabWritesAllowed({ now, lookup }), LeadTabWritesFencedError);
  lease = { leased_until: new Date(+now) };
  assert.equal(await readLeadTabWriterFence({ now, lookup }), null);
  await assertLeadTabWritesAllowed({ now, lookup });
  lease = null;
  await assertLeadTabWritesAllowed({ now, lookup });
});

test("official Booking/Cancellation targets remain independent of the lead topology fence", async () => {
  let reads = 0;
  await assertLeadTargetWritesAllowed([{ target: "master_booked" }, { target: "master_cancelled" }], { now, lookup: async () => { reads++; throw new Error("should not read lead fence"); } });
  assert.equal(reads, 0);
});

test("a failed fence lookup fails closed before a lead write can start", async () => {
  let writes = 0;
  const run = async () => {
    await assertLeadTargetWritesAllowed([{ target: "master_calls" }], { now, lookup: async () => { throw new Error("lookup_unavailable"); } });
    writes++;
  };
  await assert.rejects(run(), /lookup_unavailable/);
  assert.equal(writes, 0);
});
