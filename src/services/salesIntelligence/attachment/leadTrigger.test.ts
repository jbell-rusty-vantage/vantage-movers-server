import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";
import { logger } from "../../../logger";
import {
  changeTriggersAttachment,
  wakeLeadAttachmentsAfterChange,
  wakeLeadAttachmentsAfterLeadCommand,
  type LeadAttachmentWakeDependencies,
  type LeadCommandWakeDependencies,
} from "./leadTrigger";
import { guardedLeadChangeScan } from "./refresh";
import { publishLeadAttachmentWakeup, salesIntelligenceQueueTopic } from "../../numberActivity/webhookFanout";

const LEAD = "650000000000000000000101", OBSERVATION = "650000000000000000000102", CHANGE = "650000000000000000000103";
const change = { _id: CHANGE, entity: { model: "FormLead", id: LEAD }, revision_before: 0, changed_paths: ["name", "normalized_phone_number"] };

function recorder(overrides: Partial<LeadAttachmentWakeDependencies> = {}) {
  const enqueued: unknown[] = [], published: string[] = [];
  const deps: LeadAttachmentWakeDependencies = {
    enabled: () => true,
    findLeadChanges: async () => [change],
    enqueue: async c => { enqueued.push(c); return { _id: "job-1", status: "pending" }; },
    publish: async id => { published.push(id); },
    ...overrides,
  };
  return { deps, enqueued, published };
}

test("a create, a phone/contact/official change, or a nested contact path re-evaluates attachments; other edits do not", () => {
  assert.equal(changeTriggersAttachment({ revision_before: 0, changed_paths: ["name"] }), true);
  for (const path of ["normalized_phone_number", "phone_number", "granot_contact_snapshot.captured_at", "duplicate", "bad_lead", "no_sync", "booked", "cancelled", "timestamp"]) {
    assert.equal(changeTriggersAttachment({ revision_before: 3, changed_paths: [path] }), true, path);
  }
  for (const path of ["notes", "cpl", "granot_priority", "receiver_agent"]) {
    assert.equal(changeTriggersAttachment({ revision_before: 3, changed_paths: [path] }), false, path);
  }
});

test("a committed Lead change enqueues the Lead's attachment job and wakes it once", async () => {
  const { deps, enqueued, published } = recorder({ findLeadChanges: async () => [change, { ...change, _id: "650000000000000000000104", revision_before: 1 }] });
  const result = await wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, deps);
  assert.equal(enqueued.length, 2);
  // Both changes map to the same fingerprint job: one wake-up.
  assert.deepEqual(published, ["job-1"]);
  assert.deepEqual(result.job_ids, ["job-1"]);
});

test("no target, a non-Lead target, or the attachment flag off: nothing is read or enqueued", async () => {
  for (const [target, enabled] of [[undefined, true], [{ model: "GranotRecordLink", id: LEAD }, true], [{ model: "CallLead", id: LEAD }, false]] as const) {
    let read = false;
    const { deps, enqueued, published } = recorder({ enabled: () => enabled, findLeadChanges: async () => { read = true; return [change]; } });
    await wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: target as never }, deps);
    assert.equal(read, false);
    assert.deepEqual([enqueued.length, published.length], [0, 0]);
  }
});

test("a replay whose job already ran, a change that nominates nothing, or no committed change publishes nothing", async () => {
  const done = recorder({ enqueue: async () => ({ _id: "job-1", status: "completed" }) });
  await wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, done.deps);
  assert.deepEqual(done.published, []);
  const nothing = recorder({ enqueue: async () => null });
  await wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, nothing.deps);
  assert.deepEqual(nothing.published, []);
  const none = recorder({ findLeadChanges: async () => [] });
  await wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, none.deps);
  assert.deepEqual([none.enqueued.length, none.published.length], [0, 0]);
});

test("failures are logged, never thrown (read, enqueue and publish)", async () => {
  for (const broken of [{ findLeadChanges: async () => { throw new Error("read"); } }, { enqueue: async () => { throw new Error("enqueue"); } },
    { publish: async () => { throw new Error("publish"); } }] as Partial<LeadAttachmentWakeDependencies>[]) {
    const { deps } = recorder(broken);
    await assert.doesNotReject(wakeLeadAttachmentsAfterChange({ observation_id: OBSERVATION, target: { model: "FormLead", id: LEAD } }, deps));
  }
});

test("publishLeadAttachmentWakeup is a no-op in tests; with a queue it sends { job_id } to the SI topic; a send failure is swallowed", async () => {
  assert.deepEqual(await publishLeadAttachmentWakeup("job-1"), { published: false, error_code: null });
  const sent: Array<[string, unknown]> = [];
  assert.deepEqual(await publishLeadAttachmentWakeup("job-2", { shouldPublish: () => true, send: async (topic, payload) => { sent.push([topic, payload]); } }),
    { published: true, error_code: null });
  assert.deepEqual(sent, [[salesIntelligenceQueueTopic(), { job_id: "job-2" }]]);
  assert.deepEqual(await publishLeadAttachmentWakeup("job-3", { shouldPublish: () => true, send: async () => { throw new Error("queue down"); } }),
    { published: false, error_code: "publish_failed" });
});

function commandRecorder(overrides: Partial<LeadCommandWakeDependencies> = {}) {
  const enqueued: unknown[] = [], published: string[] = [], reads: Array<readonly string[]> = [];
  const deps: LeadCommandWakeDependencies = {
    enabled: () => true,
    findChangesById: async (_target, ids) => { reads.push(ids); return ids.includes(CHANGE) ? [change] : []; },
    enqueue: async c => { enqueued.push(c); return { _id: "job-1", status: "pending" }; },
    publish: async id => { published.push(id); },
    ...overrides,
  };
  return { deps, enqueued, published, reads };
}

test("Form Lead create or phone change: the committed change enqueues the attachment job and wakes it once", async () => {
  const { deps, enqueued, published, reads } = commandRecorder();
  const result = await wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: [CHANGE] }, deps);
  assert.deepEqual(reads, [[CHANGE]]);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(published, ["job-1"]);
  assert.deepEqual(result, { job_ids: ["job-1"], outcome: "done" });
});

test("Form Lead command wake: a duplicate/replayed command or a no-op change wakes nothing new", async () => {
  // The same fingerprint job already ran (a duplicate command, or the scan got there first).
  const done = commandRecorder({ enqueue: async () => ({ _id: "job-1", status: "completed" }) });
  assert.deepEqual((await wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: [CHANGE] }, done.deps)).job_ids, []);
  assert.deepEqual(done.published, []);
  // A change that cannot move an attachment nominates nothing.
  const unrelated = commandRecorder({ enqueue: async () => null });
  await wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: [CHANGE] }, unrelated.deps);
  assert.deepEqual(unrelated.published, []);
  // A preallocated change id that never committed (replay) finds no change.
  const missing = commandRecorder();
  await wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: ["650000000000000000000199"] }, missing.deps);
  assert.deepEqual([missing.enqueued.length, missing.published.length], [0, 0]);
  // No change ids, a non-Lead target or the flag off: nothing is read.
  for (const [target, ids, enabled] of [[{ model: "FormLead", id: LEAD }, [], true], [{ model: "BookedLead", id: LEAD }, [CHANGE], true],
    [{ model: "FormLead", id: LEAD }, [CHANGE], false]] as const) {
    const skipped = commandRecorder({ enabled: () => enabled });
    assert.equal((await wakeLeadAttachmentsAfterLeadCommand({ target, change_ids: ids }, skipped.deps)).outcome, "skipped");
    assert.deepEqual(skipped.reads, []);
  }
});

test("Form Lead command wake never throws and is bounded by its timeout", async () => {
  for (const broken of [{ findChangesById: async () => { throw new Error("read"); } }, { enqueue: async () => { throw new Error("enqueue"); } },
    { publish: async () => { throw new Error("publish"); } }, { enabled: () => { throw new Error("flag"); } }] as Partial<LeadCommandWakeDependencies>[]) {
    const { deps } = commandRecorder(broken);
    await assert.doesNotReject(wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: [CHANGE] }, deps));
  }
  const started = Date.now();
  const slow = commandRecorder({ findChangesById: () => new Promise(() => undefined), timeoutMs: 20 });
  assert.equal((await wakeLeadAttachmentsAfterLeadCommand({ target: { model: "FormLead", id: LEAD }, change_ids: [CHANGE] }, slow.deps)).outcome, "timeout");
  assert.ok(Date.now() - started < 2_000);
});

test("the Form Lead create and correction commands wake attachments after commit, not inside the transaction", () => {
  const source = readFileSync(path.join(__dirname, "../../domainCommands/existingWrites.ts"), "utf8");
  for (const name of ["runExistingCreateFormLead", "runExistingUpdateSourceOwnedLead"]) {
    const start = source.indexOf(`export async function ${name}`);
    const next = source.indexOf("\nexport async function ", start + 1);
    const body = source.slice(start, next === -1 ? undefined : next);
    const finalize = body.indexOf("finalize:");
    assert.ok(finalize > 0, name);
    assert.ok(body.indexOf("wakeLeadAttachmentsAfterLeadCommand") > finalize, `${name} wakes in finalize (post-commit)`);
    assert.match(body, /change_ids: changeIds\.map\(String\)/, name);
  }
});

test("the attachment refresh keeps running its watermark pass and drain when the Lead-change scan fails", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  try {
    assert.equal(await guardedLeadChangeScan(async () => { throw Object.assign(new Error("primary stepped down"), { code: 91 }); }), null);
    assert.equal(warn.mock.calls.length, 1);
    assert.equal((warn.mock.calls[0]?.arguments[0] as { msg?: string }).msg, "sales_intelligence.attachment.lead_change_scan_failed");
    assert.deepEqual(await guardedLeadChangeScan(async () => ({ scanned: 2, nominated: 1 })), { scanned: 2, nominated: 1 });
  } finally { warn.mock.restore(); }
  const source = readFileSync(path.join(__dirname, "refresh.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function runAttachmentRefreshOnce"));
  assert.match(body, /await guardedLeadChangeScan\(\)/);
  assert.doesNotMatch(body, /await scanLeadChangesForAttachments\(\)/);
});
