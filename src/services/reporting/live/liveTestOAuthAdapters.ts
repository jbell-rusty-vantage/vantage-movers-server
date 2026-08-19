import { google, type Auth, type drive_v3 } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { getConnectedGoogleOAuthClient } from "../../googleDriveOAuth/googleDriveOAuth.service";
import { createReportingDriveAdapterFromApi } from "../google/reportingDriveAdapter";
import { createReportingSheetsAdapterFromApi } from "../google/reportingSheetsAdapter";
import type { ReportingDriveAdapter } from "../google/reportingDriveAdapter";
import type { ReportingSheetsAdapter } from "../google/reportingSheetsAdapter";
import {
  assertLiveTestOAuthPrincipal,
  rejectServiceAccountCredentialsForLiveTest,
} from "./liveTestSecurity";

export type LiveTestGoogleApiClients = {
  driveApi: drive_v3.Drive;
  sheetsApi: sheets_v4.Sheets;
};

export type LiveTestGoogleApiFactory = (auth: Auth.OAuth2Client) => LiveTestGoogleApiClients;

function defaultLiveTestGoogleApiFactory(auth: Auth.OAuth2Client): LiveTestGoogleApiClients {
  return {
    driveApi: google.drive({ version: "v3", auth } as unknown as drive_v3.Options),
    sheetsApi: google.sheets({
      version: "v4",
      auth,
    } as unknown as sheets_v4.Options),
  };
}

let liveTestGoogleApiFactory: LiveTestGoogleApiFactory = defaultLiveTestGoogleApiFactory;

export function setLiveTestGoogleApiFactoryForTests(
  factory: LiveTestGoogleApiFactory | null,
): void {
  liveTestGoogleApiFactory = factory ?? defaultLiveTestGoogleApiFactory;
}

export function getLiveTestGoogleApiFactoryForTests(): LiveTestGoogleApiFactory {
  return liveTestGoogleApiFactory;
}

/**
 * Builds Drive/Sheets API clients from an explicit verified OAuth2 client.
 * Never uses google.auth.getClient or ambient ADC.
 */
export function buildLiveTestGoogleAdaptersFromOAuthClient(auth: Auth.OAuth2Client): {
  driveApi: drive_v3.Drive;
  sheetsApi: sheets_v4.Sheets;
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
} {
  rejectServiceAccountCredentialsForLiveTest();
  const { driveApi, sheetsApi } = liveTestGoogleApiFactory(auth);
  return {
    driveApi,
    sheetsApi,
    drive: createReportingDriveAdapterFromApi(driveApi),
    sheets: createReportingSheetsAdapterFromApi(sheetsApi),
  };
}

export async function createLiveTestGoogleAdapters(): Promise<{
  driveApi: drive_v3.Drive;
  sheetsApi: sheets_v4.Sheets;
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
}> {
  rejectServiceAccountCredentialsForLiveTest();
  await assertLiveTestOAuthPrincipal();
  const auth = await getConnectedGoogleOAuthClient();
  return buildLiveTestGoogleAdaptersFromOAuthClient(auth);
}
