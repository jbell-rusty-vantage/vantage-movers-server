import {
  loadVantageApiConfig,
  vantageApi,
  type VantageApiMethod,
} from "./vantageApi";

type CliArgs = {
  method: VantageApiMethod;
  path: string;
  body?: unknown;
  query: Record<string, string>;
  signAdmin: boolean;
  confirmProductionWrite: boolean;
  smoke: boolean;
};

function printUsage(): void {
  console.log(`Hit the Vantage API.

Usage:
  pnpm api:hit
  pnpm api:hit -- GET /api/v1/form-leads
  pnpm api:hit -- POST /api/v1/form-leads/search --body '{"phone_number":"5551234567"}'
  pnpm api:hit -- GET /api/v1/admin/granot-lifecycle/cases --sign-admin
  pnpm api:hit -- POST /api/v1/form-leads --body '{...}' --i-mean-it

Env (vantage-main-server/.env, loaded by pnpm):
  VANTAGE_API_SECRET              required for /api/v1/*
  VANTAGE_API_BASE_URL            optional; defaults to production
  VANTAGE_ADMIN_USER_ID           optional; owner-gated admin routes
  VANTAGE_ADMIN_EMAIL             optional; owner-gated admin routes
  VANTAGE_ADMIN_ROLE              optional; default owner
  VANTAGE_ADMIN_PROXY_SIGNING_SECRET  optional; required with --sign-admin
`);
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const rest = [...argv];
  const signAdmin = takeFlag(rest, "--sign-admin");
  const confirmProductionWrite = takeFlag(rest, "--i-mean-it");
  const bodyRaw = takeOption(rest, "--body");
  const query: Record<string, string> = {};
  while (true) {
    const pair = takeOption(rest, "--query");
    if (!pair) break;
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --query ${pair}. Use key=value.`);
    }
    query[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const method = rest.shift()?.toUpperCase();
  const path = rest.shift();
  if (rest.length > 0) {
    throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
  }

  if (!method && !path) {
    return {
      method: "GET",
      path: "/",
      query,
      signAdmin,
      confirmProductionWrite,
      smoke: true,
    };
  }

  if (!method || !path) {
    throw new Error("Provide both METHOD and PATH, or no args for the smoke check.");
  }

  const allowed: VantageApiMethod[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];
  if (!allowed.includes(method as VantageApiMethod)) {
    throw new Error(`Unsupported method ${method}`);
  }

  return {
    method: method as VantageApiMethod,
    path,
    body: bodyRaw === undefined ? undefined : JSON.parse(bodyRaw),
    query,
    signAdmin,
    confirmProductionWrite,
    smoke: false,
  };
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadVantageApiConfig();
  console.log(`base ${config.baseUrl}`);

  if (args.smoke) {
    const banner = await vantageApi({ path: "/" }, config);
    printResult("GET /", banner);
    const testimonials = await vantageApi(
      { path: "/api/v1/testimonials" },
      config,
    );
    printResult("GET /api/v1/testimonials", testimonials);
    return;
  }

  const result = await vantageApi(
    {
      method: args.method,
      path: args.path,
      query: Object.keys(args.query).length > 0 ? args.query : undefined,
      body: args.body,
      signAdmin: args.signAdmin,
      confirmProductionWrite: args.confirmProductionWrite,
    },
    config,
  );
  printResult(`${args.method} ${args.path}`, result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function printResult(label: string, result: { status: number; data: unknown }): void {
  console.log(`${label} -> ${result.status}`);
  console.log(JSON.stringify(result.data, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
