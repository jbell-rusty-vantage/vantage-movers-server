import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { CSI_TOOLS } from "../../../config/domain/salesIntelligence";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { payloadHash } from "../transactions";
import { z } from "zod";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION } from "./contracts";
import { invokeIntelligenceAgent, DEFAULT_RUNTIME_LIMITS } from "./runtime";
import type { ReadContent } from "./reads";

const handlerPath = resolve("../vantage-movers-mcp/lib/intelligence/handler.ts");
const runId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const subject = "number:111111111111111111111111";
const schemaDigest = payloadHash(z.toJSONSchema(intelligenceEnvelopeSchema));
const pinnedPrompt = `${CSI_PROMPT_TEMPLATE}\n\nTrusted subject binding (data): ${JSON.stringify({ subject_key: subject })}`;
const validEnvelope = {
  schema_version: "csi-envelope-v1", summary: { overview: "No supported findings in synthetic evidence.", customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", finding_keys: [] },
  findings: [], next_step_suggestion: null, owner_instruction_assessments: [],
};

test("actual MCP transport and ToolLoopAgent enforce bounded submit repair", {
  skip: !existsSync(handlerPath) ? "Requires sibling MCP checkout" : false, timeout: 120_000,
}, async t => {
  const { createIntelligenceHandler } = await import(pathToFileURL(handlerPath).href);
  const { MockLanguageModelV4 } = await import("ai/test");
  for (const scenario of ["server-invalid", "sdk-invalid", "exhausted", "scope-error", "old-prompt", "repair-read", "wrong-receipt", "transport-error"] as const) {
    await t.test(scenario, async () => {
      let providerCalls = 0, submitCalls = 0;
      const reads: string[] = [], failures: number[] = [];
      // Old pinned runs remain byte-for-byte retrievable after a template update.
      const prompt = scenario === "old-prompt" ? "Synthetic previously pinned prompt." : pinnedPrompt;
      const env = { SALES_INTELLIGENCE_SCOPED_API_KEY: "synthetic-key", SALES_INTELLIGENCE_RUN_TOKEN_SECRET: "synthetic-signature-secret-32-characters", SALES_INTELLIGENCE_DEPLOYMENT_ID: "synthetic", SALES_INTELLIGENCE_DATABASE: "test_csi_prompt", SALES_INTELLIGENCE_API_BASE_URL: "http://127.0.0.1:1" };
      const handler = createIntelligenceHandler({ env, api: async (_credentials: unknown, action: string, body: { tool?: string; idempotency_key?: string; envelope?: unknown } | undefined) => {
        if (action === "submission") return { run_id: runId, status: "running", submission: null, prompt_context: {
          rendered_prompt: prompt, prompt_version: CSI_PROMPT_VERSION, schema_version: "csi-envelope-v1", schema_digest: schemaDigest, mode: "initial",
        } };
        if (action === "submit") {
          submitCalls++;
          assert.equal(body?.idempotency_key, runId);
          if (scenario === "scope-error") {
            const { IntelligenceError } = await import(pathToFileURL(resolve("../vantage-movers-mcp/lib/intelligence/auth.ts")).href);
            throw new IntelligenceError("EVIDENCE_SCOPE_INVALID", 422);
          }
          // Registration catches the authoritative Zod error and forwards paths.
          intelligenceEnvelopeSchema.parse(body?.envelope);
          if (scenario === "wrong-receipt") return { run_id: "different-run", submission_id: "submission-1", application_job_id: "application-1", status: "submitted" };
          return { run_id: runId, submission_id: "submission-1", application_job_id: "application-1", status: "submitted" };
        }
        const name = action === "context" ? "get_intelligence_context" : body?.tool;
        assert(name);
        reads.push(name);
        const data: ReadContent = {
          page: { records: [], next_cursor: null, complete: true, missing_ranges: [] },
          coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
          allowed_followup_ids: [], speaker_refs: [], instructions: [],
        };
        return { snapshot_id: `captured-${name}`, data };
      } });
      const server = createServer(async (req, res) => {
        try {
          const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
          const body = Buffer.concat(parts).toString();
          if (scenario === "transport-error" && body && JSON.parse(body).params?.name === "submit_intelligence_analysis") {
            submitCalls++;
            res.writeHead(503); res.end("Synthetic ambiguous submit delivery"); return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
          const response = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(500); res.end("Synthetic transport failure"); }
      }).listen(0, "127.0.0.1");
      await new Promise<void>(r => server.once("listening", r));
      const address = server.address(); assert(address && typeof address !== "string");
      const now = Math.floor(Date.now() / 1000);
      const claims = { version: "csi-run-token-v1", run_id: runId, subject_key: subject, tools: [...CSI_TOOLS], deployment: "synthetic", database: "test_csi_prompt", aud: "vantage-csi", nonce: "synthetic-nonce-12345", iat: now, exp: now + 300, lease_epoch: 1 };
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const token = `${payload}.${createHmac("sha256", env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET).update(payload).digest("base64url")}`;
      const model = new MockLanguageModelV4({ doGenerate: async input => {
        providerCalls++;
        const serialized = JSON.stringify(input.prompt);
        assert(serialized.includes("Citation inventory (data)"));
        assert(serialized.includes("captured-search_bookings"));
        assert(serialized.includes(prompt.split("\n")[0]));
        if (providerCalls === 1) {
          assert.equal(input.toolChoice?.type, "required");
          assert.equal(input.tools?.length, CSI_TOOLS.length);
        } else {
          assert.deepEqual(input.toolChoice, { type: "tool", toolName: "submit_intelligence_analysis" });
          assert.deepEqual(input.tools?.map(tool => tool.type === "function" ? tool.name : "other"), ["submit_intelligence_analysis"]);
          if (scenario === "server-invalid") assert(serialized.includes("summary.finding_keys.0"));
        }
        const invalid = scenario === "exhausted" || (providerCalls === 1 && ["server-invalid", "sdk-invalid", "repair-read"].includes(scenario));
        const envelope = invalid ? scenario === "sdk-invalid" ? { bad: true } : { ...validEnvelope, summary: { ...validEnvelope.summary, finding_keys: ["missing"] } } : validEnvelope;
        const repairRead = scenario === "repair-read" && providerCalls === 2;
        return {
          content: [{ type: "tool-call", toolCallId: `call-${providerCalls}`, toolName: repairRead ? "get_intelligence_context" : "submit_intelligence_analysis", input: JSON.stringify(repairRead ? {} : { idempotency_key: runId, envelope }) }],
          finishReason: { unified: "tool-calls", raw: "synthetic" },
          usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } }, warnings: [],
        };
      } });
      try {
        const invocation = invokeIntelligenceAgent({ endpoint: `http://127.0.0.1:${address.port}/api/intelligence-mcp`, key: env.SALES_INTELLIGENCE_SCOPED_API_KEY,
          token, run_id: runId, model_id: "synthetic-model", prompt, schema_digest: schemaDigest,
          conversation_ids: [], interaction_ids: [], limits: DEFAULT_RUNTIME_LIMITS, model,
          beforeProvider: async () => undefined, onStep: async step => { failures.push(step.schema_failures); },
        });
        if (["scope-error", "wrong-receipt", "transport-error"].includes(scenario)) await assert.rejects(invocation);
        else if (scenario === "exhausted" || scenario === "repair-read") await assert.rejects(invocation, /schema_exhausted/);
        else assert.equal((await invocation).status, "submitted");
        const expectedCalls = ["old-prompt", "scope-error", "wrong-receipt", "transport-error"].includes(scenario) ? 1 : 2;
        assert.equal(providerCalls, expectedCalls);
        assert.equal(submitCalls, scenario === "sdk-invalid" || scenario === "repair-read" ? 1 : expectedCalls);
        assert.deepEqual(reads, ["get_intelligence_context", "list_number_activity", "search_leads", "search_bookings"]);
        if (scenario === "server-invalid" || scenario === "sdk-invalid") assert.deepEqual(failures, [1, 1]);
        if (scenario === "exhausted") assert.deepEqual(failures, [1, 2]);
      } finally {
        await new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); });
      }
    });
  }
});
