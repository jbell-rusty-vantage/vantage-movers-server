/**
 * Connect to /api/intelligence-mcp the same way CSI-13 invokeIntelligenceAgent
 * does: prepareIntelligenceRun, then createMCPClient with both dedicated headers.
 *
 * Handshake only: prompt, schema resource, twelve-tool discovery, and one
 * get_intelligence_context read. No model, no Gateway, no submit.
 *
 *   pnpm probe:intelligence-mcp
 *
 * Deployed MCP must share scoped key, run-token secret, deployment, and
 * database with this process, and SALES_INTELLIGENCE_API_BASE_URL must be the
 * main server that owns the prepared run. A local run against a deployed MCP
 * that routes back to a different API is refused.
 */
import mongoose from "mongoose";
import { CSI_TOOLS } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName, isTestMode } from "../src/config/domain/runtime";
import { connectMongo, withTransaction } from "../src/db";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { CSI_PROMPT_VERSION } from "../src/services/salesIntelligence/analysis/contracts";
import { prepareIntelligenceRun } from "../src/services/salesIntelligence/analysis/run";
import { claimCsiJob, enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { payloadHash } from "../src/services/salesIntelligence/transactions";

const SECRET_KEYS = [
  "SALES_INTELLIGENCE_SCOPED_API_KEY",
  "SALES_INTELLIGENCE_MCP_API_SECRET",
  "SALES_INTELLIGENCE_RUN_TOKEN_SECRET",
  "SALES_INTELLIGENCE_SCOPED_KEY_NAME",
  "SALES_INTELLIGENCE_DEPLOYMENT_ID",
  "SALES_INTELLIGENCE_MCP_ENDPOINT",
] as const;

const PROBE_MARK = "csi-mcp-agent-probe";

function trimConfiguredSecrets() {
  for (const key of SECRET_KEYS) {
    const value = process.env[key];
    if (value) process.env[key] = value.trim();
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function mcpEndpoint() {
  const endpoint = new URL(required("SALES_INTELLIGENCE_MCP_ENDPOINT"));
  if (
    endpoint.pathname !== "/api/intelligence-mcp" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname)))
  ) {
    throw new Error("SALES_INTELLIGENCE_MCP_ENDPOINT must be the dedicated /api/intelligence-mcp origin");
  }
  return endpoint;
}

function assertPairedTarget(endpoint: URL) {
  const mongo = process.env.MONGO_URI?.trim() ?? "";
  const localMongo = /127\.0\.0\.1|localhost/.test(mongo);
  const deployedMcp = endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost";
  if (deployedMcp && (localMongo || isTestMode())) {
    throw new Error(
      "Refusing a local/test run against deployed MCP. The deployed handler revalidates the run on SALES_INTELLIGENCE_API_BASE_URL.",
    );
  }
}

async function deniedWithoutRunToken(endpoint: URL, key: string) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      "x-api-secret": key,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "csi-mcp-agent-probe", version: "1.0.0" } } }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 403 || body?.code !== "RUN_SCOPE_DENIED") {
    throw new Error(`Expected RUN_SCOPE_DENIED without a run token, got HTTP ${response.status} ${JSON.stringify(body)}`);
  }
}

async function jsonOrText(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as { ok?: boolean; code?: string } };
  } catch {
    return { status: response.status, body: { code: text.slice(0, 200) } };
  }
}

async function diagnoseAuthority(endpoint: URL, key: string, token: string, runId: string) {
  const apiBase = process.env.SALES_INTELLIGENCE_API_BASE_URL?.trim() || "https://vantage-movers-main-server.vercel.app";
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-secret": key,
    "x-vantage-intelligence-run-token": token,
  };
  const api = await jsonOrText(await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/internal/sales-intelligence/runs/${runId}/submission`, {
    headers, redirect: "error", signal: AbortSignal.timeout(20_000),
  }));
  const mcp = await jsonOrText(await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "csi-mcp-agent-probe", version: "1.0.0" } } }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }));
  return { api, mcp };
}

async function cleanup(ids: { numberId?: string; jobId?: string; runId?: string }) {
  const leftovers = await getContactNumberModel().find({ search_terms: PROBE_MARK }).select("_id").lean();
  const numberIds = [...new Set([ids.numberId, ...leftovers.map((row) => String(row._id))].filter(Boolean))];
  const jobs = await getSalesIntelligenceJobModel().find({
    $or: [...(ids.jobId ? [{ _id: ids.jobId }] : []), { dedupe_key: new RegExp(`^${PROBE_MARK}:`) }],
  }).select("_id").lean();
  const jobIds = jobs.map((row) => String(row._id));
  const runs = await getIntelligenceRunModel().find({
    $or: [...(ids.runId ? [{ _id: ids.runId }] : []), { job_id: { $in: jobIds } }, { input_fingerprint: new RegExp(`^${PROBE_MARK}:`) }],
  }).select("_id").lean();
  const runOids = runs.map((row) => new mongoose.Types.ObjectId(String(row._id)));
  const jobOids = jobs.map((row) => new mongoose.Types.ObjectId(String(row._id)));
  const numberOids = numberIds.map((id) => new mongoose.Types.ObjectId(id));
  if (runOids.length) {
    await getIntelligenceEvidenceSnapshotModel().collection.deleteMany({ run_id: { $in: runOids } });
    await getIntelligenceRunModel().collection.deleteMany({ _id: { $in: runOids } });
  }
  if (jobOids.length) await getSalesIntelligenceJobModel().collection.deleteMany({ _id: { $in: jobOids } });
  if (numberOids.length) await getContactNumberModel().collection.deleteMany({ _id: { $in: numberOids } });
}

async function prepareDisposableRun() {
  const now = new Date();
  const suffix = `${Date.now().toString().slice(-7)}`;
  const e164 = `+1555010${suffix.slice(-4)}`;
  const number = await getContactNumberModel().create({
    e164,
    national_ten: e164.slice(2),
    digits_reversed: [...e164.replace(/\D/g, "")].reverse().join(""),
    first_observed_at: now,
    last_activity_at: now,
    search_terms: [PROBE_MARK],
    provider_names: [PROBE_MARK],
  });
  const job = await withTransaction((session) =>
    enqueueCsiJob(
      {
        stage: "number_refresh",
        subject_key: `number:${number._id}`,
        input_revision: 1,
        dedupe_key: `${PROBE_MARK}:${number._id}`,
        input_refs: [],
        priority: 0,
      },
      session,
    ),
  );
  const claimed = await claimCsiJob(`${PROBE_MARK}:${number._id}`, String(job._id), 300_000, "number_refresh");
  if (!claimed) throw new Error("Could not lease the disposable number_refresh job");
  const prepared = await prepareIntelligenceRun(
    { job_id: String(claimed._id), owner: claimed.lease_owner!, epoch: claimed.lease_epoch },
    {
      contact_number_id: String(number._id),
      mode: "number_refresh",
      input_fingerprint: `${PROBE_MARK}:${number._id}`,
      model_version: "probe-no-model",
    },
  );
  return { numberId: String(number._id), jobId: String(claimed._id), prepared };
}

async function connectAsIntelligenceAgent(input: {
  endpoint: URL;
  key: string;
  token: string;
  prompt: string;
  schemaDigest: string;
}) {
  const { createMCPClient } = await import("@ai-sdk/mcp");
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: input.endpoint.href,
      headers: {
        "x-api-secret": input.key,
        "x-vantage-intelligence-run-token": input.token,
      },
    },
    maxRetries: 0,
    initializationOptions: { timeout: 60_000 },
    onUncaughtError: () => undefined,
  });
  try {
    const options = { timeout: 60_000 };
    const prompt = await client.experimental_getPrompt({ name: CSI_PROMPT_VERSION, arguments: {}, options });
    const resource = await client.readResource({ uri: "csi://schemas/csi-envelope-v1", options });
    const content = resource.contents[0];
    if (
      prompt.messages.length !== 1 ||
      prompt.messages[0].content.type !== "text" ||
      prompt.messages[0].content.text !== input.prompt
    ) {
      throw new Error("Pinned prompt from MCP did not match prepareIntelligenceRun");
    }
    if (!content || !("text" in content) || typeof content.text !== "string" || payloadHash(JSON.parse(content.text)) !== input.schemaDigest) {
      throw new Error("Pinned schema digest from MCP did not match prepareIntelligenceRun");
    }
    const definitions = await client.listTools({ options });
    const names = definitions.tools.map((tool) => tool.name).sort();
    if (definitions.nextCursor || names.length !== CSI_TOOLS.length || names.some((name) => !(CSI_TOOLS as readonly string[]).includes(name))) {
      throw new Error(`Unexpected tools: ${names.join(",")}`);
    }
    const context = await client.callTool({ name: "get_intelligence_context", arguments: {}, options });
    if (context.isError) throw new Error(`get_intelligence_context failed: ${JSON.stringify(context)}`);
    const text = context.content[0] && "text" in context.content[0] ? context.content[0].text : "";
    const captured = JSON.parse(text) as { snapshot_id?: string };
    if (!captured.snapshot_id) throw new Error("get_intelligence_context did not return a captured snapshot");
    return { tools: names, schema_digest: input.schemaDigest, snapshot_id: captured.snapshot_id };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main() {
  trimConfiguredSecrets();
  const endpoint = mcpEndpoint();
  const key = required("SALES_INTELLIGENCE_MCP_API_SECRET");
  if (key === process.env.VANTAGE_API_SECRET?.trim()) {
    throw new Error("SALES_INTELLIGENCE_MCP_API_SECRET must differ from VANTAGE_API_SECRET");
  }
  assertPairedTarget(endpoint);
  await connectMongo();
  const ids: { numberId?: string; jobId?: string; runId?: string } = {};
  try {
    console.log(`Preflight ${endpoint.href} without a run token`);
    await deniedWithoutRunToken(endpoint, key);
    console.log("Preflight RUN_SCOPE_DENIED (expected)");
    const { numberId, jobId, prepared } = await prepareDisposableRun();
    ids.numberId = numberId;
    ids.jobId = jobId;
    ids.runId = prepared.run_id;
    console.log(`Prepared run ${prepared.run_id} on ${getMongoDatabaseName()}`);
    const diagnosis = await diagnoseAuthority(endpoint, key, prepared.token, prepared.run_id);
    console.log(`Main-server /submission HTTP ${diagnosis.api.status} ${diagnosis.api.body.code ?? "ok"}`);
    console.log(`MCP initialize HTTP ${diagnosis.mcp.status} ${diagnosis.mcp.body.code ?? "ok"}`);
    if (diagnosis.api.status !== 200 || diagnosis.api.body.ok === false) {
      const hint = diagnosis.api.status === 401
        ? "Production API does not recognize SALES_INTELLIGENCE_MCP_API_SECRET. Add that value to VANTAGE_SCOPED_API_KEYS as the csi-agent key and set SALES_INTELLIGENCE_SCOPED_KEY_NAME on vantage-movers-main-server."
        : diagnosis.api.body.code === "FEATURE_DISABLED"
          ? "Production API has SALES_INTELLIGENCE_ENABLED off, so GET /submission is gated."
          : "Production API must accept the scoped key plus the issued run token before MCP can complete initialize.";
      throw new Error(`Main-server /submission HTTP ${diagnosis.api.status} ${diagnosis.api.body.code ?? "Unauthorized"}. ${hint}`);
    }
    if (diagnosis.mcp.status !== 200 || diagnosis.mcp.body.ok === false) {
      throw new Error(`Deployed MCP rejected initialize (${diagnosis.mcp.body.code ?? diagnosis.mcp.status}) after main-server /submission succeeded. Check MCP SALES_INTELLIGENCE_RUN_TOKEN_SECRET, SALES_INTELLIGENCE_DEPLOYMENT_ID, SALES_INTELLIGENCE_DATABASE, and SALES_INTELLIGENCE_SCOPED_API_KEY.`);
    }
    const result = await connectAsIntelligenceAgent({
      endpoint,
      key,
      token: prepared.token,
      prompt: prepared.prompt_context.rendered_prompt!,
      schemaDigest: prepared.prompt_context.schema_digest!,
    });
    console.log(JSON.stringify({
      ok: true,
      endpoint: endpoint.href,
      database: getMongoDatabaseName(),
      prompt: CSI_PROMPT_VERSION,
      schema_digest: result.schema_digest,
      tools: result.tools,
      context_snapshot: result.snapshot_id,
    }, null, 2));
  } finally {
    await cleanup(ids).catch((error) => {
      console.error("Probe fixture cleanup failed:", error instanceof Error ? error.message : error);
    });
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
