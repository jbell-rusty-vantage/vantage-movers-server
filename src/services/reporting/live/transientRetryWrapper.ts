import type { ReportingDriveAdapter } from "../google/reportingDriveAdapter";
import type { ReportingSheetsAdapter } from "../google/reportingSheetsAdapter";

/**
 * Wraps real Google adapters to inject a bounded number of transient provider
 * failures for live-harness retry/resume verification.
 */
export function wrapReportingAdaptersWithTransientFailures(input: {
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
  failureCount: number;
}): { drive: ReportingDriveAdapter; sheets: ReportingSheetsAdapter } {
  let remaining = Math.max(0, input.failureCount);

  const maybeFail = () => {
    if (remaining <= 0) return;
    remaining -= 1;
    const error = new Error("Injected transient Google 503") as Error & {
      status: number;
      code: number;
    };
    error.status = 503;
    error.code = 503;
    throw error;
  };

  const sheets: ReportingSheetsAdapter = {
    ...input.sheets,
    async writeValuesRaw(writeInput) {
      maybeFail();
      return input.sheets.writeValuesRaw(writeInput);
    },
    async writeOwnershipAndRunMarkers(markerInput) {
      maybeFail();
      return input.sheets.writeOwnershipAndRunMarkers(markerInput);
    },
  };

  const drive: ReportingDriveAdapter = {
    ...input.drive,
    async createSpreadsheet(createInput) {
      maybeFail();
      return input.drive.createSpreadsheet(createInput);
    },
  };

  return { drive, sheets };
}

export function remainingTransientFailures(initial: number, consumed: number): number {
  return Math.max(0, initial - consumed);
}
