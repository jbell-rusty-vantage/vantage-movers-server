import assert from "node:assert/strict";
import { test } from "node:test";
import type { sheets_v4 } from "googleapis";
import { FORM_SHEET_HEADERS } from "../../config/domain";
import {
  ensureTabsAndHeaders,
  resetEnsuredTabsCache,
} from "./tabs";

test("ensureTabsAndHeaders expands an undersized existing grid without shrinking it", async () => {
  resetEnsuredTabsCache();
  const batchRequests: sheets_v4.Schema$Request[][] = [];
  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 42,
                title: "Forms",
                gridProperties: { columnCount: FORM_SHEET_HEADERS.length - 1 },
              },
            },
          ],
        },
      }),
      batchUpdate: async (request: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => {
        batchRequests.push(request.requestBody?.requests ?? []);
        return { data: {} };
      },
      values: {
        update: async () => ({ data: {} }),
        clear: async () => ({ data: {} }),
      },
    },
  } as unknown as sheets_v4.Sheets;

  await ensureTabsAndHeaders(sheets, "test-sheet", [
    { tabName: "Forms", headers: FORM_SHEET_HEADERS },
  ]);

  assert.equal(batchRequests.length, 2);
  assert.equal(
    batchRequests[0][0].updateSheetProperties?.properties?.gridProperties
      ?.columnCount,
    23,
  );
  assert.deepEqual(
    batchRequests[1][0].repeatCell?.cell?.userEnteredFormat?.numberFormat,
    {
      type: "DATE_TIME",
      pattern: "M/d/yyyy HH:mm:ss",
    },
  );
  assert.equal(batchRequests[1][0].repeatCell?.range?.startColumnIndex, 0);
  assert.equal(batchRequests[1][0].repeatCell?.range?.startRowIndex, 1);
});
