import assert from "node:assert/strict";
import { test } from "node:test";
import { csiOperatorActor, CsiError, type CsiActor } from "../auth";
import {
  BlobReadFailed, MEDIA_AUDIT_WINDOW_MS, openOwnerConversationMedia, parseByteRange, privateBlobReader,
  type BlobReader, type MediaAuditRow, type MediaConversationRow, type OwnerMediaStore,
} from "./ownerMedia";

/**
 * S4-CONV media route service (data spec §6.9; DECISIONS "Media route = server-side Range stream"). A fake
 * `BlobReader` stands in for the private Blob store; the default reader is never called with credentials here.
 */
const CONVERSATION = "a".repeat(24), NUMBER = "b".repeat(24);
const PATHNAME = "conversations/acct/0123456789abcdef.mp3";
const SIZE = 100;
const bytes = Uint8Array.from({ length: SIZE }, (_, i) => i);
const owner = csiOperatorActor("req-media-1");
const now = new Date("2026-09-23T18:02:00.000Z");

function world(over: { conversation?: MediaConversationRow | null; number?: { content_purge_pending?: boolean; purged_at?: Date | null } | null; duplicate?: boolean; auditFails?: boolean } = {}) {
  const events: string[] = [];
  const audits: MediaAuditRow[] = [];
  const reads: Array<{ pathname: string; range: { start: number; end: number } | null }> = [];
  const store: OwnerMediaStore = {
    conversation: async id => { events.push("conversation"); return over.conversation === undefined ? { _id: id, contact_number_id: NUMBER, content_purged_at: null,
      media: { blob_pathname: PATHNAME, purged_at: null, bytes: SIZE, content_type: "audio/mpeg" } } : over.conversation; },
    numberRetention: async () => { events.push("number"); return over.number === undefined ? { content_purge_pending: false } : over.number; },
    audit: async row => {
      events.push("audit");
      if (over.auditFails) throw new Error("audit write failed");
      const duplicate = over.duplicate || audits.some(a => a.semantic_key === row.semantic_key);
      audits.push(row);
      return duplicate ? "duplicate" : "written";
    },
  };
  const readBlob: BlobReader = async (pathname, range) => {
    events.push("read");
    reads.push({ pathname, range });
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return { status: range ? 206 : 200, content_type: "audio/mpeg", content_length: body.byteLength,
      content_range: range ? `bytes ${range.start}-${range.end}/${SIZE}` : null, body: new Blob([body]).stream() };
  };
  return { store, readBlob, events, audits, reads };
}
const drain = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());
const open = (w: ReturnType<typeof world>, range?: string, actor: CsiActor = owner, at = now) =>
  openOwnerConversationMedia({ conversation_id: CONVERSATION, actor, range }, { store: w.store, readBlob: w.readBlob, now: () => at });

test("S4-CONV media: 200 full stream with audio type, length, Accept-Ranges and private no-store; audit row before the read", async () => {
  const w = world();
  const outcome = await open(w);
  assert.equal(outcome.kind, "stream");
  if (outcome.kind !== "stream") return;
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.headers, { "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "audio/mpeg", "Content-Disposition": "inline", "Content-Length": "100" });
  assert.deepEqual(await drain(outcome.body), bytes);
  assert.deepEqual(w.events, ["conversation", "number", "audit", "read"]);
  assert.deepEqual(w.reads, [{ pathname: PATHNAME, range: null }]);
  const [row] = w.audits;
  assert.deepEqual(row, { semantic_key: `media_played:${CONVERSATION}:sales-intelligence-operator:${Math.floor(+now / MEDIA_AUDIT_WINDOW_MS) * MEDIA_AUDIT_WINDOW_MS}`,
    subject_key: `conversation:${CONVERSATION}`, event_kind: "media_played", command_id: null,
    actor: { kind: "owner", id: "sales-intelligence-operator", request_id: "req-media-1", run_id: null }, happened_at: now, recorded_at: now, prior: { recording_state: "available" },
    current: { conversation_id: CONVERSATION, contact_number_id: NUMBER, range: null },
    invalidation: { kind: "number", target_id: NUMBER, subject_key: `conversation:${CONVERSATION}`, revision: 1 } });
  // The blob path never leaves the service: not in headers, not in the audit row.
  assert.doesNotMatch(JSON.stringify([outcome.headers, w.audits]), /conversations\/acct|0123456789abcdef|\.mp3/);
});

test("S4-CONV media: 206 partial content for explicit, open-ended and suffix ranges", async () => {
  for (const [header, start, end] of [["bytes=10-19", 10, 19], ["bytes=95-", 95, 99], ["bytes=-10", 90, 99], ["bytes=90-500", 90, 99], ["bytes=0-0", 0, 0]] as const) {
    const w = world();
    const outcome = await open(w, header);
    assert.equal(outcome.kind, "stream", header);
    if (outcome.kind !== "stream") continue;
    assert.equal(outcome.status, 206, header);
    assert.equal(outcome.headers["Content-Range"], `bytes ${start}-${end}/${SIZE}`, header);
    assert.equal(outcome.headers["Content-Length"], String(end - start + 1), header);
    assert.equal(outcome.headers["Accept-Ranges"], "bytes");
    assert.equal(outcome.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(await drain(outcome.body), bytes.slice(start, end + 1), header);
    assert.deepEqual(w.reads[0]!.range, { start, end });
    assert.equal(w.audits[0]!.current.range, `bytes=${start}-${end}`);
    assert.deepEqual(w.events.slice(-2), ["audit", "read"]);
  }
});

test("S4-CONV media: 416 for an unsatisfiable range, without audit or read; malformed and multi-range headers serve the whole object", async () => {
  for (const header of ["bytes=100-", "bytes=250-300", "bytes=-0"]) {
    const w = world();
    const outcome = await open(w, header);
    assert.deepEqual(outcome, { kind: "range_not_satisfiable", headers: { "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Range": `bytes */${SIZE}` } }, header);
    assert.deepEqual(w.audits, []);
    assert.deepEqual(w.reads, []);
  }
  for (const header of ["bytes=0-10,20-30", "items=0-5", "bytes=9-3", "bytes=-", "garbage"]) {
    const w = world();
    const outcome = await open(w, header);
    assert.equal(outcome.kind === "stream" && outcome.status, 200, header);
    assert.equal(w.reads[0]!.range, null);
  }
  assert.deepEqual(parseByteRange("bytes=5-9", null), { kind: "ignore" });
  assert.deepEqual(parseByteRange(" bytes = 5 - 9 ", 10), { kind: "range", range: { start: 5, end: 9 } });
});

test("S4-CONV media: 404 without retained media; the store's missing object is 404 after the audit row", async () => {
  const cases: Array<Parameters<typeof world>[0]> = [
    { conversation: null },
    { conversation: { _id: CONVERSATION, media: null } },
    { conversation: { _id: CONVERSATION, media: { blob_pathname: null, purged_at: null } } },
    { conversation: { _id: CONVERSATION, media: { blob_pathname: PATHNAME, purged_at: new Date("2026-09-01T00:00:00Z") } } },
    { conversation: { _id: CONVERSATION, content_purged_at: new Date("2026-09-01T00:00:00Z"), media: { blob_pathname: PATHNAME, purged_at: null } } },
    { number: { content_purge_pending: true } },
    { number: { purged_at: new Date("2026-09-01T00:00:00Z") } },
  ];
  for (const over of cases) {
    const w = world(over);
    assert.deepEqual(await open(w), { kind: "not_found" });
    assert.deepEqual(w.audits, []);
    assert.deepEqual(w.reads, []);
  }
  const w = world();
  w.readBlob = async () => { w.events.push("read"); return null; };
  const outcome = await openOwnerConversationMedia({ conversation_id: CONVERSATION, actor: owner }, { store: w.store, readBlob: w.readBlob, now: () => now });
  assert.deepEqual(outcome, { kind: "not_found" });
  assert.deepEqual(w.events.slice(-2), ["audit", "read"]);
});

test("S4-CONV media: a failed audit write stops the read; duplicate rows in one window still stream; a new window writes a new row", async () => {
  const failing = world({ auditFails: true });
  await assert.rejects(open(failing), /audit write failed/);
  assert.deepEqual(failing.reads, []);

  const w = world();
  await open(w);
  const again = await open(w, "bytes=50-", owner, new Date(+now + 60_000));
  assert.equal(again.kind === "stream" && again.status, 206);
  assert.equal(w.audits[0]!.semantic_key, w.audits[1]!.semantic_key);
  await open(w, undefined, owner, new Date(+now + MEDIA_AUDIT_WINDOW_MS));
  assert.notEqual(w.audits[2]!.semantic_key, w.audits[0]!.semantic_key);
  assert.equal(w.reads.length, 3);
});

test("S4-CONV media: Owner-only (untrusted or worker actors refused); stored type preferred, non-audio types never served as audio", async () => {
  const w = world();
  const forged = { kind: "owner", id: "x", request_id: "r", run_id: null } as CsiActor;
  await assert.rejects(open(w, undefined, forged), (e: unknown) => e instanceof CsiError && e.code === "OWNER_REQUIRED");
  assert.deepEqual(w.events, []);
  const html = world({ conversation: { _id: CONVERSATION, media: { blob_pathname: PATHNAME, purged_at: null, bytes: SIZE, content_type: "text/html" } } });
  html.readBlob = async () => ({ status: 200, content_type: "text/html", content_length: SIZE, content_range: null, body: new Blob([bytes]).stream() });
  const outcome = await openOwnerConversationMedia({ conversation_id: CONVERSATION, actor: owner }, { store: html.store, readBlob: html.readBlob, now: () => now });
  assert.equal(outcome.kind === "stream" && outcome.headers["Content-Type"], "application/octet-stream");
});

test("S4-CONV media: the default private reader refuses without credentials and never echoes the pathname", async () => {
  const saved = { token: process.env.BLOB_READ_WRITE_TOKEN, store: process.env.BLOB_STORE_ID };
  process.env.BLOB_READ_WRITE_TOKEN = ""; process.env.BLOB_STORE_ID = "";
  try {
    await assert.rejects(privateBlobReader(PATHNAME, null), (e: unknown) => e instanceof BlobReadFailed && !String((e as Error).message).includes("conversations/"));
  } finally {
    if (saved.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = saved.token;
    if (saved.store === undefined) delete process.env.BLOB_STORE_ID; else process.env.BLOB_STORE_ID = saved.store;
  }
});
