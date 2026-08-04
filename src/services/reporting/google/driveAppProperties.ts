export const REPORTING_DRIVE_APP_PROPERTY_KEYS = {
  runId: "vantage_reporting_run_id",
  destinationId: "vantage_reporting_destination_id",
  role: "vantage_reporting_role",
  markerVersion: "vantage_reporting_marker_version",
} as const;

export const REPORTING_DRIVE_MARKER_VERSION = "1";
export const REPORTING_SPREADSHEET_MIME_TYPE =
  "application/vnd.google-apps.spreadsheet";

export type ReportingDriveAppProperties = {
  [REPORTING_DRIVE_APP_PROPERTY_KEYS.runId]: string;
  [REPORTING_DRIVE_APP_PROPERTY_KEYS.destinationId]: string;
  [REPORTING_DRIVE_APP_PROPERTY_KEYS.role]: "snapshot" | "staging_workbook";
  [REPORTING_DRIVE_APP_PROPERTY_KEYS.markerVersion]: typeof REPORTING_DRIVE_MARKER_VERSION;
};

export function buildReportingDriveAppProperties(input: {
  runId: string;
  destinationId: string;
  role: "snapshot" | "staging_workbook";
}): ReportingDriveAppProperties {
  return {
    [REPORTING_DRIVE_APP_PROPERTY_KEYS.runId]: input.runId,
    [REPORTING_DRIVE_APP_PROPERTY_KEYS.destinationId]: input.destinationId,
    [REPORTING_DRIVE_APP_PROPERTY_KEYS.role]: input.role,
    [REPORTING_DRIVE_APP_PROPERTY_KEYS.markerVersion]:
      REPORTING_DRIVE_MARKER_VERSION,
  };
}

export function driveAppPropertiesMatchRun(input: {
  appProperties: Record<string, string> | null | undefined;
  runId: string;
  destinationId: string;
}): boolean {
  const props = input.appProperties ?? {};
  return (
    props[REPORTING_DRIVE_APP_PROPERTY_KEYS.runId] === input.runId &&
    props[REPORTING_DRIVE_APP_PROPERTY_KEYS.destinationId] ===
      input.destinationId &&
    props[REPORTING_DRIVE_APP_PROPERTY_KEYS.markerVersion] ===
      REPORTING_DRIVE_MARKER_VERSION &&
    (props[REPORTING_DRIVE_APP_PROPERTY_KEYS.role] === "snapshot" ||
      props[REPORTING_DRIVE_APP_PROPERTY_KEYS.role] === "staging_workbook")
  );
}
