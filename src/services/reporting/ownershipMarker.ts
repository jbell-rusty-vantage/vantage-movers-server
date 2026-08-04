export const REPORTING_OWNERSHIP_MARKER_VERSION = 1;

export const REPORTING_OWNERSHIP_MARKER_CELL = "ZZ1";

export type ReportingOwnershipMarkerV1 = {
  vantage_reporting_ownership: {
    version: typeof REPORTING_OWNERSHIP_MARKER_VERSION;
    destination_id: string;
    managed: true;
  };
};

export function buildReportingOwnershipMarker(
  destinationId: string,
): ReportingOwnershipMarkerV1 {
  return {
    vantage_reporting_ownership: {
      version: REPORTING_OWNERSHIP_MARKER_VERSION,
      destination_id: destinationId,
      managed: true,
    },
  };
}

export function serializeReportingOwnershipMarker(
  destinationId: string,
): string {
  return JSON.stringify(buildReportingOwnershipMarker(destinationId));
}

export function parseReportingOwnershipMarker(
  raw: unknown,
): ReportingOwnershipMarkerV1 | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ReportingOwnershipMarkerV1;
    const marker = parsed?.vantage_reporting_ownership;
    if (
      !marker ||
      marker.version !== REPORTING_OWNERSHIP_MARKER_VERSION ||
      marker.managed !== true ||
      typeof marker.destination_id !== "string" ||
      !marker.destination_id.trim()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ownershipMarkerMatchesDestination(
  raw: unknown,
  destinationId: string,
): boolean {
  const marker = parseReportingOwnershipMarker(raw);
  return marker?.vantage_reporting_ownership.destination_id === destinationId;
}
