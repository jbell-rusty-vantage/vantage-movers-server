import {
  collectGranotReport,
  GranotCollectorError,
  type GranotCollectorCredentials,
} from "../../src/services/granotHttpCollector";

const args = process.argv.slice(2);
const from = readArgument(args, "--from");
const to = readArgument(args, "--to");
const sourceLabels = readArguments(args, "--source");
const discoverOnly = args.includes("--discover");

void main();

async function main(): Promise<void> {
  if (!from || !to || (sourceLabels.length === 0 && !discoverOnly)) {
    console.error(
      'Usage: pnpm granot:collect -- --from MM/DD/YYYY --to MM/DD/YYYY (--discover | --source "Source Label")',
    );
    process.exitCode = 2;
    return;
  }

  try {
    const result = await collectGranotReport({
      dateWindow: { from, to },
      sourceLabels,
      credentials: readCredentials(),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          requestedDateWindow: result.requestedDateWindow,
          discoveredSourceCount: result.discoveredSourceLabels.length,
          ...(discoverOnly
            ? { discoveredSourceLabels: result.discoveredSourceLabels }
            : {}),
          notObservedSourceLabels: result.notObservedSourceLabels,
          sources: result.sources.map((source) => ({
            sourceLabel: source.sourceLabel,
            contentHash: source.contentHash,
            bookedJobs: source.sections.bookedJobs.length,
            followUpEstimates: source.sections.followUpEstimates.length,
            rowsWithJobNo: [
              ...source.sections.bookedJobs,
              ...source.sections.followUpEstimates,
            ].filter((row) => Boolean(row.values.job_no)).length,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const collectorError =
      error instanceof GranotCollectorError ? error : undefined;
    console.error(
      JSON.stringify({
        ok: false,
        code: collectorError?.code ?? "unexpected_error",
        error:
          collectorError?.message ??
          (error instanceof Error ? error.name : "Unknown error"),
      }),
    );
    process.exitCode = 1;
  }
}

function readCredentials(): GranotCollectorCredentials {
  return {
    networkUsername: requireEnvironment(
      "GRANOT_NETWORK_USERNAME",
      "MAIN_LOGIN_USERNAME",
    ),
    networkPassword: requireEnvironment(
      "GRANOT_NETWORK_PASSWORD",
      "MAIN_LOGIN_PASSWORD",
    ),
    username: requireEnvironment("GRANOT_USERNAME", "SPECIFIC_USERNAME"),
    password: requireEnvironment("GRANOT_PASSWORD", "SPECIFIC_PASSWORD"),
  };
}

function requireEnvironment(primary: string, legacy: string): string {
  const value = process.env[primary]?.trim() || process.env[legacy]?.trim();
  if (!value) {
    throw new GranotCollectorError(
      "authentication_failed",
      `Missing required environment variable ${primary}`,
    );
  }
  return value;
}

function readArgument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || undefined : undefined;
}

function readArguments(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1]?.trim() ? [args[index + 1].trim()] : [],
  );
}
