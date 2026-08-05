import { createHash } from "node:crypto";
import { getGoogleDriveOAuthConfig } from "../../config/domain";
import { maskEmailForLog } from "../../utils/logging/sanitizeFormLeadForLog";

export function stableOwnerIdFromEmail(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function ownerIdentitySnapshotFromEmail(email: string): {
  stable_owner_id: string;
  masked_email: string;
} {
  const normalized = email.trim().toLowerCase();
  return {
    stable_owner_id: stableOwnerIdFromEmail(normalized),
    masked_email: maskEmailForLog(normalized),
  };
}

export function expectedConfiguredOwnerEmail(): string {
  return getGoogleDriveOAuthConfig().ownerEmail;
}

export function maskGoogleFileId(fileId: string): string {
  const trimmed = fileId.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export function hashPickerNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function hashPickerSelectionReference(reference: string): string {
  return createHash("sha256").update(reference).digest("hex");
}
