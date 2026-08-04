import assert from "node:assert/strict";
import test from "node:test";
import {
  IntegrationError,
  NotFoundError,
  UnauthorizedError,
} from "../../errors";
import {
  DRIVE_METADATA_ERROR_REASON,
} from "../../googleDriveOAuth/driveMetadata.service";
import {
  areAllRegisteredContainersCleaned,
  classifyRegisteredContainerRefetch,
  mapDriveMetadataErrorToCleanupState,
  type RegisteredContainerCleanupState,
} from "./janitorCompletion";

function states(
  entries: Array<[string, RegisteredContainerCleanupState]>,
): Map<string, RegisteredContainerCleanupState> {
  return new Map(entries);
}

function confirmedNotFoundError(): NotFoundError {
  return new NotFoundError("missing", {
    metadata: { drive_reason: DRIVE_METADATA_ERROR_REASON.FILE_NOT_FOUND },
  });
}

test("registered container confirmed 404 is treated as cleaned_not_found", () => {
  assert.equal(
    classifyRegisteredContainerRefetch({ confirmedNotFound: true }),
    "cleaned_not_found",
  );
  assert.equal(
    mapDriveMetadataErrorToCleanupState(confirmedNotFoundError()),
    "cleaned_not_found",
  );
});

test("403 access denied remains refetch_blocked and does not complete run", () => {
  const accessDenied = new UnauthorizedError("denied", {
    statusCode: 403,
    metadata: { drive_reason: DRIVE_METADATA_ERROR_REASON.ACCESS_DENIED },
  });
  assert.equal(mapDriveMetadataErrorToCleanupState(accessDenied), "refetch_blocked");
  assert.equal(
    areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: ["container-a"],
      statesByFolderId: states([["container-a", "refetch_blocked"]]),
    }),
    false,
  );
});

test("transient provider error remains refetch_blocked and does not complete run", () => {
  const transient = new IntegrationError("provider down");
  assert.equal(mapDriveMetadataErrorToCleanupState(transient), "refetch_blocked");
  assert.equal(
    areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: ["container-a", "container-b"],
      statesByFolderId: states([
        ["container-a", "cleaned_trashed"],
        ["container-b", "refetch_blocked"],
      ]),
    }),
    false,
  );
});

test("confirmed 404 completes run when all registered containers are cleaned", () => {
  assert.equal(
    areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: ["container-a", "container-b"],
      statesByFolderId: states([
        ["container-a", "cleaned_trashed"],
        ["container-b", "cleaned_not_found"],
      ]),
    }),
    true,
  );
});

test("partial attempt A cleaned then failed B completes only after B is cleaned on next run", () => {
  const registered = ["container-a", "container-b"];

  const afterFirstRun = states([
    ["container-a", "cleaned_trashed"],
    ["container-b", "present"],
  ]);
  assert.equal(
    areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: registered,
      statesByFolderId: afterFirstRun,
    }),
    false,
  );

  const afterSecondRun = states([
    ["container-a", "cleaned_trashed"],
    ["container-b", "cleaned_trashed"],
  ]);
  assert.equal(
    areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: registered,
      statesByFolderId: afterSecondRun,
    }),
    true,
  );
});
