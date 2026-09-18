import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingProvider, RecordingReadError } from "./recordings";
import { ringCentralReadResponse } from "./client";
test("recording adapter uses fixed account endpoints and discards contentUri", async () => {
  const paths: string[] = [];
  const provider = recordingProvider(async endpoint => {
    paths.push(endpoint);
    return endpoint.endsWith("/content") ? new Response("synthetic") : Response.json({ contentType: "audio/wav", duration: 2, contentUri: "https://untrusted.invalid/secret" });
  });
  const signal = AbortSignal.timeout(5000);
  assert.deepEqual(await provider.metadata("account-a", "recording-a", signal), { contentType: "audio/wav", duration: 2 });
  await provider.content("account-a", "recording-a", signal);
  assert.deepEqual(paths, ["/restapi/v1.0/account/account-a/recording/recording-a", "/restapi/v1.0/account/account-a/recording/recording-a/content"]);
  await assert.rejects(provider.content("../other", "rec", signal), /invalid_recording_identity/);
  const throttled = recordingProvider(async () => new Response("sensitive body", { status: 429, headers: { "retry-after": "19" } }));
  await assert.rejects(throttled.content("a", "r", signal), error => error instanceof RecordingReadError && error.retryAfter === "19" && !error.message.includes("sensitive"));
  const partial = recordingProvider(async () => new Response("partial", { status: 206 }));
  await assert.rejects(partial.content("a", "r", signal), error => error instanceof RecordingReadError && error.status === 206);
});
test("streaming client shares JWT refresh once, returns headers and forbids redirects", async () => {
  let requests = 0, refreshes = 0;
  const response = await ringCentralReadResponse("/restapi/v1.0/account/a/recording/r/content", AbortSignal.timeout(5000), {
    server: "https://synthetic.invalid", token: async () => ({ access_token: "synthetic", issued_at: 0, access_token_expires_at: Date.now() + 100000 }),
    refresh: async () => { refreshes++; }, fetch: async (_url, init) => {
      assert.equal(init?.redirect, "error"); assert.ok(init?.signal); requests++;
      return requests === 1 ? new Response(null, { status: 401 }) : new Response("audio", { headers: { "content-type": "audio/wav" } });
    },
  });
  assert.equal(requests, 2); assert.equal(refreshes, 1); assert.equal(response.headers.get("content-type"), "audio/wav");
});
test("recording deadline bounds stalled token acquisition and unauthorized refresh", async () => {
  for (const stalled of ["token", "refresh"] as const) {
    const controller = new AbortController(); let calls = 0;
    const timeout = new Error("synthetic_recording_timeout");
    const waitForever = async () => { controller.abort(timeout); return new Promise<never>(() => {}); };
    await assert.rejects(ringCentralReadResponse("/restapi/v1.0/account/a/recording/r/content", controller.signal, {
      server: "https://synthetic.invalid",
      token: stalled === "token" ? waitForever : async () => ({ access_token: "synthetic", issued_at: 0, access_token_expires_at: Date.now() + 100000 }),
      refresh: waitForever,
      fetch: async () => { calls++; return new Response(null, { status: 401 }); },
    }), error => error === timeout);
    assert.equal(calls, stalled === "token" ? 0 : 1);
  }
});
