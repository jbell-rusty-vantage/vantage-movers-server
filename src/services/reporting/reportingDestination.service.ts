import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import {
  GOOGLE_SHEETS_PROVIDER_MAX_CELLS,
  getGoogleDriveOAuthConfig,
} from "../../config/domain";
import { REPORTING_DESTINATION_HEALTH_MAX_AGE_MS } from "../../config/domain/reporting";
import { connectMongo } from "../../db";
import { GoogleDriveConnection } from "../../models/GoogleDriveConnection";
import { operationalWorkbookRegistry } from "../operationalWorkbooks";
import { BadRequestError, IntegrationError, NotFoundError } from "../errors";
import type { DurableActor } from "../durableWork";
import { createGoogleDriveFolder } from "../googleDriveOAuth/spreadsheet.service";
import {
  assertWorkbookNotDenylisted,
  consumePickerSelectionReference,
  revalidateFolderMetadata,
  revalidateSpreadsheetMetadata,
} from "../googleDriveOAuth/picker.service";
import {
  assertNoHumanTabNameCollision,
  createSheetsWorkbookClient,
  verifyManagedTabOwnership,
  type SheetsWorkbookClient,
} from "../googleDriveOAuth/managedTab.service";
import {
  destinationSnapshotChecksum,
  type ValidatedReportingDestinationSnapshotV1,
} from "./destinationContract";
import {
  driveFolderUrl,
  ownerIdentitySnapshotFromEmail,
  spreadsheetUrl,
} from "./destinationIdentity";
import { reportingError } from "./catalog";
import {
  archiveReportingDestination,
  getReportingDestinationById,
  insertReportingDestination,
  listReportingDestinations,
  safeReportingDestinationForRead,
  updateReportingDestination,
} from "./reportingDestinationRepository";
import { REPORTING_OWNERSHIP_MARKER_VERSION } from "./ownershipMarker";
import type { DriveMetadataClient } from "../googleDriveOAuth/driveMetadata.service";
import { createOAuthSpreadsheetInFolder } from "../googleDriveOAuth/workbook.service";

export type ReportingDestinationStrategy = "replace_tab" | "snapshot";

export type CreateReportingDestinationInput = {
  strategy: ReportingDestinationStrategy;
  folderSelectionReference?: string;
  createFolderName?: string;
  workbookSelectionReference?: string;
  createWorkbookName?: string;
  managedTabName?: string;
};

export type UpdateReportingDestinationInput = {
  expectedVersion: number;
  managedTabName?: string;
};

type DestinationDeps = {
  driveClient?: DriveMetadataClient;
  sheetsClient?: SheetsWorkbookClient;
};

let destinationDeps: DestinationDeps = {};

export function setReportingDestinationDeps(deps: DestinationDeps): void {
  destinationDeps = deps;
}

export async function listReportingDestinationSummaries(input?: {
  state?: "active" | "archived";
  limit?: number;
}) {
  await connectMongo();
  const rows = await listReportingDestinations(input ?? {});
  return rows.map(safeReportingDestinationForRead);
}

export async function getReportingDestinationSummary(id: string) {
  await connectMongo();
  const destination = await getReportingDestinationById(id);
  if (!destination) {
    throw new NotFoundError("Reporting destination was not found.");
  }
  return safeReportingDestinationForRead(destination);
}

export async function createReportingDestination(
  input: CreateReportingDestinationInput,
  actor: DurableActor,
) {
  await connectMongo();
  operationalWorkbookRegistry.assertConfigurationComplete();
  const connection = await requireActiveGoogleConnection();
  const ownerEmail = getGoogleDriveOAuthConfig().ownerEmail;
  const folder = await resolveDestinationFolder(input, destinationDeps.driveClient);
  const now = new Date();
  const capacity = defaultDestinationCapacity();

  if (input.strategy === "snapshot") {
    const created = await insertReportingDestination({
      provider: "google_sheets",
      drive_connection_id: connection._id,
      owner_identity_snapshot: ownerIdentitySnapshotFromEmail(ownerEmail),
      folder,
      strategy: "snapshot",
      destination_type: "owner_drive",
      ownership_policy: "vantage_managed_tab",
      access_status: "verified",
      health_verified_at: now,
      denylist_checked_at: now,
      capacity,
      state: "active",
      version: 1,
      created_by: actor,
      updated_by: actor,
    });
    return safeReportingDestinationForRead(created);
  }

  const managedTabName = input.managedTabName?.trim();
  if (!managedTabName) {
    throw new BadRequestError("Managed tab name is required for replace_tab.");
  }

  const workbook = await resolveDestinationWorkbook(
    input,
    folder.id,
    destinationDeps.driveClient,
  );
  await assertWorkbookNotDenylisted(workbook.id);

  const created = await insertReportingDestination({
    provider: "google_sheets",
    drive_connection_id: connection._id,
    owner_identity_snapshot: ownerIdentitySnapshotFromEmail(ownerEmail),
    folder,
    strategy: "replace_tab",
    workbook,
    destination_type: "owner_drive",
    ownership_policy: "vantage_managed_tab",
    access_status: "unverified",
    capacity,
    state: "active",
    version: 1,
    created_by: actor,
    updated_by: actor,
  });

  const destinationId = String(created._id);
  await assertNoHumanTabNameCollision({
    spreadsheetId: workbook.id,
    tabName: managedTabName,
    client: destinationDeps.sheetsClient,
  });
  const managedTab = await createManagedTabWithClient(
    {
      spreadsheetId: workbook.id,
      destinationId,
      tabName: managedTabName,
    },
    destinationDeps.sheetsClient,
  );
  const workbookCapacity = await calculateWorkbookCapacity(
    workbook.id,
    destinationDeps.sheetsClient,
  );

  const verified = await updateReportingDestination(destinationId, 1, {
    managed_tab: {
      immutable_sheet_id: managedTab.immutableSheetId,
      name: managedTab.name,
      ownership_marker_version: REPORTING_OWNERSHIP_MARKER_VERSION,
    },
    access_status: "verified",
    capacity: workbookCapacity,
    health_verified_at: now,
    denylist_checked_at: now,
    updated_by: actor,
  });
  if (!verified) {
    throw reportingError(
      "destination_unverified",
      "Reporting destination verification failed after managed tab creation.",
      409,
    );
  }
  return safeReportingDestinationForRead(verified);
}

export async function updateReportingDestinationRecord(
  id: string,
  input: UpdateReportingDestinationInput,
  actor: DurableActor,
) {
  await connectMongo();
  operationalWorkbookRegistry.assertConfigurationComplete();
  const destination = await getReportingDestinationById(id);
  if (!destination || destination.state !== "active") {
    throw new NotFoundError("Reporting destination was not found.");
  }
  if (destination.mutation_pending) {
    throw reportingError(
      "destination_unverified",
      "Destination mutation is still in progress or requires recovery.",
      409,
    );
  }
  if (destination.version !== input.expectedVersion) {
    throw reportingError(
      "destination_unverified",
      "Destination version precondition failed.",
      409,
    );
  }
  if (destination.strategy !== "replace_tab") {
    throw new BadRequestError("Only replace_tab destinations can be updated.");
  }
  if (!input.managedTabName?.trim()) {
    throw new BadRequestError("Managed tab name is required.");
  }

  const workbook = destination.workbook as { id: string } | undefined;
  if (!workbook?.id) {
    throw reportingError("destination_unverified", "Destination workbook is missing.", 409);
  }
  const managedTab = destination.managed_tab as {
    immutable_sheet_id: number;
    name: string;
  } | undefined;
  if (!managedTab?.immutable_sheet_id || !managedTab.name) {
    throw new BadRequestError(
      "This destination has no managed tab to rename. Archive it and create a new destination instead.",
    );
  }

  await assertWorkbookNotDenylisted(workbook.id);
  await revalidateSpreadsheetMetadata(
    workbook.id,
    (destination.folder as { id: string }).id,
    destinationDeps.driveClient,
  );

  // Reserve this exact version before mutating Google. This makes concurrent
  // renames fail before either caller reaches the provider. The temporary
  // unverified state is deliberate: if the provider result is ambiguous, the
  // destination cannot be used again until explicit verification/recovery.
  const mutationToken = randomUUID();
  const reserved = await updateReportingDestination(id, input.expectedVersion, {
    access_status: "unverified",
    mutation_pending: {
      kind: "managed_tab_rename",
      token: mutationToken,
      next_name: input.managedTabName.trim(),
      started_at: new Date(),
    },
    updated_by: actor,
  });
  if (!reserved) {
    throw reportingError(
      "destination_unverified",
      "Destination version precondition failed.",
      409,
    );
  }

  let renamedTab: { immutableSheetId: number; name: string };
  try {
    renamedTab = await renameManagedTabWithClient(
      {
        spreadsheetId: workbook.id,
        destinationId: id,
        immutableSheetId: managedTab.immutable_sheet_id,
        currentTabName: managedTab.name,
        nextTabName: input.managedTabName.trim(),
      },
      destinationDeps.sheetsClient,
    );
  } catch (error) {
    // Keep the durable reservation. A provider timeout may have applied the
    // rename even though no response arrived; explicit verification reconciles
    // the actual title by immutable sheet ID before clearing this record.
    throw error;
  }
  const now = new Date();
  const updated = await updateReportingDestination(id, input.expectedVersion + 1, {
    managed_tab: {
      immutable_sheet_id: renamedTab.immutableSheetId,
      name: renamedTab.name,
      ownership_marker_version: REPORTING_OWNERSHIP_MARKER_VERSION,
    },
    access_status: "verified",
    health_verified_at: now,
    denylist_checked_at: now,
    mutation_pending: null,
    updated_by: actor,
  });
  if (!updated) {
    throw reportingError(
      "destination_unverified",
      "Destination version precondition failed.",
      409,
    );
  }
  return safeReportingDestinationForRead(updated);
}

export async function verifyReportingDestination(id: string, actor: DurableActor) {
  await connectMongo();
  operationalWorkbookRegistry.assertConfigurationComplete();
  const destination = await getReportingDestinationById(id);
  if (!destination || destination.state !== "active") {
    throw new NotFoundError("Reporting destination was not found.");
  }
  const folder = destination.folder as { id: string };
  await revalidateFolderMetadata(folder.id, destinationDeps.driveClient);
  const now = new Date();
  const patch: Record<string, unknown> = {
    health_verified_at: now,
    denylist_checked_at: now,
    updated_by: actor,
  };

  if (destination.strategy === "replace_tab") {
    const workbook = destination.workbook as { id: string; name: string; url: string };
    const managedTab = destination.managed_tab as {
      immutable_sheet_id: number;
      name: string;
    };
    if (!workbook?.id || !managedTab?.immutable_sheet_id) {
      throw reportingError("destination_unverified", "Destination is incomplete.", 409);
    }
    await assertWorkbookNotDenylisted(workbook.id);
    const refreshedWorkbook = await revalidateSpreadsheetMetadata(
      workbook.id,
      folder.id,
      destinationDeps.driveClient,
    );
    const pending = destination.mutation_pending as
      | { kind?: string; next_name?: string }
      | null
      | undefined;
    let tabName = managedTab.name;
    let sheetsClient = destinationDeps.sheetsClient;
    if (pending) {
      if (
        pending.kind !== "managed_tab_rename" ||
        typeof pending.next_name !== "string" ||
        !pending.next_name.trim()
      ) {
        throw reportingError(
          "destination_unverified",
          "Destination mutation requires operator recovery.",
          409,
        );
      }
      sheetsClient ??= await createSheetsWorkbookClient();
      const actual = (await sheetsClient.listSheets(workbook.id)).find(
        (sheet) => sheet.sheetId === managedTab.immutable_sheet_id,
      );
      if (
        !actual ||
        (actual.title !== managedTab.name &&
          actual.title !== pending.next_name.trim())
      ) {
        throw reportingError(
          "destination_unverified",
          "Managed tab rename could not be reconciled safely.",
          409,
        );
      }
      tabName = actual.title;
      patch.mutation_pending = null;
      if (tabName !== managedTab.name) {
        patch.managed_tab = {
          ...managedTab,
          name: tabName,
          ownership_marker_version: REPORTING_OWNERSHIP_MARKER_VERSION,
        };
      }
    }
    await verifyManagedTabOwnership({
      spreadsheetId: workbook.id,
      destinationId: id,
      immutableSheetId: managedTab.immutable_sheet_id,
      tabName,
      client: sheetsClient,
    });
    patch.workbook = refreshedWorkbook;
    patch.capacity = await calculateWorkbookCapacity(
      workbook.id,
      sheetsClient,
    );
    patch.access_status = "verified";
  } else {
    patch.access_status = "verified";
  }

  const updated = await updateReportingDestination(
    id,
    destination.version as number,
    patch,
  );
  if (!updated) {
    throw reportingError(
      "destination_unverified",
      "Destination verification could not be persisted.",
      409,
    );
  }
  return safeReportingDestinationForRead(updated);
}

export async function archiveReportingDestinationRecord(
  id: string,
  expectedVersion: number,
  actor: DurableActor,
) {
  await connectMongo();
  const destination = await getReportingDestinationById(id);
  if (destination?.mutation_pending) {
    throw reportingError(
      "destination_unverified",
      "Destination mutation is still in progress or requires recovery.",
      409,
    );
  }
  const archived = await archiveReportingDestination(id, expectedVersion, actor);
  if (!archived) {
    throw new NotFoundError("Reporting destination was not found.");
  }
  return safeReportingDestinationForRead(archived);
}

export async function buildValidatedDestinationSnapshot(
  destinationId: string,
): Promise<ValidatedReportingDestinationSnapshotV1> {
  await connectMongo();
  operationalWorkbookRegistry.assertConfigurationComplete();
  const destination = await getReportingDestinationById(destinationId);
  if (!destination || destination.state !== "active") {
    throw reportingError("destination_unverified", "Destination was not found.", 409);
  }
  if (destination.access_status !== "verified") {
    throw reportingError("destination_unverified", "Destination is unavailable.", 409);
  }

  const folder = destination.folder as { id: string; name: string; url: string };
  const owner = destination.owner_identity_snapshot as {
    stable_owner_id: string;
    masked_email: string;
  };
  const capacityDoc = destination.capacity as {
    provider_max_cells: number;
    destination_available_cells: number;
  };
  const strategy = destination.strategy as ReportingDestinationStrategy;
  const healthVerifiedAt = (destination.health_verified_at as Date).toISOString();
  const denylistCheckedAt = (destination.denylist_checked_at as Date).toISOString();
  const now = Date.now();
  if (
    now - Date.parse(healthVerifiedAt) > REPORTING_DESTINATION_HEALTH_MAX_AGE_MS ||
    now - Date.parse(denylistCheckedAt) > REPORTING_DESTINATION_HEALTH_MAX_AGE_MS
  ) {
    throw reportingError("destination_unverified", "Destination health verification is stale.", 409);
  }

  let operationalWorkbookMatch = false;
  let humanCreatedTabTakeover = false;
  if (strategy === "replace_tab") {
    const workbook = destination.workbook as { id: string; name: string; url: string };
    const managedTab = destination.managed_tab as {
      immutable_sheet_id: number;
      name: string;
    };
    if (!workbook?.id || !managedTab?.immutable_sheet_id) {
      throw reportingError("destination_unsafe", "Destination safety validation failed.", 409);
    }
    const safety = operationalWorkbookRegistry.evaluateReportingDestination(workbook.id);
    operationalWorkbookMatch = !safety.allowed;
    if (operationalWorkbookMatch) {
      throw reportingError("destination_unsafe", "Destination safety validation failed.", 409);
    }
    try {
      await verifyManagedTabOwnership({
        spreadsheetId: workbook.id,
        destinationId,
        immutableSheetId: managedTab.immutable_sheet_id,
        tabName: managedTab.name,
        client: destinationDeps.sheetsClient,
      });
    } catch {
      humanCreatedTabTakeover = true;
      throw reportingError("destination_unsafe", "Destination safety validation failed.", 409);
    }
  }

  const payload = {
    contractVersion: 1 as const,
    destinationId,
    provider: "google_sheets" as const,
    driveConnectionId: String(destination.drive_connection_id),
    ownerIdentitySnapshot: {
      stableOwnerId: owner.stable_owner_id,
      maskedEmail: owner.masked_email,
    },
    folder: {
      id: folder.id,
      name: folder.name,
      url: folder.url,
    },
    strategy,
    destinationType: String(destination.destination_type),
    ownershipPolicy: String(destination.ownership_policy),
    accessStatus: "verified" as const,
    healthVerifiedAt,
    archived: false as const,
    safety: {
      denylistCheckedAt,
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
    capacity: {
      providerMaxCells: capacityDoc.provider_max_cells,
      destinationAvailableCells: capacityDoc.destination_available_cells,
    },
    ...(strategy === "replace_tab"
      ? {
          workbook: destination.workbook as {
            id: string;
            name: string;
            url: string;
          },
          managedTab: {
            immutableSheetId: (destination.managed_tab as { immutable_sheet_id: number })
              .immutable_sheet_id,
            name: (destination.managed_tab as { name: string }).name,
            managed: true as const,
          },
        }
      : {}),
  };
  return {
    ...payload,
    snapshotChecksum: destinationSnapshotChecksum(payload),
  };
}

async function requireActiveGoogleConnection() {
  const ownerEmail = getGoogleDriveOAuthConfig().ownerEmail;
  const connection = await GoogleDriveConnection.findOne({
    owner_email: ownerEmail,
  }).lean();
  if (!connection) {
    throw new BadRequestError(
      "Google Drive is not connected. Complete the owner authorization first.",
    );
  }
  return connection;
}

async function resolveDestinationFolder(
  input: CreateReportingDestinationInput,
  driveClient?: DriveMetadataClient,
) {
  if (input.folderSelectionReference) {
    const selected = await consumePickerSelectionReference({
      reference: input.folderSelectionReference,
      flow: "folder",
      driveClient,
    });
    return {
      id: selected.fileId,
      name: selected.name,
      url: selected.url,
    };
  }
  if (input.createFolderName?.trim()) {
    const created = await createGoogleDriveFolder({
      name: input.createFolderName.trim(),
    });
    return {
      id: created.folder_id,
      name: created.name,
      url: created.folder_url,
    };
  }
  const exportFolderId = getGoogleDriveOAuthConfig().exportFolderId;
  if (exportFolderId) {
    const folder = await revalidateFolderMetadata(exportFolderId, driveClient);
    return folder;
  }
  throw new BadRequestError(
    "Provide a Picker folder selection or a folder name to create.",
  );
}

async function resolveDestinationWorkbook(
  input: CreateReportingDestinationInput,
  folderId: string,
  driveClient?: DriveMetadataClient,
) {
  if (input.workbookSelectionReference) {
    const selected = await consumePickerSelectionReference({
      reference: input.workbookSelectionReference,
      flow: "spreadsheet",
      expectedParentFolderId: folderId,
      driveClient,
    });
    return {
      id: selected.fileId,
      name: selected.name,
      url: selected.url,
    };
  }
  if (input.createWorkbookName?.trim()) {
    const created = await createOAuthSpreadsheetInFolder({
      title: input.createWorkbookName.trim(),
      folderId,
    });
    return {
      id: created.spreadsheet_id,
      name: created.title,
      url: created.spreadsheet_url,
    };
  }
  throw new BadRequestError(
    "Provide a Picker spreadsheet selection or a workbook name to create.",
  );
}

function defaultDestinationCapacity() {
  return {
    provider_max_cells: GOOGLE_SHEETS_PROVIDER_MAX_CELLS,
    destination_available_cells: GOOGLE_SHEETS_PROVIDER_MAX_CELLS,
  };
}

export async function calculateWorkbookCapacity(
  spreadsheetId: string,
  client?: SheetsWorkbookClient,
) {
  const sheetsClient = client ?? (await createSheetsWorkbookClient());
  const sheets = await sheetsClient.listSheets(spreadsheetId);
  let usedCells = 0;
  for (const sheet of sheets) {
    if (
      !Number.isSafeInteger(sheet.rowCount) ||
      !Number.isSafeInteger(sheet.columnCount) ||
      Number(sheet.rowCount) < 0 ||
      Number(sheet.columnCount) < 0
    ) {
      throw new IntegrationError(
        "Google Sheets capacity metadata is unavailable for this workbook.",
      );
    }
    usedCells += Number(sheet.rowCount) * Number(sheet.columnCount);
  }
  return {
    provider_max_cells: GOOGLE_SHEETS_PROVIDER_MAX_CELLS,
    destination_available_cells: Math.max(
      0,
      GOOGLE_SHEETS_PROVIDER_MAX_CELLS - usedCells,
    ),
  };
}

export function toObjectId(value: string): string {
  if (!mongoose.isValidObjectId(value)) {
    throw new BadRequestError("Invalid destination identifier.");
  }
  return value;
}

export function destinationFolderArtifact(folder: {
  id: string;
  name: string;
  url?: string;
}) {
  return {
    id: folder.id,
    name: folder.name,
    url: folder.url ?? driveFolderUrl(folder.id),
  };
}

export function destinationWorkbookArtifact(workbook: {
  id: string;
  name: string;
  url?: string;
}) {
  return {
    id: workbook.id,
    name: workbook.name,
    url: workbook.url ?? spreadsheetUrl(workbook.id),
  };
}

async function createManagedTabWithClient(
  input: {
    spreadsheetId: string;
    destinationId: string;
    tabName: string;
  },
  client?: SheetsWorkbookClient,
) {
  const workbookClient = client ?? (await createSheetsWorkbookClient());
  return workbookClient.createManagedTab(input);
}

async function renameManagedTabWithClient(
  input: {
    spreadsheetId: string;
    destinationId: string;
    immutableSheetId: number;
    currentTabName: string;
    nextTabName: string;
  },
  client?: SheetsWorkbookClient,
) {
  const workbookClient = client ?? (await createSheetsWorkbookClient());
  return workbookClient.renameManagedTab(input);
}
