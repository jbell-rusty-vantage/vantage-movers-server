import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import { CsiError } from "../salesIntelligence/auth";
import type { LeadLinkChange, LeadRow } from "./leadLink";
import { leadLinkJobWork, type LeadLinkJobDependencies } from "./leadLinkJobs";

const session = {} as ClientSession;
const NOW = new Date("2026-10-06T12:00:00Z");

/** Records the job's calls in order; the minted number exists for `numbersForLead` only after the mint. */
function fakeDeps(row: LeadRow | null, options: { existing?: string[] } = {}) {
  const calls: string[] = [];
  const minted: string[] = [];
  const deps: LeadLinkJobDependencies = {
    loadLeadRow: async (ref) => { calls.push(`load:${ref.model}`); return row; },
    ensureLeadContactNumber: async (model, lead) => {
      calls.push(`mint:${model}:${lead.normalized_phone_number ?? "-"}:${lead.original_caller_phone ?? "-"}`);
      minted.push("n-minted");
      return { action: "created", number_id: "n-minted", e164: "+12025550100" };
    },
    numbersForLead: async () => { calls.push("numbers"); return [...(options.existing ?? []), ...minted]; },
    recomputeLeadLink: async (numberId) => {
      calls.push(`recompute:${String(numberId)}`);
      return { number_id: String(numberId), changed: true, revision: 2, before: { lead: null, leads: [] },
        after: { lead: { model: "CallLead", id: "c1" }, leads: [{ model: "CallLead", id: "c1" }] }, next: {} as LeadLinkChange["next"] };
    },
  };
  return { deps, calls };
}

const callLead = (extra: Partial<LeadRow> = {}): LeadRow => ({ _id: new mongoose.Types.ObjectId(), timestamp: new Date("2026-08-01T00:00:00Z"),
  normalized_phone_number: "2025550100", ringcentral: { telephony_session_id: "s-1", original_caller: { normalized_phone_number: "2025550199" } }, ...extra });

test("a Call Lead job with no number mints it, then links it in the same job (olr C2b)", async () => {
  const id = String(new mongoose.Types.ObjectId());
  const { deps, calls } = fakeDeps(callLead());
  const changes = await leadLinkJobWork(`lead-link:lead:CallLead:${id}`, id, session, "job-1", NOW, deps);
  assert.deepEqual(calls, ["load:CallLead", "mint:CallLead:2025550100:2025550199", "numbers", "recompute:n-minted"],
    "mint before the number lookup, so the recompute (and its desk wake) covers the new number");
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.number_id, "n-minted");
});

test("a Form Lead job mints through the same path; a number job never mints", async () => {
  const id = String(new mongoose.Types.ObjectId());
  const form = fakeDeps({ _id: id, normalized_phone_number: "2025550100" }, { existing: ["n-old"] });
  await leadLinkJobWork(`lead-link:lead:FormLead:${id}`, id, session, "job-2", NOW, form.deps);
  assert.deepEqual(form.calls, ["load:FormLead", "mint:FormLead:2025550100:-", "numbers", "recompute:n-old", "recompute:n-minted"]);

  const numberId = String(new mongoose.Types.ObjectId());
  const number = fakeDeps(callLead());
  await leadLinkJobWork(`lead-link:number:${numberId}`, numberId, session, "job-3", NOW, number.deps);
  assert.deepEqual(number.calls, [`recompute:${numberId}`]);
});

test("a missing Lead mints nothing but still recomputes the numbers that list it; a bad subject is refused", async () => {
  const id = String(new mongoose.Types.ObjectId());
  const gone = fakeDeps(null, { existing: ["n-listed"] });
  await leadLinkJobWork(`lead-link:lead:CallLead:${id}`, id, session, "job-4", NOW, gone.deps);
  assert.deepEqual(gone.calls, ["load:CallLead", "numbers", "recompute:n-listed"]);
  await assert.rejects(() => leadLinkJobWork(`lead-link:lead:Booking:${id}`, id, session, "job-5", NOW, gone.deps),
    (error: unknown) => error instanceof CsiError && error.code === "INVALID_INPUT");
});
