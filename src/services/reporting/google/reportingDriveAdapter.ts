import { google, type drive_v3 } from "googleapis";
import { getConnectedGoogleOAuthClient } from "../../googleDriveOAuth/googleDriveOAuth.service";
import { BadRequestError, IntegrationError } from "../../errors";
import { sanitizeReportingProviderFailure } from "./providerFailures";
import {
  REPORTING_SPREADSHEET_MIME_TYPE,
  buildReportingDriveAppProperties,
  driveAppPropertiesMatchRun,
} from "./driveAppProperties";

export type ReportingDriveFile = {
  id: string;
  name: string;
  trashed: boolean;
  mimeType: string;
  ownedByMe: boolean;
  appProperties: Record<string, string>;
  webViewLink?: string;
};

export type ReportingDriveAdapter = {
  createSpreadsheet(input: {
    title: string;
    folderId: string;
    runId: string;
    destinationId: string;
    role: "snapshot" | "staging_workbook";
  }): Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }>;
  trashFile(input: {
    fileId: string;
    expectedRunId: string;
    expectedDestinationId: string;
  }): Promise<{ trashed: true }>;
  getFile(input: { fileId: string }): Promise<ReportingDriveFile>;
};

export async function createReportingDriveAdapter(): Promise<ReportingDriveAdapter> {
  const auth = await getConnectedGoogleOAuthClient();
  const drive = google.drive({
    version: "v3",
    auth,
  } as unknown as drive_v3.Options);
  return createReportingDriveAdapterFromApi(drive);
}

export function createReportingDriveAdapterFromApi(
  drive: drive_v3.Drive,
): ReportingDriveAdapter {
  return {
    async createSpreadsheet(input) {
      try {
        const created = await drive.files.create({
          requestBody: {
            name: input.title,
            mimeType: REPORTING_SPREADSHEET_MIME_TYPE,
            parents: [input.folderId],
            appProperties: buildReportingDriveAppProperties({
              runId: input.runId,
              destinationId: input.destinationId,
              role: input.role,
            }),
          },
          fields: "id,name,webViewLink,appProperties,ownedByMe,mimeType,trashed",
          supportsAllDrives: true,
        });
        const spreadsheetId = created.data.id;
        if (!spreadsheetId) {
          throw new IntegrationError(
            "Google Drive did not return a spreadsheet ID.",
          );
        }
        return {
          spreadsheetId,
          spreadsheetUrl:
            created.data.webViewLink ??
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          title: created.data.name ?? input.title,
        };
      } catch (error) {
        throw wrapProvider(error, "create_spreadsheet");
      }
    },

    async getFile(input) {
      try {
        const response = await drive.files.get({
          fileId: input.fileId,
          fields:
            "id,name,trashed,mimeType,webViewLink,ownedByMe,appProperties",
          supportsAllDrives: true,
        });
        if (!response.data.id || !response.data.mimeType) {
          throw new IntegrationError("Google Drive returned incomplete metadata.");
        }
        return {
          id: response.data.id,
          name: response.data.name ?? "",
          trashed: Boolean(response.data.trashed),
          mimeType: response.data.mimeType,
          ownedByMe: Boolean(response.data.ownedByMe),
          appProperties: (response.data.appProperties ?? {}) as Record<
            string,
            string
          >,
          ...(response.data.webViewLink
            ? { webViewLink: response.data.webViewLink }
            : {}),
        };
      } catch (error) {
        throw wrapProvider(error, "get_file");
      }
    },

    async trashFile(input) {
      try {
        const file = await this.getFile({ fileId: input.fileId });
        assertSafeToTrashReportingArtifact({
          file,
          expectedRunId: input.expectedRunId,
          expectedDestinationId: input.expectedDestinationId,
          expectedFileId: input.fileId,
        });
        await drive.files.update({
          fileId: input.fileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
          fields: "id,trashed",
        });
        return { trashed: true as const };
      } catch (error) {
        if (error instanceof BadRequestError) throw error;
        throw wrapProvider(error, "trash_file");
      }
    },
  };
}

export function assertSafeToTrashReportingArtifact(input: {
  file: ReportingDriveFile;
  expectedRunId: string;
  expectedDestinationId: string;
  expectedFileId: string;
}): void {
  if (input.file.id !== input.expectedFileId) {
    throw new BadRequestError(
      "Cleanup refused: Drive file identity did not match the stored artifact.",
    );
  }
  if (input.file.mimeType !== REPORTING_SPREADSHEET_MIME_TYPE) {
    throw new BadRequestError(
      "Cleanup refused: artifact is not a Google spreadsheet.",
    );
  }
  if (!input.file.ownedByMe) {
    throw new BadRequestError(
      "Cleanup refused: spreadsheet is not owned by the connected owner account.",
    );
  }
  if (
    !driveAppPropertiesMatchRun({
      appProperties: input.file.appProperties,
      runId: input.expectedRunId,
      destinationId: input.expectedDestinationId,
    })
  ) {
    throw new BadRequestError(
      "Cleanup refused: Drive appProperties run marker did not match.",
    );
  }
}

function wrapProvider(error: unknown, operation: string): Error {
  const sanitized = sanitizeReportingProviderFailure(error);
  return new IntegrationError(
    `Reporting Drive ${operation} failed: ${sanitized.summary}`,
    {
      cause: error instanceof Error ? error : undefined,
      statusCode:
        sanitized.provider_status ?? (sanitized.retryable ? 503 : 502),
      metadata: {
        failure_class: sanitized.failure_class,
        remediation: sanitized.remediation,
        ...(sanitized.provider_status !== undefined
          ? { provider_status: sanitized.provider_status }
          : {}),
      },
    },
  );
}
