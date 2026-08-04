import type { ReportingSheetsAdapter } from "./google/reportingSheetsAdapter";

export type PromotionInspection = {
  state:
    | "ready_to_promote"
    | "already_promoted"
    | "staging_still_hidden"
    | "ambiguous";
  oldPublished: boolean;
  stagingPublished: boolean;
  oldTitle?: string;
  stagingTitle?: string;
};

export async function inspectReplaceTabPromotion(input: {
  sheets: ReportingSheetsAdapter;
  spreadsheetId: string;
  oldSheetId: number;
  stagingSheetId: number;
  publishedTitle: string;
}): Promise<PromotionInspection> {
  const listed = await input.sheets.listSheets(input.spreadsheetId);
  const oldSheet = listed.find((sheet) => sheet.sheetId === input.oldSheetId);
  const staging = listed.find((sheet) => sheet.sheetId === input.stagingSheetId);
  if (!oldSheet || !staging) {
    return {
      state: "ambiguous",
      oldPublished: false,
      stagingPublished: false,
    };
  }
  const oldPublished = oldSheet.title === input.publishedTitle && !oldSheet.hidden;
  const stagingPublished =
    staging.title === input.publishedTitle && !staging.hidden;
  if (stagingPublished && !oldPublished) {
    return {
      state: "already_promoted",
      oldPublished,
      stagingPublished,
      oldTitle: oldSheet.title,
      stagingTitle: staging.title,
    };
  }
  if (oldPublished && staging.hidden) {
    return {
      state: "ready_to_promote",
      oldPublished,
      stagingPublished,
      oldTitle: oldSheet.title,
      stagingTitle: staging.title,
    };
  }
  if (oldPublished && !stagingPublished) {
    return {
      state: "staging_still_hidden",
      oldPublished,
      stagingPublished,
      oldTitle: oldSheet.title,
      stagingTitle: staging.title,
    };
  }
  return {
    state: "ambiguous",
    oldPublished,
    stagingPublished,
    oldTitle: oldSheet.title,
    stagingTitle: staging.title,
  };
}

export function recoveryTabTitle(input: {
  publishedTitle: string;
  runId: string;
  now: Date;
}): string {
  const stamp = input.now.toISOString().replace(/[:.]/g, "-");
  return `${input.publishedTitle}__vantage_recovery_${input.runId.slice(-6)}_${stamp}`;
}

export function stagingTabTitle(input: {
  publishedTitle: string;
  runId: string;
}): string {
  return `__vantage_staging_${input.publishedTitle}_${input.runId.slice(-8)}`;
}
