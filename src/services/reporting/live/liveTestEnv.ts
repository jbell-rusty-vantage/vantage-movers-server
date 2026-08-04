export type ExportFolderEnvSnapshot = {
  present: boolean;
  value?: string;
};

export function snapshotExportFolderEnv(): ExportFolderEnvSnapshot {
  return {
    present: Object.prototype.hasOwnProperty.call(
      process.env,
      "GOOGLE_DRIVE_EXPORT_FOLDER_ID",
    ),
    value: process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID,
  };
}

export function applyLiveTestExportFolderEnv(exportRootFolderId: string): void {
  process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = exportRootFolderId;
}

export function restoreExportFolderEnv(snapshot: ExportFolderEnvSnapshot): void {
  if (snapshot.present) {
    process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = snapshot.value;
  } else {
    delete process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID;
  }
}
