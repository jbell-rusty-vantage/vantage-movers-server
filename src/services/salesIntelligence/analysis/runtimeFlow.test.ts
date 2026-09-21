import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION } from "./contracts";
import { intelligenceSchemaDigest } from "./schemaArtifact";
import { modelToolsForRun, permittedToolsForRun } from "./tools";
import { invokeIntelligenceAgent, DEFAULT_RUNTIME_LIMITS } from "./runtime";
import type { ReadContent } from "./reads";

const handlerPath = resolve("../vantage-movers-mcp/lib/intelligence/handler.ts");
const runId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const subject = "number:111111111111111111111111";
const schemaDigest = intelligenceSchemaDigest();
// v2 pins the template alone; the binding rides in the evidence message.
const pinnedPrompt = CSI_PROMPT_TEMPLATE;
const preamble = `Trusted subject binding (data): ${JSON.stringify({ subject_key: subject })}`;
const grant = { mode: "number_refresh" as const, discovery_reason: null };
const permittedTools = permittedToolsForRun(grant);
const modelTools = modelToolsForRun(grant);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
type PromptMessage = { role: string; content: unknown };
const textOf = (messages: readonly PromptMessage[]) => messages.flatMap(message =>
  typeof message.content === "string" ? [message.content]
    : Array.isArray(message.content) ? message.content.map(part => part && typeof part === "object" && "text" in part ? String(part.text) : "")
    : []).join(" ");
/** Per-scenario wire sizes, printed at the end so a change in either direction is visible (22 §4). */
const measured: Array<{ scenario: string; tools: number; instructions: number; evidence: number }> = [];
const validEnvelope = {
  schema_version: "csi-envelope-v1", summary: { overview: "No supported findings in synthetic evidence.", customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", finding_keys: [] },
  findings: [], next_step_suggestion: null, owner_instruction_assessments: [],
};

test("actual MCP transport and ToolLoopAgent enforce bounded submit repair", {
  skip: !existsSync(handlerPath) ? "Requires sibling MCP checkout" : false, timeout: 120_000,
}, async t => {
  const { createIntelligenceHandler } = await import(pathToFileURL(handlerPath).href);
  const { MockLanguageModelV4 } = await import("ai/test");
  for (const scenario of ["server-invalid", "sdk-invalid", "exhausted", "scope-error", "scope-repaired", "old-prompt", "repair-read", "wrong-receipt", "transport-error"] as const) {
    await t.test(scenario, async () => {
      let providerCalls = 0, submitCalls = 0;
      const reads: string[] = [], failures: number[] = [], rejected: string[][] = [];
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
          // A citation-membership refusal is a definite rejection with nothing
          // committed, so the model gets its one repair; issue paths tell it
          // which citation to correct (22 §4.4).
          if (scenario === "scope-error" || (scenario === "scope-repaired" && submitCalls === 1)) {
            const { IntelligenceError } = await import(pathToFileURL(resolve("../vantage-movers-mcp/lib/intelligence/auth.ts")).href);
            throw new IntelligenceError("EVIDENCE_SCOPE_INVALID", 422, [{ path: "findings.0.evidence.0.snapshot_id", code: "snapshot_not_captured" }]);
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
      const claims = { version: "csi-run-token-v1", run_id: runId, subject_key: subject, tools: permittedTools, deployment: "synthetic", database: "test_csi_prompt", aud: "vantage-csi", nonce: "synthetic-nonce-12345", iat: now, exp: now + 300, lease_epoch: 1 };
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
          // The model sees only what is still useful after capture; authority
          // stays the wider permitted list the token carries (22 §4.1).
          assert.deepEqual(input.tools?.map(tool => tool.type === "function" ? tool.name : "other").sort(), [...modelTools].sort());
          assert(modelTools.length < permittedTools.length);
          const system = input.prompt.filter(message => message.role === "system");
          const evidence = input.prompt.filter(message => message.role !== "system");
          // The pinned prompt is the shared, cacheable prefix: nothing per-run
          // may appear in it, and the per-run binding must be in the evidence.
          assert.equal(textOf(system).includes(runId), false, "run id leaked into the cacheable prefix");
          assert.equal(textOf(system).includes("subject_key"), false, "subject binding leaked into the cacheable prefix");
          if (scenario !== "old-prompt") assert(textOf(evidence).includes(preamble), "subject binding missing from the evidence message");
          measured.push({ scenario, tools: bytes(input.tools), instructions: bytes(system), evidence: bytes(evidence) });
        } else {
          assert.deepEqual(input.toolChoice, { type: "tool", toolName: "submit_intelligence_analysis" });
          assert.deepEqual(input.tools?.map(tool => tool.type === "function" ? tool.name : "other"), ["submit_intelligence_analysis"]);
          if (scenario === "server-invalid") assert(serialized.includes("summary.finding_keys.0"));
          // The repair step must be able to see which citation was refused.
          if (scenario.startsWith("scope-")) assert(serialized.includes("findings.0.evidence.0.snapshot_id"), "evidence issue paths never reached the repair");
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
          token, run_id: runId, model_id: "synthetic-model", prompt, prompt_version: CSI_PROMPT_VERSION, schema_digest: schemaDigest,
          evidence_preamble: scenario === "old-prompt" ? "" : preamble,
          permitted_tools: permittedTools, model_tools: modelTools,
          conversation_ids: [], interaction_ids: [], limits: DEFAULT_RUNTIME_LIMITS, model,
          beforeProvider: async () => undefined, onStep: async step => { failures.push(step.schema_failures); rejected.push(step.rejected_paths); },
        });
        if (["wrong-receipt", "transport-error"].includes(scenario)) await assert.rejects(invocation);
        else if (["exhausted", "repair-read", "scope-error"].includes(scenario)) await assert.rejects(invocation, /schema_exhausted/);
        else assert.equal((await invocation).status, "submitted");
        const expectedCalls = ["old-prompt", "wrong-receipt", "transport-error"].includes(scenario) ? 1 : 2;
        assert.equal(providerCalls, expectedCalls);
        assert.equal(submitCalls, scenario === "sdk-invalid" || scenario === "repair-read" ? 1 : expectedCalls);
        assert.deepEqual(reads, ["get_intelligence_context", "list_number_activity", "search_leads", "search_bookings"]);
        // Capture uses the same run token, so the permitted list must cover
        // every read the worker itself makes before the model runs.
        for (const name of reads) assert(permittedTools.includes(name as (typeof permittedTools)[number]), name);
        if (scenario === "server-invalid" || scenario === "sdk-invalid") assert.deepEqual(failures, [1, 1]);
        if (scenario === "exhausted" || scenario === "scope-error") assert.deepEqual(failures, [1, 2]);
        // One refused citation, one corrected resubmission, one receipt.
        if (scenario === "scope-repaired") assert.deepEqual(failures, [1, 1]);
        if (scenario.startsWith("scope-")) assert.deepEqual(rejected[0], ["findings.0.evidence.0.snapshot_id:snapshot_not_captured"]);
      } finally {
        await new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); });
      }
    });
  }
  for (const row of measured)
    console.log(`  bytes ${row.scenario.padEnd(16)} tools ${String(row.tools).padStart(6)}  instructions ${String(row.instructions).padStart(5)}  evidence ${String(row.evidence).padStart(6)}`);
});
