import type { sheets_v4 } from "googleapis";
import { escapeSheetTitleForRange } from "../../../utils/googleSheets/ranges";
import type { QuotaLimiter } from "./quotaLimiter";

export class SheetDeliveryDeferred extends Error {
  constructor(reason: string, cause?: unknown) {
    super(reason, { cause });
    this.name = "SheetDeliveryDeferred";
  }
}

export type DeliveryRequestChecks = {
  assertCanRequest?: () => Promise<void>;
  deadline?: number;
  now?: () => number;
};

type DeliveryParams = {
  range?: string;
  requestBody?: { requests?: sheets_v4.Schema$Request[]; values?: unknown[][] } | null;
};
type DeliveryResponse = {
  data?: { updates?: { updatedRange?: string | null } | null; sheets?: sheets_v4.Schema$Sheet[] | null };
  status?: number;
};

/** A drain-local boundary, including requests made inside tab/header helpers.
 * Transport retries are disabled; explicit safe retries re-enter this boundary.
 * Once a structural result is uncertain, no more requests use this drain's plans.
 * The durable next drain reloads Mongo and physical identities instead.
 */
export function createDeliverySheetsClient(
  sheets: sheets_v4.Sheets,
  quota: QuotaLimiter,
  checks: DeliveryRequestChecks,
): sheets_v4.Sheets {
  let stopped: SheetDeliveryDeferred | undefined;
  const check = async () => {
    if (stopped) throw stopped;
    try {
      if ((checks.now ?? Date.now)() >= (checks.deadline ?? Infinity)) {
        throw new Error("drain_deadline_exceeded");
      }
      await checks.assertCanRequest?.();
      if ((checks.now ?? Date.now)() >= (checks.deadline ?? Infinity)) {
        throw new Error("drain_deadline_exceeded");
      }
    } catch (error) {
      stopped = new SheetDeliveryDeferred("delivery_guard_stopped", error);
      throw stopped;
    }
  };
  const request = (resource: object, name: string, read = false) => async (params: DeliveryParams, options?: Record<string, unknown>) => {
    await check();
    if (!(await quota.reserve(read ? "read" : "write", 1)).granted) {
      throw new SheetDeliveryDeferred("quota_budget_exhausted");
    }
    // Mongo quota reservations and ownership checks can yield; recheck before send.
    await check();
    const structural = name === "append" || (name === "batchUpdate" && params.requestBody?.requests?.some(
      (entry: sheets_v4.Schema$Request) => entry.deleteDimension || entry.addSheet,
    ));
    try {
      // googleapis exposes different callback/promise overloads for each method;
      // this internal forwarding boundary uses only their promise form.
      const method = Reflect.get(resource, name) as (params: DeliveryParams, options: Record<string, unknown>) => Promise<DeliveryResponse>;
      // Gaxios 7 honors a preexisting retryConfig even when retry=false.
      // Override both controls so global/client POST retry options cannot win.
      const response = await method.call(resource, params, {
        ...options, retry: false,
        retryConfig: { retry: 0, noResponseRetries: 0, shouldRetry: () => false },
      });
      if (resource === sheets.spreadsheets && name === "get" && (
        !Array.isArray(response?.data?.sheets) || response.data.sheets.some((sheet) =>
          typeof sheet.properties?.title !== "string" || !Number.isInteger(sheet.properties?.sheetId),
        )
      )) throw new Error("sheet_topology_response_invalid");
      if (name === "append") assertAppendConfirmation(params, response);
      if (structural && (!response || !response.data || (response.status !== undefined && (response.status < 200 || response.status >= 300)))) {
        throw new Error("structural_confirmation_missing");
      }
      return response;
    } catch (error) {
      if (!structural) throw error;
      // Explicit HTTP rejection is a failed attempt, never an inline reissue.
      // Backend/no-response/malformed-success outcomes cannot establish rejection.
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      if (status !== undefined && [400, 401, 403, 404, 429].includes(status)) throw error;
      stopped = new SheetDeliveryDeferred("structural_write_unconfirmed", error);
      throw stopped;
    }
  };
  // googleapis' full Sheets type also includes unused API resources. This
  // internal facade exposes only the guarded subset used by queued delivery,
  // preserves real method receivers and leaves the shared client untouched.
  const values = sheets.spreadsheets.values;
  return { spreadsheets: {
    get: request(sheets.spreadsheets, "get", true),
    batchUpdate: request(sheets.spreadsheets, "batchUpdate"),
    values: {
      get: request(values, "get", true),
      update: request(values, "update"),
      clear: request(values, "clear"),
      batchUpdate: request(values, "batchUpdate"),
      append: request(values, "append"),
    },
  } } as unknown as sheets_v4.Sheets;
}

function assertAppendConfirmation(params: DeliveryParams, response: DeliveryResponse): void {
  const range = response?.data?.updates?.updatedRange;
  const match = typeof range === "string" ? /^(.*)![A-Z]+(\d+):[A-Z]+(\d+)$/.exec(range) : null;
  const expectedTitle = params.range?.slice(0, params.range.lastIndexOf("!"));
  const actualTitle = match?.[1];
  const first = Number(match?.[2]);
  const last = Number(match?.[3]);
  const count = params.requestBody?.values?.length;
  // Google may leave simple titles unquoted; compare their escaped equivalents.
  const titleMatches = actualTitle === expectedTitle || (actualTitle !== undefined && escapeSheetTitleForRange(actualTitle) === expectedTitle);
  if (!match || !titleMatches || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 2 || last - first + 1 !== count) {
    throw new Error("append_confirmation_invalid");
  }
}
