import { google, type drive_v3 } from "googleapis";
import { normalizeSpreadsheetId } from "../operationalWorkbooks";
import {
  BadRequestError,
  IntegrationError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../errors";
import { getConnectedGoogleOAuthClient } from "./googleDriveOAuth.service";
import { normalizeFolderId } from "./spreadsheet.service";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

export const DRIVE_METADATA_ERROR_REASON = {
  FILE_NOT_FOUND: "drive_file_not_found",
  ACCESS_DENIED: "drive_access_denied",
  UNAUTHORIZED: "drive_unauthorized",
  INCOMPLETE: "drive_incomplete_metadata",
} as const;

export type DriveMetadataErrorReason =
  (typeof DRIVE_METADATA_ERROR_REASON)[keyof typeof DRIVE_METADATA_ERROR_REASON];

export type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  url: string;
  parentFolderIds: string[];
  ownedByMe: boolean;
};

export type DriveMetadataClient = {
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;
};

export function getGoogleDriveHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.code === "number") return candidate.code;
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }
  return undefined;
}

export function isGoogleDriveNotFoundHttpError(error: unknown): boolean {
  return getGoogleDriveHttpStatus(error) === 404;
}

export function isGoogleDriveAccessDeniedHttpError(error: unknown): boolean {
  return getGoogleDriveHttpStatus(error) === 403;
}

export function isGoogleDriveUnauthorizedHttpError(error: unknown): boolean {
  return getGoogleDriveHttpStatus(error) === 401;
}

export function isDriveMetadataConfirmedNotFoundError(error: unknown): boolean {
  return (
    error instanceof NotFoundError &&
    error.metadata?.drive_reason === DRIVE_METADATA_ERROR_REASON.FILE_NOT_FOUND
  );
}

export function isDriveMetadataRefetchBlockedError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  if (error instanceof IntegrationError) return true;
  if (error instanceof ServiceUnavailableError) return true;
  if (
    error instanceof NotFoundError &&
    error.metadata?.drive_reason === DRIVE_METADATA_ERROR_REASON.INCOMPLETE
  ) {
    return true;
  }
  return false;
}

export async function createDriveMetadataClient(): Promise<DriveMetadataClient> {
  const auth = await getConnectedGoogleOAuthClient();
  const drive = google.drive({
    version: "v3",
    auth,
  } as unknown as drive_v3.Options);
  return {
    async getFileMetadata(fileId: string) {
      return fetchDriveFileMetadata(drive, fileId);
    },
  };
}

export async function fetchDriveFileMetadata(
  drive: drive_v3.Drive,
  rawFileId: string,
): Promise<DriveFileMetadata> {
  const fileId = normalizeDriveFileId(rawFileId);
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,trashed,webViewLink,parents,ownedByMe",
      supportsAllDrives: true,
    });
    const data = response.data;
    if (!data.id || !data.name || !data.mimeType) {
      throw new NotFoundError("Google Drive file metadata is incomplete.", {
        metadata: { drive_reason: DRIVE_METADATA_ERROR_REASON.INCOMPLETE },
      });
    }
    return {
      id: data.id,
      name: data.name,
      mimeType: data.mimeType,
      trashed: data.trashed === true,
      url:
        data.webViewLink ??
        (data.mimeType === FOLDER_MIME_TYPE
          ? `https://drive.google.com/drive/folders/${data.id}`
          : `https://docs.google.com/spreadsheets/d/${data.id}/edit`),
      parentFolderIds: data.parents ?? [],
      ownedByMe: data.ownedByMe === true,
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (isGoogleDriveNotFoundHttpError(error)) {
      throw new NotFoundError(
        "Google Drive could not access the selected file. Re-authorize it through Picker.",
        {
          metadata: {
            drive_reason: DRIVE_METADATA_ERROR_REASON.FILE_NOT_FOUND,
            drive_status: 404,
          },
        },
      );
    }
    if (isGoogleDriveAccessDeniedHttpError(error)) {
      throw new UnauthorizedError(
        "Google Drive access to the selected file was denied.",
        {
          statusCode: 403,
          metadata: {
            drive_reason: DRIVE_METADATA_ERROR_REASON.ACCESS_DENIED,
            drive_status: 403,
          },
        },
      );
    }
    if (isGoogleDriveUnauthorizedHttpError(error)) {
      throw new UnauthorizedError("Google Drive authorization failed.", {
        metadata: {
          drive_reason: DRIVE_METADATA_ERROR_REASON.UNAUTHORIZED,
          drive_status: 401,
        },
      });
    }
    throw new IntegrationError("Google Drive metadata lookup failed.", {
      cause: error,
      internalMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export function normalizeDriveFileId(value: string): string {
  const spreadsheetId = normalizeSpreadsheetId(value);
  if (spreadsheetId) return spreadsheetId;
  const folderId = normalizeFolderId(value);
  if (folderId) return folderId;
  throw new BadRequestError("Google Drive file ID is invalid.");
}

export function assertDriveMimeType(
  metadata: DriveFileMetadata,
  expected: typeof FOLDER_MIME_TYPE | typeof SPREADSHEET_MIME_TYPE,
): void {
  if (metadata.mimeType !== expected) {
    throw new BadRequestError(
      expected === FOLDER_MIME_TYPE
        ? "The selection must be a Google Drive folder."
        : "The selection must be a Google spreadsheet.",
    );
  }
}

export function assertDriveAccessible(metadata: DriveFileMetadata): void {
  if (metadata.trashed) {
    throw new BadRequestError("The selected Google Drive file is in the trash.");
  }
}

export function assertDriveOwnedByConnectedUser(metadata: DriveFileMetadata): void {
  if (!metadata.ownedByMe) {
    throw new BadRequestError(
      "Reporting destinations must use files owned by the connected Google account.",
    );
  }
}

export function assertParentFolderRelationship(
  metadata: DriveFileMetadata,
  expectedParentFolderId: string,
): void {
  const normalizedParent = normalizeFolderId(expectedParentFolderId);
  if (
    !normalizedParent ||
    !metadata.parentFolderIds.includes(normalizedParent)
  ) {
    throw new BadRequestError(
      "The selected spreadsheet is not in the authorized destination folder.",
    );
  }
}
