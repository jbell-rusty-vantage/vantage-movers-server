import type { MCPClient, CallToolResult } from "@ai-sdk/mcp" with { "resolution-mode": "import" };
import type { LanguageModel, LanguageModelUsage, ToolSet } from "ai" with { "resolution-mode": "import" };
import { z } from "zod";
import { CSI_TOOLS } from "../../../config/domain/salesIntelligence";
import { payloadHash } from "../transactions";
import { CSI_PROMPT_VERSION } from "./contracts";
import { readContentSchema } from "./reads";
import type { SubmissionReceipt } from "./submit";
import type { IntelligenceRead } from "./contracts";
import { renderIntelligenceEvidencePrompt, type CapturedPromptPage } from "./prompt";

export const runtimeLimitsSchema = z.object({ steps: z.number().int().min(1).max(40), context_tokens: z.number().int().min(1000).max(200_000),
  output_tokens: z.number().int().min(100).max(16_000), total_input_tokens: z.number().int().positive(), total_output_tokens: z.number().int().positive(),
  elapsed_ms: z.number().int().min(1000).max(180_000), pages: z.number().int().min(1).max(100) }).strict();
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;
// Fund the full step ceiling even when usage is reported at the per-step bounds.
// Admission still reserves this complete budget against the Owner's policy.
//
// Sized for the contract's target (17 §8): evidence is captured before the
// provider loop, so an ordinary conversation submits in one step with at most
// one repair. Twelve steps reserved 1.5M input tokens per recording, which
// exceeded the default 25-cent per-recording ceiling at list pricing and paused
// every conversation before any model call. `elapsed_ms` stays inside the
// deployed 120 s function; the previous 180 s could never complete in a cron.
// `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON` still overrides all of these.
export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = { steps: 4, context_tokens: 128_000, output_tokens: 8000,
  total_input_tokens: 512_000, total_output_tokens: 32_000, elapsed_ms: 95_000, pages: 100 };
export class IntelligenceRuntimeError extends Error {
  constructor(readonly reason: "incomplete_coverage" | "bounds_exhausted" | "schema_exhausted" | "receipt_missing" | "contract_mismatch" | "eligibility_changed") { super(reason); }
}
const receiptSchema = z.object({ run_id: z.string(), submission_id: z.string(), application_job_id: z.string(), status: z.literal("submitted") }).strict();
function resultValue(result: CallToolResult): unknown {
  if (result.isError) throw new IntelligenceRuntimeError("contract_mismatch");
  const parts = result.content;
  if (!Array.isArray(parts) || parts.length !== 1 || parts[0].type !== "text") throw new IntelligenceRuntimeError("contract_mismatch");
  return JSON.parse(parts[0].text);
}
export type InvocationStep = { step: number; usage: LanguageModelUsage; actual_cents: number | null; schema_failures: number };
export type InvocationInput = {
  endpoint: string; key: string; token: string; run_id: string; model_id: string; gateway_key?: string;
  prompt: string; schema_digest: string; conversation_ids: string[]; interaction_ids: string[];
  limits: RuntimeLimits; model?: LanguageModel; schema_failures?: number;
  original_reads?: Array<IntelligenceRead | { tool: "get_intelligence_context"; args: Record<string, never> }>;
  beforeProvider: () => Promise<void>; onStep: (step: InvocationStep) => Promise<void>; onInvocationComplete?: () => void;
};
/** Byte count is a conservative token ceiling, including tool definitions and accumulated messages. */
export const contextTokenCeiling = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
export function billedCents(metadata: unknown): number | null {
  const parsed = z.object({ gateway: z.object({ cost: z.union([z.number(), z.string()]).optional(), totalCost: z.union([z.number(), z.string()]).optional() }) }).safeParse(metadata);
  if (!parsed.success) return null;
  const cost = parsed.data.gateway.cost ?? parsed.data.gateway.totalCost;
  if (cost === undefined || !Number.isFinite(Number(cost)) || Number(cost) < 0) return null;
  return Math.ceil(Number(cost) * 100);
}
/** Every evidence read and exposed tool uses the authenticated remote MCP transport. No direct domain tool. */
export async function invokeIntelligenceAgent(input: InvocationInput): Promise<SubmissionReceipt> {
  const { createMCPClient } = await import("@ai-sdk/mcp");
  const { ToolLoopAgent, isStepCount, tool } = await import("ai");
  const { createGateway } = await import("@ai-sdk/gateway");
  const limits = runtimeLimitsSchema.parse(input.limits), uncertain = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(limits.elapsed_ms), uncertain.signal]);
  const endpoint = new URL(input.endpoint);
  if (endpoint.pathname !== "/api/intelligence-mcp" || endpoint.username || endpoint.password || endpoint.search ||
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname)))) throw new IntelligenceRuntimeError("contract_mismatch");
  let client: MCPClient | undefined;
  try {
    client = await createMCPClient({ transport: { type: "http", url: endpoint.href,
      headers: { "x-api-secret": input.key, "x-vantage-intelligence-run-token": input.token } }, maxRetries: 0,
      initializationOptions: { signal, timeout: limits.elapsed_ms }, onUncaughtError: () => undefined });
    const options = { signal, timeout: limits.elapsed_ms };
    const prompt = await client.experimental_getPrompt({ name: CSI_PROMPT_VERSION, arguments: {}, options });
    const resource = await client.readResource({ uri: "csi://schemas/csi-envelope-v1", options });
    const content = resource.contents[0];
    if (prompt.messages.length !== 1 || prompt.messages[0].content.type !== "text" || prompt.messages[0].content.text !== input.prompt ||
      !content || !("text" in content) || typeof content.text !== "string" || payloadHash(JSON.parse(content.text)) !== input.schema_digest) throw new IntelligenceRuntimeError("contract_mismatch");
    const definitions = await client.listTools({ options });
    if (definitions.nextCursor || definitions.tools.length !== CSI_TOOLS.length || definitions.tools.some(t => !(CSI_TOOLS as readonly string[]).includes(t.name))) throw new IntelligenceRuntimeError("contract_mismatch");
    const evidence: CapturedPromptPage[] = [];
    let pages = 0;
    const readPages = async (name: string, args: Record<string, unknown>) => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        signal.throwIfAborted();
        if (++pages > limits.pages) throw new IntelligenceRuntimeError("incomplete_coverage");
        const value = resultValue(await client!.callTool({ name, arguments: { ...args, ...(cursor ? { cursor } : {}) }, options }));
        const captured = z.object({ snapshot_id: z.string(), data: readContentSchema }).passthrough().parse(value);
        evidence.push(captured);
        if (contextTokenCeiling({ prompt: input.prompt, evidence, tools: definitions.tools }) > limits.context_tokens) throw new IntelligenceRuntimeError("incomplete_coverage");
        // Transcript pagination explicitly describes prior/remaining segments; other gaps are not complete processing.
        if (captured.data.page.missing_ranges.some(r => !/^segments_(before|after):\d+$/.test(r))) throw new IntelligenceRuntimeError("incomplete_coverage");
        cursor = captured.data.page.next_cursor ?? undefined;
        if (!cursor && !captured.data.page.complete && !captured.data.transcript) throw new IntelligenceRuntimeError("incomplete_coverage");
        if (captured.data.transcript && !captured.data.page.complete && !captured.data.page.missing_ranges.length) throw new IntelligenceRuntimeError("incomplete_coverage");
        if (cursor && seen.has(cursor)) throw new IntelligenceRuntimeError("incomplete_coverage");
        if (cursor) seen.add(cursor);
      } while (cursor);
    };
    if (input.original_reads) {
      for (const read of input.original_reads) {
        if (++pages > limits.pages) throw new IntelligenceRuntimeError("incomplete_coverage");
        const captured = resultValue(await client.callTool({ name: read.tool, arguments: read.args, options }));
        const value = z.object({ snapshot_id: z.string(), data: readContentSchema }).passthrough().parse(captured);
        evidence.push(value);
        if (contextTokenCeiling({ prompt: input.prompt, evidence, tools: definitions.tools }) > limits.context_tokens ||
          value.data.page.missing_ranges.some(r => !/^segments_(before|after):\d+$/.test(r)) ||
          (!value.data.page.next_cursor && !value.data.page.complete && !value.data.transcript) ||
          (value.data.transcript && !value.data.page.complete && !value.data.page.missing_ranges.length)) throw new IntelligenceRuntimeError("incomplete_coverage");
      }
    } else {
    await readPages("get_intelligence_context", {});
    await readPages("list_number_activity", { limit: 50 });
    await readPages("search_leads", { limit: 50 });
    await readPages("search_bookings", { limit: 50 });
    for (const id of input.interaction_ids) await readPages("get_rep_identity", { interaction_id: id });
    for (const id of input.conversation_ids) await readPages("get_call_transcript", { conversation_id: id, limit: 100 });
    }
    const evidencePrompt = renderIntelligenceEvidencePrompt(input.run_id, evidence);
    // Include the derived inventory and guidance before entering the provider lifecycle.
    if (contextTokenCeiling({ prompt: input.prompt, evidencePrompt, tools: definitions.tools }) > limits.context_tokens) throw new IntelligenceRuntimeError("incomplete_coverage");
    const tools: ToolSet = {};
    let receipt: SubmissionReceipt | null = null, submissions = 0, steps = 0, inTokens = 0, outTokens = 0, schemaFailures = input.schema_failures ?? 0;
    if (schemaFailures >= 2) throw new IntelligenceRuntimeError("schema_exhausted");
    // Wrap transport execution only to enforce the orchestration bounds; authority remains in CSI-17.
    for (const definition of definitions.tools) {
      const name = definition.name;
      // MCP declares schema keywords as unknown; Zod validates the remote JSON Schema at this boundary.
      const schema = z.fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      tools[name] = tool({ description: definition.description, inputSchema: schema, execute: async args => {
        signal.throwIfAborted();
        if (receipt) throw new IntelligenceRuntimeError("bounds_exhausted");
        // activeTools limits discovery, not SDK execution of an emitted hidden tool.
        // An invalid repair consumes the remaining allowance without another read.
        if (schemaFailures > 0 && name !== "submit_intelligence_analysis") {
          schemaFailures++;
          return { isError: true, content: [{ type: "text" as const,
            text: JSON.stringify({ code: "INVALID_INPUT", issues: [{ path: "tool", code: "repair_requires_submission" }] }) }] };
        }
        if (name === "submit_intelligence_analysis" && ++submissions > 2) throw new IntelligenceRuntimeError("schema_exhausted");
        try {
          const value = await client!.callTool({ name, arguments: z.record(z.string(), z.unknown()).parse(args), options });
          if (name !== "submit_intelligence_analysis") return value;
          const parsed = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })).length(1), isError: z.boolean().optional() }).passthrough().parse(value);
          const payload: unknown = JSON.parse(parsed.content[0].text);
          if (parsed.isError) {
            const error = z.object({ code: z.string() }).passthrough().safeParse(payload);
            if (error.success && error.data.code === "INVALID_INPUT") schemaFailures++;
            else uncertain.abort();
          } else {
            const accepted = receiptSchema.safeParse(payload);
            if (accepted.success && accepted.data.run_id === input.run_id) receipt = accepted.data;
            else uncertain.abort();
          }
          return value;
        } catch (error) {
          // SDK execution errors can otherwise become tool results and trigger
          // another model step after the server may already have accepted.
          if (name === "submit_intelligence_analysis") uncertain.abort();
          throw error;
        }
      } });
    }
    await input.beforeProvider();
    const model = input.model ?? createGateway({ apiKey: input.gateway_key })(input.model_id);
    const agent = new ToolLoopAgent({ model, tools, instructions: input.prompt, maxRetries: 0, maxOutputTokens: limits.output_tokens,
      stopWhen: [isStepCount(limits.steps), () => receipt !== null || submissions >= 2 || schemaFailures >= 2],
      prepareStep: ({ messages }) => {
        if (contextTokenCeiling({ prompt: input.prompt, messages, tools: definitions.tools }) > limits.context_tokens ||
          inTokens + limits.context_tokens > limits.total_input_tokens || outTokens + limits.output_tokens > limits.total_output_tokens) throw new IntelligenceRuntimeError("bounds_exhausted");
        return {
          providerOptions: { openai: { parallelToolCalls: false } },
          toolChoice: schemaFailures > 0 ? { type: "tool", toolName: "submit_intelligence_analysis" } : "required",
          ...(schemaFailures > 0 ? { activeTools: ["submit_intelligence_analysis"] } : {}),
        };
      },
      onStepEnd: async step => {
        schemaFailures += step.toolCalls.filter(call => call.invalid && (schemaFailures > 0 || call.toolName === "submit_intelligence_analysis")).length;
        steps++; inTokens += step.usage.inputTokens ?? limits.context_tokens; outTokens += step.usage.outputTokens ?? limits.output_tokens;
        await input.onStep({ step: steps, usage: step.usage, actual_cents: billedCents(step.providerMetadata), schema_failures: schemaFailures });
      },
    });
    await agent.generate({ prompt: evidencePrompt, abortSignal: signal });
    input.onInvocationComplete?.();
    if (!receipt) throw new IntelligenceRuntimeError(submissions >= 2 || schemaFailures >= 2 ? "schema_exhausted" : "receipt_missing");
    return receipt;
  } finally { await client?.close().catch(() => undefined); }
}
