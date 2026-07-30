import { z } from "zod";

export const googleOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(32).max(256),
});

export const googleOAuthErrorQuerySchema = z.object({
  error: z.string().min(1).max(200),
  state: z.string().min(1).max(256).optional(),
});

export const googleDriveTestSpreadsheetSchema = z.object({
  title: z.string().trim().min(1).max(150).default("Vantage OAuth Test"),
  folder_id: z.string().trim().min(1).max(500).optional(),
});

export const googleDriveCreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(150).default("Vantage API Folder Test"),
  parent_folder_id: z.string().trim().min(1).max(500).optional(),
});

export type GoogleDriveTestSpreadsheetInput = z.infer<
  typeof googleDriveTestSpreadsheetSchema
>;
export type GoogleDriveCreateFolderInput = z.infer<
  typeof googleDriveCreateFolderSchema
>;
