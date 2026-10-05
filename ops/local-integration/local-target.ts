/**
 * Shared guard for the local integration helpers: a `--database=<name>` argument that must name a
 * local test database (`test…`) on the loopback csi01 replica. Nothing here can reach Atlas.
 */
export const LOCAL_REPLICA_URI = "mongodb://127.0.0.1:27189/?replicaSet=csi01";

export function localTestDatabase(argv: readonly string[]): string {
  const arg = argv.find((value) => value.startsWith("--database="));
  const name = arg?.slice("--database=".length).trim() ?? "";
  if (!/^test[a-z0-9_]+$/.test(name)) throw new Error(`--database=<name> is required and must start with "test" (got "${name}")`);
  return name;
}

/** Point this process at the local replica in test mode, with every provider credential removed. */
export function useLocalReplica(database: string): void {
  for (const key of Object.keys(process.env))
    if (/RINGCENTRAL|^RC_|BLOB|OPENAI|ANTHROPIC|VERCEL|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = database;
  process.env.MONGO_URI = LOCAL_REPLICA_URI;
  process.env.SHEET_SYNC_MODE = "disabled";
  // `src/services/crm/crmConfig.ts` imports `dotenv/config`; point it at a file that does not exist so the
  // checkout's `.env` cannot bring provider credentials back.
  process.env.DOTENV_CONFIG_PATH = "ops/local-integration/.no-dotenv.env";
}
