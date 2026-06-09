import type {
  GranotCsvDataRow,
  GranotCsvRecord,
  ParsedGranotCsv,
} from "./types";

const MONGO_OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export function parseGranotCsv(csvText: string): ParsedGranotCsv {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) {
    return emptyParsed();
  }

  const headers = records[0].map(normalizeCsvHeader);
  const rows: GranotCsvDataRow[] = [];
  let skippedRows = 0;

  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index];
    if (cells.every((cell) => !cell.trim())) {
      skippedRows += 1;
      continue;
    }

    const record = cellsToRecord(headers, cells);
    if (!isGranotDataRow(record)) {
      skippedRows += 1;
      continue;
    }

    rows.push({
      ...record,
      rowIndex: index,
      rowKey: buildRowKey(record),
    });
  }

  return {
    headers,
    rows,
    counts: {
      total: Math.max(records.length - 1, 0),
      dataRows: rows.length,
      skippedRows,
    },
  };
}

export function parseCsvRecords(csvText: string): string[][] {
  const normalized = csvText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  return records.filter((record) => record.some((value) => value.trim()));
}

export function normalizeCsvHeader(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function emptyParsed(): ParsedGranotCsv {
  return {
    headers: [],
    rows: [],
    counts: { total: 0, dataRows: 0, skippedRows: 0 },
  };
}

function cellsToRecord(headers: string[], cells: string[]): GranotCsvRecord {
  const record: GranotCsvRecord = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (!header) {
      continue;
    }
    record[header] = normalizeCsvCell(cells[index] ?? "");
  }
  return record;
}

function normalizeCsvCell(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGranotDataRow(record: GranotCsvRecord): boolean {
  const jobNo = cleanValue(record.job_no);
  const refNo = cleanValue(record.ref_no);
  const phone = cleanValue(record.phone);
  const customer = cleanValue(record.customer);

  if (jobNo) {
    return true;
  }
  if (refNo && MONGO_OBJECT_ID_RE.test(refNo)) {
    return true;
  }
  return Boolean(phone && customer);
}

function buildRowKey(record: GranotCsvRecord): string {
  const jobNo = cleanValue(record.job_no);
  if (jobNo) {
    return `job:${jobNo}`;
  }

  const refNo = cleanValue(record.ref_no);
  if (refNo && MONGO_OBJECT_ID_RE.test(refNo)) {
    return `ref:${refNo}`;
  }

  const phone = normalizePhoneKey(record.phone);
  const email = cleanValue(record.email)?.toLowerCase();
  if (phone && email) {
    return `contact:${phone}|${email}`;
  }
  if (phone) {
    return `phone:${phone}`;
  }

  const customer = cleanValue(record.customer)?.toLowerCase();
  return `row:${customer ?? "unknown"}:${record.no ?? "0"}`;
}

export function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === "\u00a0") {
    return undefined;
  }
  return cleaned;
}

function normalizePhoneKey(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits || undefined;
}
