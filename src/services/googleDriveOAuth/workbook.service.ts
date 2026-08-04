import { createOAuthTestSpreadsheet } from "./spreadsheet.service";

export async function createOAuthSpreadsheetInFolder(input: {
  title: string;
  folderId: string;
}): Promise<{
  spreadsheet_id: string;
  spreadsheet_url: string;
  title: string;
}> {
  return createOAuthTestSpreadsheet({
    title: input.title,
    folderId: input.folderId,
  });
}
