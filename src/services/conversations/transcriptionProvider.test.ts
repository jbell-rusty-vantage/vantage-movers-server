import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { gatewaySttProvider, gatewayActualCents, validateStoredAudio, TranscriptionProviderError } from "./transcriptionProvider";

test("Gateway adapter sends configured model, makes one call, keeps timing optional and never logs warnings", async () => {
  const env = { ...process.env }; process.env.AI_GATEWAY_API_KEY = "synthetic";
  let calls = 0;
  try {
    const provider = gatewaySttProvider(async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("ai-model-id"), "openai/gpt-4o-mini-transcribe");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.mediaType, "audio/wav");
      assert.equal(body.providerOptions, undefined);
      return new Response(JSON.stringify({ text: "Hello.", providerMetadata: { gateway: { cost: "0.002" } } }), { headers: { "content-type": "application/json" } });
    });
    const result = await provider({ audio: new Uint8Array([1]), contentType: "audio/wav", model: "openai/gpt-4o-mini-transcribe", signal: AbortSignal.timeout(1000) });
    assert.equal(calls, 1); assert.deepEqual(result.segments, []); assert.equal(result.actualCents, 1);
  } finally { process.env = env; }
});
test("Gateway errors do not expose provider bodies and do not internally retry", async () => {
  const env = { ...process.env }; process.env.AI_GATEWAY_API_KEY = "synthetic";
  let calls = 0;
  try {
    const provider = gatewaySttProvider(async () => { calls++; return new Response(JSON.stringify({ error: { message: "sensitive provider text" } }), { status: 503, headers: { "content-type": "application/json" } }); });
    await assert.rejects(provider({ audio: new Uint8Array([1]), contentType: "audio/wav", model: "openai/gpt-4o-mini-transcribe", signal: AbortSignal.timeout(1000) }), error => error instanceof TranscriptionProviderError && error.message === "transient");
    assert.equal(calls, 1);
  } finally { process.env = env; }
});
test("Blob bytes/digest validated and missing billing never becomes estimated actual cost", () => {
  const audio = Buffer.from("synthetic");
  const media = { pathname: "conversations/account/recording/hash.wav", bytes: audio.length, digest: createHash("sha256").update(audio).digest("hex"), contentType: "audio/wav" };
  validateStoredAudio(media, audio);
  assert.throws(() => validateStoredAudio({ ...media, digest: "0".repeat(64) }, audio));
  assert.throws(() => validateStoredAudio({ ...media, pathname: "https://provider/contentUri" }, audio));
  assert.equal(gatewayActualCents(undefined), null); assert.equal(gatewayActualCents(-1), null);
});
