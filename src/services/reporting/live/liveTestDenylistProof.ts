import assert from "node:assert/strict";
import { BadRequestError } from "../../errors";
import type { DurableActor } from "../../durableWork";
import {
  bootstrapGooglePicker,
  verifyGooglePickerSelection,
} from "../../googleDriveOAuth/picker.service";
import { fetchDriveFileMetadata } from "../../googleDriveOAuth/driveMetadata.service";
import {
  createReportingDestination,
  setReportingDestinationDeps,
} from "../reportingDestination.service";
import { createLiveTestGoogleAdapters } from "./liveTestOAuthAdapters";
import { rejectServiceAccountCredentialsForLiveTest } from "./liveTestSecurity";

export const DENYLIST_PROOF_REJECTION_CODE = "OPERATIONAL_WORKBOOK" as const;

export type DenylistProductionProofResult = {
  ok: boolean;
  rejectionCode?: string;
  detail?: string;
};

export function interpretDenylistProductionRejection(error: unknown): {
  ok: boolean;
  rejectionCode?: string;
  detail?: string;
} {
  if (!(error instanceof BadRequestError)) {
    throw error;
  }
  const code =
    typeof error.metadata?.code === "string" ? error.metadata.code : undefined;
  if (code === "DENYLIST_INCOMPLETE") {
    return {
      ok: false,
      rejectionCode: code,
      detail: error.message,
    };
  }
  if (code !== DENYLIST_PROOF_REJECTION_CODE) {
    return {
      ok: false,
      rejectionCode: code ?? "destination_rejected",
      detail: error.message,
    };
  }
  return {
    ok: true,
    rejectionCode: code,
    detail: error.message,
  };
}

/**
 * Crosses the production destination module with a denylisted workbook
 * using the workbook's actual authorized parent folder (Picker-verified).
 * No unmarked folders are created for the proof path.
 */
export async function proveDenylistBlocksProductionDestination(input: {
  denylistWorkbookId: string;
  runTag: string;
  actor: DurableActor;
}): Promise<DenylistProductionProofResult> {
  rejectServiceAccountCredentialsForLiveTest();
  const { driveApi } = await createLiveTestGoogleAdapters();
  const driveClient = {
    getFileMetadata: (fileId: string) => fetchDriveFileMetadata(driveApi, fileId),
  };

  setReportingDestinationDeps({ driveClient });
  try {
    const workbookMeta = await driveClient.getFileMetadata(input.denylistWorkbookId);
    const parentFolderId = workbookMeta.parentFolderIds[0];
    if (!parentFolderId) {
      return {
        ok: false,
        detail: "Denylist workbook has no parent folder for picker verification.",
      };
    }

    const folderBootstrap = await bootstrapGooglePicker("folder");
    const verifiedFolder = await verifyGooglePickerSelection({
      selectionNonce: folderBootstrap.selection_nonce,
      fileId: parentFolderId,
      driveClient,
    });

    const sheetBootstrap = await bootstrapGooglePicker("spreadsheet");
    const verifiedWorkbook = await verifyGooglePickerSelection({
      selectionNonce: sheetBootstrap.selection_nonce,
      fileId: input.denylistWorkbookId,
      parentFolderId,
      driveClient,
    });

    try {
      await createReportingDestination(
        {
          strategy: "replace_tab",
          folderSelectionReference: verifiedFolder.selection_reference,
          workbookSelectionReference: verifiedWorkbook.selection_reference,
          managedTabName: "Denylist Proof Tab",
        },
        input.actor,
      );
      return { ok: false, detail: "createReportingDestination unexpectedly succeeded." };
    } catch (error) {
      const interpreted = interpretDenylistProductionRejection(error);
      if (interpreted.ok) {
        assert.equal(interpreted.rejectionCode, DENYLIST_PROOF_REJECTION_CODE);
      }
      return interpreted;
    }
  } finally {
    setReportingDestinationDeps({});
  }
}
