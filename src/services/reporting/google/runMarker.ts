export const REPORTING_RUN_MARKER_VERSION = 1;
export const REPORTING_RUN_MARKER_CELL = "ZY1";

export type ReportingRunMarkerV1 = {
  vantage_reporting_run: {
    version: typeof REPORTING_RUN_MARKER_VERSION;
    run_id: string;
    destination_id: string;
    strategy: "replace_tab" | "snapshot";
    role: "staging" | "snapshot" | "published";
  };
};

export function buildReportingRunMarker(input: {
  runId: string;
  destinationId: string;
  strategy: "replace_tab" | "snapshot";
  role: "staging" | "snapshot" | "published";
}): ReportingRunMarkerV1 {
  return {
    vantage_reporting_run: {
      version: REPORTING_RUN_MARKER_VERSION,
      run_id: input.runId,
      destination_id: input.destinationId,
      strategy: input.strategy,
      role: input.role,
    },
  };
}

export function serializeReportingRunMarker(input: {
  runId: string;
  destinationId: string;
  strategy: "replace_tab" | "snapshot";
  role: "staging" | "snapshot" | "published";
}): string {
  return JSON.stringify(buildReportingRunMarker(input));
}

export function parseReportingRunMarker(
  raw: unknown,
): ReportingRunMarkerV1 | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ReportingRunMarkerV1;
    const marker = parsed?.vantage_reporting_run;
    if (
      !marker ||
      marker.version !== REPORTING_RUN_MARKER_VERSION ||
      typeof marker.run_id !== "string" ||
      !marker.run_id.trim() ||
      typeof marker.destination_id !== "string" ||
      !marker.destination_id.trim() ||
      (marker.strategy !== "replace_tab" && marker.strategy !== "snapshot") ||
      (marker.role !== "staging" &&
        marker.role !== "snapshot" &&
        marker.role !== "published")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function runMarkerMatches(input: {
  raw: unknown;
  runId: string;
  destinationId: string;
}): boolean {
  const marker = parseReportingRunMarker(input.raw);
  return (
    marker?.vantage_reporting_run.run_id === input.runId &&
    marker.vantage_reporting_run.destination_id === input.destinationId
  );
}
