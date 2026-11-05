import assert from "node:assert/strict";
import { test } from "node:test";
import { google, type sheets_v4 } from "googleapis";
import { createDeliverySheetsClient, SheetDeliveryDeferred } from "./deliveryRequests";
import type { QuotaLimiter } from "./quotaLimiter";

const grant = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;
const append = { spreadsheetId: "synthetic", range: "'Calls'!A:B", requestBody: { values: [["A", "current"]] } };
type AdapterConfig = Parameters<NonNullable<sheets_v4.Options["adapter"]>>[0];

for (const operation of ["append", "delete"] as const) test(`real Google client with POST retries enabled makes one guarded ${operation} attempt`, async () => {
  let attempts = 0;
  const sheets = google.sheets({
    version: "v4", auth: "synthetic-test-key", retry: true,
    retryConfig: { retry: 1, httpMethodsToRetry: ["POST"], retryBackoff: async () => {} },
    adapter: async <T>(config: AdapterConfig) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("committed then lost"), {
        config, response: { status: 503, data: {}, headers: new Headers(), config },
      });
      return Object.assign(new Response("{}", { status: 200 }), { data: { updates: { updatedRange: "'Calls'!A2:B2" } } as T, config });
    },
  });
  const send = (client: sheets_v4.Sheets) => operation === "append"
    ? client.spreadsheets.values.append(append)
    : client.spreadsheets.batchUpdate({ spreadsheetId: "synthetic", requestBody: { requests: [{ deleteDimension: { range: { sheetId: 0, dimension: "ROWS", startIndex: 1, endIndex: 2 } } }] } });
  await send(sheets);
  assert.equal(attempts, 2, "the adversarial underlying transport really does retry POST");
  attempts = 0;
  const guarded = createDeliverySheetsClient(sheets, grant, {});
  await assert.rejects(send(guarded), SheetDeliveryDeferred);
  assert.equal(attempts, 1);
  await assert.rejects(send(guarded), SheetDeliveryDeferred);
  assert.equal(attempts, 1, "stopped plans cannot send another request");
});

test("explicit structural rejection does not retry inline and does not invalidate known row positions", async () => {
  let attempts = 0;
  const sheets = { spreadsheets: { values: { append: async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("invalid request"), { response: { status: 400 } });
    return { data: { updates: { updatedRange: "Calls!A2:B2" } } };
  } } } } as unknown as sheets_v4.Sheets;
  const guarded = createDeliverySheetsClient(sheets, grant, {});
  await assert.rejects(guarded.spreadsheets.values.append(append), /invalid request/);
  assert.equal(attempts, 1);
  await guarded.spreadsheets.values.append(append);
  assert.equal(attempts, 2);
});

test("deadline expiring during an async guard is checked again before sending", async () => {
  let now = 0, sends = 0;
  const sheets = { spreadsheets: { values: { append: async () => { sends++; return {}; } } } } as unknown as sheets_v4.Sheets;
  const guarded = createDeliverySheetsClient(sheets, grant, {
    now: () => now, deadline: 10, assertCanRequest: async () => { now = 10; },
  });
  await assert.rejects(guarded.spreadsheets.values.append(append), SheetDeliveryDeferred);
  assert.equal(sends, 0);
});
