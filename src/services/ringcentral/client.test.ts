import assert from "node:assert/strict";
import { test } from "node:test";
import { ringCentralReadResponse } from "./client";

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
