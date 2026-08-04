import { z } from "zod";

export const googlePickerBootstrapSchema = z.object({
  flow: z.enum(["folder", "spreadsheet"]),
}).strict();

export const googlePickerSelectionVerifySchema = z.object({
  selection_nonce: z.string().min(32).max(256),
  file_id: z.string().trim().min(10).max(256),
  display_name: z.string().trim().max(256).optional(),
  display_url: z.string().trim().max(500).optional(),
  parent_folder_id: z.string().trim().max(256).optional(),
}).strict();

export const createReportingDestinationSchema = z.object({
  strategy: z.enum(["replace_tab", "snapshot"]),
  folder_selection_reference: z.string().min(32).max(256).optional(),
  create_folder_name: z.string().trim().min(1).max(150).optional(),
  workbook_selection_reference: z.string().min(32).max(256).optional(),
  create_workbook_name: z.string().trim().min(1).max(150).optional(),
  managed_tab_name: z.string().trim().min(1).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.folder_selection_reference && !value.create_folder_name) {
    ctx.addIssue({
      code: "custom",
      message: "Provide a folder selection reference or a folder name to create.",
      path: ["folder_selection_reference"],
    });
  }
  if (value.strategy === "replace_tab") {
    if (!value.workbook_selection_reference && !value.create_workbook_name) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide a workbook selection reference or a workbook name to create.",
        path: ["workbook_selection_reference"],
      });
    }
    if (!value.managed_tab_name) {
      ctx.addIssue({
        code: "custom",
        message: "Managed tab name is required for replace_tab.",
        path: ["managed_tab_name"],
      });
    }
  }
});

export const updateReportingDestinationSchema = z.object({
  expected_version: z.number().int().min(1),
  managed_tab_name: z.string().trim().min(1).max(100),
}).strict();

export const archiveReportingDestinationSchema = z.object({
  expected_version: z.number().int().min(1),
}).strict();
