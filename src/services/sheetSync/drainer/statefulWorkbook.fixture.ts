import type { sheets_v4 } from "googleapis";

type Fault = "none" | "before" | "after" | "missing_confirmation" | "malformed_confirmation" | "transport";
type Operation = "append" | "delete" | "read" | "update" | "topology" | "header" | "provision" | "format" | "clear";
type RequestOptions = { retry?: boolean };
type ValueWrite = { range: string; requestBody: { values: string[][] } };
type RowUpdate = { requestBody: { data: { range: string; values: string[][] }[] } };
type StructuralWrite = { requestBody: { requests: sheets_v4.Schema$Request[] } };

/** Offline provider: faults can happen after the workbook has actually changed. */
export function statefulWorkbook(initial: Record<string, string[][]>) {
  const rows = new Map(Object.entries(initial).map(([title, values]) => [title, structuredClone(values)]));
  const titles = [...rows.keys()];
  const requests: { operation: Operation; params: unknown; options?: RequestOptions }[] = [];
  const faults = new Map<Operation, Fault[]>();
  let afterRequest: (operation: Operation) => void | Promise<void> = () => {};
  const titleFrom = (range: string) => /^'((?:[^']|'')+)'!/.exec(range)![1].replaceAll("''", "'");
  const error = () => Object.assign(new Error("synthetic provider 503"), { response: { status: 503, headers: { "retry-after": "0" } } });
  const start = (operation: Operation, params: unknown, options?: RequestOptions) => {
    requests.push({ operation, params: structuredClone(params), options });
    const fault = faults.get(operation)?.shift();
    if (fault === "before") throw error();
    return fault;
  };
  const finish = async (operation: Operation, fault: Fault | undefined) => {
    await afterRequest(operation);
    if (fault === "after") throw error();
    if (fault === "transport") throw Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
  };
  const sheets = { spreadsheets: {
    get: async (params: unknown, options?: RequestOptions) => {
      const fault = start("topology", params, options);
      await finish("topology", fault);
      return { data: { sheets: titles.map((title, sheetId) => ({ properties: { title, sheetId, gridProperties: { columnCount: 30 } } })) } };
    },
    values: {
      clear: async (params: unknown, options?: RequestOptions) => { start("clear", params, options); return { data: {} }; },
      update: async (params: ValueWrite, options?: RequestOptions) => {
        start("header", params, options);
        rows.get(titleFrom(params.range))![0] = [...params.requestBody.values[0]];
        return { data: {} };
      },
      get: async (params: { range: string }, options?: RequestOptions) => {
        const fault = start("read", params, options);
        await finish("read", fault);
        return { data: { values: structuredClone(rows.get(titleFrom(params.range))) } };
      },
      batchUpdate: async (params: RowUpdate, options?: RequestOptions) => {
        const fault = start("update", params, options);
        for (const data of params.requestBody.data) {
          rows.get(titleFrom(data.range))![Number(/!A(\d+)/.exec(data.range)![1]) - 1] = [...data.values[0]];
        }
        await finish("update", fault);
        return { data: {} };
      },
      append: async (params: ValueWrite, options?: RequestOptions) => {
        const fault = start("append", params, options);
        const title = titleFrom(params.range);
        const tab = rows.get(title)!;
        const first = tab.length + 1;
        tab.push(...structuredClone(params.requestBody.values));
        await finish("append", fault);
        if (fault === "missing_confirmation") return { data: {} };
        return { data: { updates: { updatedRange: fault === "malformed_confirmation" ? `'${title}'!A1:B999` : `'${title}'!A${first}:B${tab.length}` } } };
      },
    },
    batchUpdate: async (params: StructuralWrite, options?: RequestOptions) => {
      const addedTitle = params.requestBody.requests[0]?.addSheet?.properties?.title;
      if (addedTitle) {
        const fault = start("provision", params, options);
        const sheetId = titles.length;
        titles.push(addedTitle);
        rows.set(addedTitle, []);
        await finish("provision", fault);
        return { data: { replies: [{ addSheet: { properties: { title: addedTitle, sheetId, gridProperties: { columnCount: 30 } } } }] } };
      }
      if (!params.requestBody.requests[0]?.deleteDimension) {
        start("format", params, options);
        return { data: {} };
      }
      const fault = start("delete", params, options);
      for (const request of params.requestBody.requests) {
        const range = request.deleteDimension!.range!;
        rows.get(titles[range.sheetId!])!.splice(range.startIndex!, range.endIndex! - range.startIndex!);
      }
      await finish("delete", fault);
      return { data: {} };
    },
  // The stateful fake implements only the googleapis resources used by delivery.
  } } as unknown as sheets_v4.Sheets;
  return {
    sheets, rows, requests,
    fault: (operation: Operation, ...sequence: Fault[]) => faults.set(operation, sequence),
    afterRequest: (callback: (operation: Operation) => void | Promise<void>) => { afterRequest = callback; },
    count: (operation: Operation) => requests.filter((request) => request.operation === operation).length,
  };
}
