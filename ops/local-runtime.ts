/** Cross-platform local API launcher. No application imports until the isolated child starts. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
import { AGENT_LOCAL, assertLocalHello, localChildEnvironment, OperatorError, publicFailure } from "./vantage/local-safety";

export const LOCAL_API_URL = "http://127.0.0.1:3000";

export function assertApiIdentity(value: unknown): void {
  const db = value as Record<string, unknown> | null;
  if (!db || db.ok !== true || db.readyState !== 1 || db.host !== "127.0.0.1"
    || db.name !== AGENT_LOCAL.database || db.expectedName !== AGENT_LOCAL.database) {
    throw new OperatorError("local_api_identity_mismatch");
  }
}

export async function verifyLocalMongo(): Promise<void> {
  const client = new MongoClient(AGENT_LOCAL.uri, {
    serverSelectionTimeoutMS: 3_000, connectTimeoutMS: 3_000, socketTimeoutMS: 3_000,
    maxPoolSize: 1, retryReads: false,
  });
  try {
    await client.connect();
    assertLocalHello(await client.db("admin").command({ hello: 1 }), AGENT_LOCAL);
  } finally { await client.close(); }
}

export async function verifyLocalApi(): Promise<void> {
  const response = await fetch(`${LOCAL_API_URL}/db`, { signal: AbortSignal.timeout(3_000), redirect: "error" });
  if (!response.ok) throw new OperatorError("local_api_not_ready");
  assertApiIdentity(await response.json());
}

export function apiEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = localChildEnvironment(parent, AGENT_LOCAL);
  // The API is real local application behavior, not a unit test with bypasses.
  delete env.VANTAGE_TEST_RUNNER;
  return { ...env, NODE_ENV: "development", PORT: "3000", VANTAGE_API_SECRET: "local-dev-secret", LOG_LEVEL: "warn" };
}

export async function assertApiPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new OperatorError("local_api_port_occupied_stop_existing_process")));
    server.listen(3000, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export async function waitForLocalApi(child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new OperatorError("local_api_child_exited");
    try { await verifyLocalApi(); return; }
    catch (error) {
      if (error instanceof OperatorError && error.code === "local_api_identity_mismatch") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new OperatorError("local_api_start_timeout");
}

async function startLocalApi(): Promise<void> {
  await assertApiPortAvailable();
  await verifyLocalMongo();
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "vantage-local-api-"));
  const root = path.resolve(__dirname, "..");
  // Isolated cwd also excludes .env, RingCentral token caches and local credential files.
  const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, path.join(root, "ops/dev-server.ts")], {
    cwd: workingDirectory, env: apiEnvironment(process.env), stdio: "inherit", windowsHide: true,
  });
  const completed = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  // A failed spawn must be observed immediately even while readiness is being checked.
  void completed.catch(() => {});
  const stop = () => { child.kill(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await Promise.race([waitForLocalApi(child), completed.then(() => { throw new OperatorError("local_api_child_exited"); })]);
    console.log(`Local API identity verified: ${LOCAL_API_URL}, ${AGENT_LOCAL.database}. Synthetic data only; no provider-route testing.`);
    process.exitCode = await completed;
  } finally {
    child.kill();
    await completed.catch(() => {});
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 1 || !["start", "verify", "mongo"].includes(args[0]!)) {
    throw new OperatorError("usage_local_runtime_start_verify_or_mongo", 2);
  }
  if (args[0] === "start") return startLocalApi();
  await verifyLocalMongo();
  if (args[0] === "verify") await verifyLocalApi();
  console.log(`Verified local ${args[0] === "verify" ? "API and " : ""}replica identity: ${AGENT_LOCAL.database}, ${AGENT_LOCAL.replicaSet}, ${AGENT_LOCAL.address}`);
}

if (require.main === module) void main().catch((error: unknown) => {
  const failure = publicFailure(error);
  console.error(JSON.stringify(failure));
  process.exitCode = failure.exitCode;
});
