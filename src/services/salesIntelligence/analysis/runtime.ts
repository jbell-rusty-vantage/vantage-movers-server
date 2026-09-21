import type { MCPClient, CallToolResult } from "@ai-sdk/mcp" with { "resolution-mode": "import" };
import type { LanguageModel, LanguageModelUsage, ToolSet } from "ai" with { "resolution-mode": "import" };
import { z } from "zod";
import { payloadHash } from "../transactions";
import { schemaArtifactForDigest } from "./schemaArtifact";
import { readContentSchema } from "./reads";
import type { SubmissionReceipt } from "./submit";
import type { IntelligenceRead } from "./contracts";
import { renderIntelligenceEvidencePrompt, type CapturedPromptPage } from "./prompt";

export const runtimeLimitsSchema = z.object({ steps: z.number().int().min(1).max(40), context_tokens: z.number().int().min(1000).max(200_000),
  output_tokens: z.number().int().min(100).max(16_000), total_input_tokens: z.number().int().positive(), total_output_tokens: z.number().int().positive(),
  elapsed_ms: z.number().int().min(1000).max(240_000), pages: z.number().int().min(1).max(100) }).strict();
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;
// Fund the full step ceiling even when usage is reported at the per-step bounds.
// Admission still reserves this complete budget against the Owner's policy.
//
// Sized for the contract's target (17 §8): evidence is captured before the
// provider loop, so an ordinary conversation submits in one step with at most
// one repair. Twelve steps reserved 1.5M input tokens per recording, which
// exceeded the default 25-cent per-recording ceiling at list pricing and paused
// every conversation before any model call. `elapsed_ms` is sized for one
// generation with room for a repair and is checked against
// `CSI_FUNCTION_MAX_DURATION_MS`, not squeezed under a smaller function: 18
// lowered it to 95 s only because the deployed function allowed 120 s, and a
// run needing longer was killed with its started reservation stranded (22 §1).
// `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON` still overrides all of these.
export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = { steps: 4, context_tokens: 128_000, output_tokens: 8000,
  total_input_tokens: 512_000, total_output_tokens: 32_000, elapsed_ms: 200_000, pages: 100 };
export class IntelligenceRuntimeError extends Error {
  constructor(readonly reason: "incomplete_coverage" | "bounds_exhausted" | "schema_exhausted" | "receipt_missing" | "contract_mismatch" | "eligibility_changed") { super(reason); }
}
const receiptSchema = z.object({ run_id: z.string(), submission_id: z.string(), application_job_id: z.string(), status: z.literal("submitted") }).strict();
export function resultValue(result: CallToolResult): unknown {
  const parts = result.content;
  if (!Array.isArray(parts) || parts.length !== 1 || parts[0].type !== "text") throw new IntelligenceRuntimeError("contract_mismatch");
  const value: unknown = JSON.parse(parts[0].text);
  if (result.isError) {
    const error = z.object({ code: z.string() }).passthrough().safeParse(value);
    if (error.success && ["INTELLIGENCE_UNAVAILABLE", "PROVIDER_READ_UNAVAILABLE", "RATE_LIMITED"].includes(error.data.code)) {
      // An MCP tool reports downstream failures inside a successful transport
      // response. Preserve their retry classification instead of permanently
      // pausing a valid contract before the provider has even started.
      throw Object.assign(new Error(error.data.code), { statusCode: error.data.code === "RATE_LIMITED" ? 429 : 503 });
    }
    throw new IntelligenceRuntimeError("contract_mismatch");
  }
  return value;
}
export type InvocationStep = { step: number; usage: LanguageModelUsage; actual_cents: number | null; schema_failures: number;
  /** Prefix tokens the provider reported serving from its cache, or null when it reports none (22 §4.3). */
  cached_input_tokens: number | null;
  /** Argument paths the server rejected on an INVALID_INPUT submission, for the first-submit failure classification (22 §4.4). */
  rejected_paths: string[] };
export type InvocationInput = {
  endpoint: string; key: string; token: string; run_id: string; model_id: string; gateway_key?: string;
  prompt: string; prompt_version: string; schema_digest: string; conversation_ids: string[]; interaction_ids: string[];
  /** Exactly the tools this run's token carries; `listTools` must return this set. */
  permitted_tools: readonly string[];
  /** The subset the model is shown. Authority is still `permitted_tools`. */
  model_tools: readonly string[];
  /** Per-run text opening the evidence message; empty for a v1-pinned run. */
  evidence_preamble: string;
  limits: RuntimeLimits; model?: LanguageModel; schema_failures?: number;
  original_reads?: Array<IntelligenceRead | { tool: "get_intelligence_context"; args: Record<string, never> }>;
  beforeProvider: () => Promise<void>; onStep: (step: InvocationStep) => Promise<void>; onInvocationComplete?: () => void;
};
/** Byte count is a conservative token ceiling, including tool definitions and accumulated messages. */
export const contextTokenCeiling = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
/**
 * Cached prefix tokens as the Gateway and the OpenAI provider report them.
 * Absent means "not reported", never "zero saved": 22 §4.3 asks for the number
 * to be recorded when it exists and for its absence to be stated, not assumed.
 */
export function cachedInputTokens(usage: LanguageModelUsage, metadata: unknown): number | null {
  const fromUsage = (usage as { inputTokenDetails?: { cacheReadTokens?: number } }).inputTokenDetails?.cacheReadTokens;
  if (typeof fromUsage === "number" && Number.isFinite(fromUsage)) return fromUsage;
  const parsed = z.object({ openai: z.object({ cachedPromptTokens: z.number().optional() }).partial().optional(),
    gateway: z.object({ cachedInputTokens: z.number().optional() }).partial().optional() }).safeParse(metadata);
  if (!parsed.success) return null;
  const value = parsed.data.openai?.cachedPromptTokens ?? parsed.data.gateway?.cachedInputTokens;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
/**
 * Submit rejections the server made definitively, with nothing committed, and
 * which the model may therefore correct within its one repair.
 *
 * `INVALID_INPUT` is the envelope's shape. `EVIDENCE_SCOPE_INVALID` is citation
 * membership: the submission was refused outright, so retrying a corrected
 * envelope is as safe as it is for a shape error. Treating it as uncertain
 * instead aborted the run over a fixable citation (22 §4.4). Every other code
 * leaves delivery in doubt and must still stop for receipt recovery.
 */
export const REPAIRABLE_SUBMIT_REJECTIONS = ["INVALID_INPUT", "EVIDENCE_SCOPE_INVALID"] as const;
export const isRepairableRejection = (code: string) => (REPAIRABLE_SUBMIT_REJECTIONS as readonly string[]).includes(code);
/** Bounded `path:code` pairs from a definite submit rejection, for failure classification. */
export function rejectedIssuePaths(payload: unknown): string[] {
  const parsed = z.object({ code: z.string(), issues: z.array(z.object({ path: z.string(), code: z.string() }).partial()).optional() }).safeParse(payload);
  if (!parsed.success || !isRepairableRejection(parsed.data.code)) return [];
  const paths = (parsed.data.issues ?? []).flatMap(issue => issue.path ? [`${issue.path}:${issue.code ?? "invalid"}`.slice(0, 200)] : []).slice(0, 16);
  // A rejection with no usable paths is still worth counting by its code, or
  // the classification would silently omit the cases that explain least.
  return paths.length ? paths : [`:${parsed.data.code}`];
}
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
  const { ToolLoopAgent, isStepCount, tool, jsonSchema } = await import("ai");
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
    // The run pins its prompt version and its schema rendering. Both are
    // resolved from the run, not from what this deployment happens to consider
    // current, so a replay reproduces its parent and a digest this deployment
    // cannot serve is a loud `contract_mismatch` (22 §4.2, §4.3).
    const artifact = schemaArtifactForDigest(input.schema_digest);
    if (!artifact) throw new IntelligenceRuntimeError("contract_mismatch");
    const prompt = await client.experimental_getPrompt({ name: input.prompt_version, arguments: {}, options });
    const resource = await client.readResource({ uri: artifact.uri, options });
    const content = resource.contents[0];
    if (prompt.messages.length !== 1 || prompt.messages[0].content.type !== "text" || prompt.messages[0].content.text !== input.prompt ||
      !content || !("text" in content) || typeof content.text !== "string" || payloadHash(JSON.parse(content.text)) !== input.schema_digest) throw new IntelligenceRuntimeError("contract_mismatch");
    const definitions = await client.listTools({ options });
    // The MCP registers exactly the verified token's tools. Anything else means
    // the two sides disagree about this run's authority.
    const permitted = new Set(input.permitted_tools);
    if (definitions.nextCursor || definitions.tools.length !== permitted.size || definitions.tools.some(t => !permitted.has(t.name))) throw new IntelligenceRuntimeError("contract_mismatch");
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
    const evidencePrompt = renderIntelligenceEvidencePrompt(input.run_id, evidence, input.evidence_preamble);
    // Include the derived inventory and guidance before entering the provider lifecycle.
    if (contextTokenCeiling({ prompt: input.prompt, evidencePrompt, tools: definitions.tools }) > limits.context_tokens) throw new IntelligenceRuntimeError("incomplete_coverage");
    const tools: ToolSet = {};
    let receipt: SubmissionReceipt | null = null, submissions = 0, steps = 0, inTokens = 0, outTokens = 0, schemaFailures = input.schema_failures ?? 0;
    const rejectedPaths: string[] = [];
    if (schemaFailures >= 2) throw new IntelligenceRuntimeError("schema_exhausted");
    // Wrap transport execution only to enforce the orchestration bounds; authority remains in CSI-17.
    for (const definition of definitions.tools) {
      const name = definition.name;
      // MCP declares schema keywords as unknown; Zod validates the remote JSON Schema at this boundary.
      const schema = z.fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      // The MCP's JSON Schema goes to the provider verbatim. Deriving it back
      // from Zod would re-inline the `$defs` the compaction just hoisted (the
      // SDK's Zod path converts with `reused: "inline"`), throwing the saving
      // away on the wire while the contract stayed identical. Zod still
      // validates every call; only the published shape passes through.
      const inputSchema = jsonSchema(definition.inputSchema as Record<string, unknown>, {
        validate: (value: unknown) => {
          const parsed = schema.safeParse(value);
          return parsed.success ? { success: true as const, value: parsed.data } : { success: false as const, error: parsed.error };
        },
      });
      tools[name] = tool({ description: definition.description, inputSchema, execute: async args => {
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
            if (error.success && isRepairableRejection(error.data.code)) { schemaFailures++; rejectedPaths.push(...rejectedIssuePaths(payload)); }
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
          // Every pre-captured read was followed to the end of its pagination,
          // so re-offering the search and activity tools only buys wandering
          // and their definitions on every step. Authority is unchanged: an
          // emitted hidden tool is still refused by the execute wrapper.
          activeTools: schemaFailures > 0 ? ["submit_intelligence_analysis"] : [...input.model_tools],
        };
      },
      onStepEnd: async step => {
        schemaFailures += step.toolCalls.filter(call => call.invalid && (schemaFailures > 0 || call.toolName === "submit_intelligence_analysis")).length;
        steps++; inTokens += step.usage.inputTokens ?? limits.context_tokens; outTokens += step.usage.outputTokens ?? limits.output_tokens;
        await input.onStep({ step: steps, usage: step.usage, actual_cents: billedCents(step.providerMetadata),
          schema_failures: schemaFailures, cached_input_tokens: cachedInputTokens(step.usage, step.providerMetadata),
          rejected_paths: rejectedPaths.splice(0) });
      },
    });
    await agent.generate({ prompt: evidencePrompt, abortSignal: signal });
    input.onInvocationComplete?.();
    if (!receipt) throw new IntelligenceRuntimeError(submissions >= 2 || schemaFailures >= 2 ? "schema_exhausted" : "receipt_missing");
    return receipt;
  } finally { await client?.close().catch(() => undefined); }
}
