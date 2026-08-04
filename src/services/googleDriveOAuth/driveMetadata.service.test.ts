import assert from "node:assert/strict";
import test from "node:test";
import type { drive_v3 } from "googleapis";
import {
  IntegrationError,
  NotFoundError,
  UnauthorizedError,
} from "../errors";
import {
  DRIVE_METADATA_ERROR_REASON,
  fetchDriveFileMetadata,
  isDriveMetadataConfirmedNotFoundError,
  isDriveMetadataRefetchBlockedError,
} from "./driveMetadata.service";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz";

function mockDrive(rejectWith: unknown): drive_v3.Drive {
  return {
    files: {
      get: async () => {
        throw rejectWith;
      },
    },
  } as unknown as drive_v3.Drive;
}

test("fetchDriveFileMetadata maps 404 distinctly from 403 access denied", async () => {
  await assert.rejects(
    () => fetchDriveFileMetadata(mockDrive({ code: 404 }), FILE_ID),
    (error: unknown) => {
      assert.ok(isDriveMetadataConfirmedNotFoundError(error));
      assert.ok(error instanceof NotFoundError);
      assert.notEqual(
        (error as NotFoundError).metadata?.drive_reason,
        DRIVE_METADATA_ERROR_REASON.ACCESS_DENIED,
      );
      return true;
    },
  );

  await assert.rejects(
    () => fetchDriveFileMetadata(mockDrive({ code: 403 }), FILE_ID),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.metadata?.drive_reason, DRIVE_METADATA_ERROR_REASON.ACCESS_DENIED);
      assert.equal(error.statusCode, 403);
      assert.equal(isDriveMetadataRefetchBlockedError(error), true);
      assert.equal(isDriveMetadataConfirmedNotFoundError(error), false);
      return true;
    },
  );
});

test("fetchDriveFileMetadata maps provider failures to integration errors", async () => {
  await assert.rejects(
    () => fetchDriveFileMetadata(mockDrive({ code: 503 }), FILE_ID),
    (error: unknown) => {
      assert.ok(error instanceof IntegrationError);
      assert.equal(isDriveMetadataRefetchBlockedError(error), true);
      return true;
    },
  );
});
