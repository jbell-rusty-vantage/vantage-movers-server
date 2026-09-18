import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";
import { storeRecordingStream } from "../../conversations/streamingMedia";
import { syntheticRecordingWav } from "../../numberActivity/fixtures";
import { retryAfterMs } from "../../ringcentral/recordings";
test("media stream hashes actual bytes, uses immutable account key and cleans transient file", async () => {
  const bytes = syntheticRecordingWav(); let temporary = "";
  const output = await storeRecordingStream({ response: new Response(Buffer.from(bytes), { headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
    metadataContentType: "audio/wav", accountId: "account-a", recordingId: "rec-a", maxBytes: 100, signal: AbortSignal.timeout(5000),
    upload: async input => { temporary = input.filePath; assert.deepEqual(await readFile(input.filePath), Buffer.from(bytes)); return { pathname: input.pathname }; },
  });
  assert.equal(output.media_digest_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(output.blob_pathname, `conversations/account-a/rec-a/${output.media_digest_sha256}.wav`);
  assert.equal(output.content_type, "audio/wav"); await assert.rejects(access(temporary));
});
test("media rejects declared and streamed oversize, mismatched length/type and arbitrary audio", async () => {
  for (const [headers, body, max, error] of [
    [{ "content-type": "audio/wav", "content-length": "1000" }, syntheticRecordingWav(), 100, "media_too_large"],
    [{ "content-type": "audio/wav" }, syntheticRecordingWav(), 10, "media_too_large"],
    [{ "content-type": "audio/wav", "content-length": "49" }, syntheticRecordingWav(), 100, "content_length_mismatch"],
    [{ "content-type": "audio/mpeg" }, syntheticRecordingWav(), 100, "content_type_mismatch"],
    [{ "content-type": "audio/wav" }, Buffer.from("not audio"), 100, "invalid_media"],
  ] as Array<[Record<string,string>, Uint8Array, number, string]>) {
    await assert.rejects(storeRecordingStream({ response: new Response(Buffer.from(body), { headers }), metadataContentType: "audio/wav", accountId: "a", recordingId: "r", maxBytes: max,
      signal: AbortSignal.timeout(5000), upload: async () => { throw new Error("must not upload"); } }), new RegExp(error));
  }
});
test("Retry-After seconds, HTTP date and default", () => {
  const now = new Date("2026-09-17T00:00:00Z");
  assert.equal(retryAfterMs("23", now), 23000); assert.equal(retryAfterMs("Thu, 17 Sep 2026 00:01:00 GMT", now), 60000);
  assert.equal(retryAfterMs(null, now), 600000); assert.equal(retryAfterMs("invalid", now), 600000);
});
