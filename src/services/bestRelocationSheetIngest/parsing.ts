import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  LidBestReloEntry,
  ParsedBookedDeal,
  ParsedCallLead,
  ParsedFormLead,
  ParsedRefund,
  SheetProvenance,
  SheetRow,
  SourceTab,
  TabReadResult,
} from "./types";

export const BEST_RELOCATION_LEAD_SOURCES = new Set([
  "best relocation forms",
  "best relocation inbounds",
  "best relocation locals",
]);

export function cell(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseDate(value: string): Date | undefined {
  const raw = value.trim();
  if (!raw || raw.toUpperCase() === "FORMULAS") return undefined;
  const serial = parseGoogleSheetsSerial(raw);
  if (serial) return serial;
  const withoutWeekday = raw.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, "");
  const parsed = new Date(withoutWeekday);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseDateTime(dateValue: string, timeValue: string): Date | undefined {
  const dateRaw = dateValue.trim();
  const timeRaw = timeValue.trim();
  const dateSerial = Number(dateRaw);
  if (
    Number.isFinite(dateSerial) &&
    dateSerial >= 20_000 &&
    dateSerial <= 100_000
  ) {
    if (!timeRaw) return parseDate(dateRaw);
    const numericTime = Number(timeRaw);
    if (Number.isFinite(numericTime) && numericTime >= 0 && numericTime < 1) {
      return dateFromGoogleSerial(Math.floor(dateSerial) + numericTime);
    }
    const clockFraction = parseClockFraction(timeRaw);
    if (clockFraction !== undefined) {
      return dateFromGoogleSerial(Math.floor(dateSerial) + clockFraction);
    }
  }
  return parseDate(`${dateValue.trim()} ${timeValue.trim()}`.trim());
}

function parseGoogleSheetsSerial(value: string): Date | undefined {
  if (!/^\d{4,6}(?:\.\d+)?$/.test(value)) return undefined;
  const serial = Number(value);
  return Number.isFinite(serial) && serial >= 20_000 && serial <= 100_000
    ? dateFromGoogleSerial(serial)
    : undefined;
}

function dateFromGoogleSerial(serial: number): Date {
  const milliseconds = Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000;
  return new Date(Math.round(milliseconds / 1000) * 1000);
}

function parseClockFraction(value: string): number | undefined {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return (hour * 3600 + minute * 60 + second) / 86_400;
}

export function parseMoney(value: string): number | undefined {
  const stripped = value.replace(/[^0-9.-]/g, "");
  if (!stripped) return undefined;
  const numeric = Number(stripped);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function normalizeJobNo(value: string): string | undefined {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || undefined;
}

export function normalizePersonName(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function normalizeAgentName(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function nameTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\/&,+|]+|(?:\band\b)/i)
        .map(normalizePersonName)
        .filter((part): part is string => typeof part === "string" && part.length > 1),
    ),
  ];
}

export function isBestRelocationSource(source: string): boolean {
  return BEST_RELOCATION_LEAD_SOURCES.has(source.trim().toLowerCase());
}

export function toDateKeyFromRaw(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (us) {
    return `${us[3]}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`;
  }
  return parseDate(raw)?.toISOString().slice(0, 10);
}

function isBlankRow(row: string[] | undefined): boolean {
  return !row || row.every((value) => cell(value) === "");
}

function headerMap(headers: string[], cells: string[]): SheetRow {
  const raw: SheetRow = {};
  for (let i = 0; i < headers.length; i++) {
    raw[headers[i]?.trim() || `__col_${i + 1}`] = cells[i] ?? "";
  }
  for (let i = headers.length; i < cells.length; i++) {
    if (cell(cells[i])) raw[`__col_${i + 1}`] = cell(cells[i]);
  }
  return raw;
}

function looksLikeLid(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) || /^LID[0-9a-f]+$/i.test(value)
  );
}

function trailingLid(raw: SheetRow): string | undefined {
  if (cell(raw.LID)) return cell(raw.LID);
  return Object.entries(raw).find(
    ([key, value]) => key.startsWith("__col_") && looksLikeLid(cell(value)),
  )?.[1];
}

function provenance(tab: TabReadResult, sheetRow: number, raw: SheetRow): SheetProvenance {
  return {
    workbook_id: tab.spreadsheetId,
    workbook_title: tab.spreadsheetTitle,
    tab: tab.tabName,
    sheet_row: sheetRow,
    source_row_key: `${tab.spreadsheetId}:${tab.tabName}:${sheetRow}`,
    raw,
  };
}

function rows(tab: TabReadResult): Array<{ sheetRow: number; raw: SheetRow }> {
  const result: Array<{ sheetRow: number; raw: SheetRow }> = [];
  for (let index = 1; index < tab.matrix.length; index++) {
    const cells = tab.matrix[index];
    if (isBlankRow(cells)) continue;
    result.push({ sheetRow: index + 1, raw: headerMap(tab.headers, cells ?? []) });
  }
  return result;
}

export function parseFormRows(
  tab: TabReadResult,
  sourceTab: "Forms" | "Local Forms",
): ParsedFormLead[] {
  return rows(tab)
    .filter(({ raw }) => cell(raw["Time Stamp"]).toUpperCase() !== "FORMULAS")
    .map(({ sheetRow, raw }) => {
      const timestamp = parseDate(cell(raw["Time Stamp"]));
      const name = cell(raw.Name);
      const phone = cell(raw.Phone);
      return {
        kind: "form" as const,
        source_tab: sourceTab,
        sheet_row: sheetRow,
        timestamp: timestamp?.toISOString(),
        timestamp_ms: timestamp?.getTime(),
        name,
        normalized_name: normalizePersonName(name),
        name_tokens: nameTokens(name),
        pickup_zip: cell(raw["Pickup Zip"]),
        destination_zip: cell(raw["Destination Zip"]),
        move_size: cell(raw["Move Size"]),
        move_date: parseDate(cell(raw["Move Date"]))?.toISOString(),
        phone,
        normalized_phone: normalizePhoneNumberForMatch(phone),
        lead_id: cell(raw["Lead ID"]) || undefined,
        ref_no: cell(raw["Ref No"]) || undefined,
        booked_flag: cell(raw.Booked),
        over_2k: cell(raw[">2K"]),
        over_4k: cell(raw[">4K"]),
        bad_lead_checker: cell(raw["Bad Lead Checker"]),
        local: sourceTab === "Local Forms",
        provenance: provenance(tab, sheetRow, raw),
      };
    });
}

export function parseCallRows(tab: TabReadResult): ParsedCallLead[] {
  return rows(tab).map(({ sheetRow, raw }) => {
    const phone = cell(raw["PHONE NUMBER"] ?? raw["Phone Number"] ?? raw.Phone);
    const date = cell(raw.Date);
    const time = cell(raw.Time);
    const timestamp = parseDateTime(date, time);
    return {
      kind: "call",
      source_tab: "Calls",
      sheet_row: sheetRow,
      phone,
      normalized_phone: normalizePhoneNumberForMatch(phone),
      date,
      time,
      timestamp: timestamp?.toISOString(),
      timestamp_ms: timestamp?.getTime(),
      booked_flag: cell(raw.Booked),
      over_2000: cell(raw["Over 2000"]),
      over_4000: cell(raw["Over 4000"]),
      form_fill_checker: cell(raw["Form Fill Checker"]),
      provenance: provenance(tab, sheetRow, raw),
    };
  });
}

export function parseBookedDealRows(tab: TabReadResult): ParsedBookedDeal[] {
  return rows(tab)
    .filter(({ raw }) => cell(raw.Timestamp).toUpperCase() !== "FORMULAS")
    .map(({ sheetRow, raw }) => {
      const timestamp = parseDate(cell(raw.Timestamp));
      const bookDate = parseDate(cell(raw["Book Date"]));
      const jobNo = cell(raw["Job Number:"]);
      const customerName = cell(raw["Customer Name"]);
      const leadSource = cell(raw["Lead Source"]);
      return {
        source_tab: "Booked Deals" as const,
        sheet_row: sheetRow,
        timestamp: timestamp?.toISOString(),
        timestamp_ms: timestamp?.getTime(),
        agent: cell(raw.Agent),
        book_date: bookDate?.toISOString(),
        book_date_ms: bookDate?.getTime(),
        job_no: jobNo,
        normalized_job_no: normalizeJobNo(jobNo),
        customer_name: customerName,
        normalized_customer_name: normalizePersonName(customerName),
        customer_name_tokens: nameTokens(customerName),
        binder_amount: parseMoney(cell(raw["Binder Amount"])),
        deposit_amount: parseMoney(cell(raw["Deposit Amount"])),
        merchant: cell(raw.Merchant),
        lead_source: leadSource,
        lid: trailingLid(raw),
        payment_notes: cell(raw["Payment Notes"]),
        is_best_relocation_source: isBestRelocationSource(leadSource),
        provenance: provenance(tab, sheetRow, raw),
      };
    });
}

export function parseRefundRows(tab: TabReadResult): ParsedRefund[] {
  return rows(tab).map(({ sheetRow, raw }) => {
    const jobNo = cell(raw["Job Number:"]);
    const customerName = cell(raw["Customer Name"]);
    const leadSource = cell(raw["Lead Source"]);
    return {
      source_tab: "Refunds",
      sheet_row: sheetRow,
      refund_request_date: parseDate(cell(raw["Refund Request Date"]))?.toISOString(),
      status: cell(raw.Status),
      timestamp: parseDate(cell(raw.Timestamp))?.toISOString(),
      agent: cell(raw.Agent),
      normalized_agent: normalizeAgentName(cell(raw.Agent)),
      book_date: parseDate(cell(raw["Book Date"]))?.toISOString(),
      job_no: jobNo,
      normalized_job_no: normalizeJobNo(jobNo),
      customer_name: customerName,
      normalized_customer_name: normalizePersonName(customerName),
      binder_amount: parseMoney(cell(raw["Binder Amount"])),
      deposit_amount: parseMoney(cell(raw["Deposit Amount"])),
      merchant: cell(raw.Merchant),
      lead_source: leadSource,
      lid: trailingLid(raw),
      is_best_relocation_source: isBestRelocationSource(leadSource),
      provenance: provenance(tab, sheetRow, raw),
    };
  });
}

export function parseLidBestRelo(tab: TabReadResult): LidBestReloEntry[] {
  const result: LidBestReloEntry[] = [];
  const bucketHeaders = (tab.matrix[1] ?? []).map(cell);
  for (let index = 2; index < tab.matrix.length; index++) {
    for (let col = 0; col < (tab.matrix[index] ?? []).length; col++) {
      const lid = cell(tab.matrix[index]?.[col]);
      if (!lid || ["<1K", ">2K", ">4K"].includes(lid)) continue;
      const header = bucketHeaders[col];
      const bucket =
        header === "<1K" || header === ">2K" || header === ">4K" ? header : "unknown";
      result.push({ lid, bucket, sheet_row: index + 1 });
    }
  }
  return result;
}

export function makeTab(
  tabName: SourceTab,
  headers: string[],
  matrix: string[][],
  spreadsheetId = "test-workbook",
): TabReadResult {
  return {
    spreadsheetId,
    spreadsheetTitle: "Test Workbook",
    tabName,
    headers,
    matrix,
    rangeRead: `${tabName}!A1:Z`,
  };
}
