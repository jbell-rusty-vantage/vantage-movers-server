import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import {
  assertPickerBootstrapAllowlist,
  bootstrapGooglePicker,
  consumePickerSelectionReference,
  verifyGooglePickerSelection,
} from "../../googleDriveOAuth/picker.service";
import { createDriveMetadataClient } from "../../googleDriveOAuth/driveMetadata.service";
import { connectMongo } from "../../../db";

export type PickerContractStep = {
  name: string;
  outcome: "passed" | "failed";
  detail?: string;
};

export async function runLivePickerServerContractTests(input: {
  folderId: string;
  spreadsheetId: string;
  parentFolderId: string;
}): Promise<{ ok: boolean; steps: PickerContractStep[] }> {
  const steps: PickerContractStep[] = [];
  await connectMongo();

  try {
    const folderBootstrap = await bootstrapGooglePicker("folder");
    assertPickerBootstrapAllowlist(
      folderBootstrap as unknown as Record<string, unknown>,
    );
    assert.ok(folderBootstrap.selection_nonce);
    assert.ok(folderBootstrap.access_token);
    steps.push({ name: "picker_bootstrap_folder", outcome: "passed" });

    const driveClient = await createDriveMetadataClient();
    const folderVerified = await verifyGooglePickerSelection({
      selectionNonce: folderBootstrap.selection_nonce,
      fileId: input.folderId,
      driveClient,
    });
    assert.ok(folderVerified.selection_reference);
    steps.push({ name: "picker_verify_folder_selection", outcome: "passed" });

    const folderConsumed = await consumePickerSelectionReference({
      reference: folderVerified.selection_reference,
      flow: "folder",
      driveClient,
    });
    assert.equal(folderConsumed.fileId, input.folderId);
    steps.push({ name: "picker_consume_folder_reference", outcome: "passed" });

    const sheetBootstrap = await bootstrapGooglePicker("spreadsheet");
    const sheetVerified = await verifyGooglePickerSelection({
      selectionNonce: sheetBootstrap.selection_nonce,
      fileId: input.spreadsheetId,
      parentFolderId: input.parentFolderId,
      driveClient,
    });
    steps.push({ name: "picker_verify_spreadsheet_selection", outcome: "passed" });

    const sheetConsumed = await consumePickerSelectionReference({
      reference: sheetVerified.selection_reference,
      flow: "spreadsheet",
      expectedParentFolderId: input.parentFolderId,
      driveClient,
    });
    assert.equal(sheetConsumed.fileId, input.spreadsheetId);
    steps.push({ name: "picker_consume_spreadsheet_reference", outcome: "passed" });

    await assert.rejects(
      () =>
        verifyGooglePickerSelection({
          selectionNonce: folderBootstrap.selection_nonce,
          fileId: input.folderId,
          driveClient,
        }),
      /invalid_nonce|Picker selection nonce/i,
    );
    steps.push({ name: "picker_nonce_replay_rejected", outcome: "passed" });

    return { ok: true, steps };
  } catch (error) {
    steps.push({
      name: "picker_contract_error",
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, steps };
  }
}

export function syntheticPickerFolderId(): string {
  return randomBytes(12).toString("hex");
}
