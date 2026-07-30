import fs from "node:fs/promises";
import path from "node:path";
import { createGoogleSheetsClient } from "./google-sheets-auth";
import {
  cell,
  getHeaderMap,
  isBlankRow,
  type ParsedSheetRow,
  type SheetRow,
} from "./sheet-read-utils";

type FieldKind = "agent" | "customer";

type PatternSignal =
  | "forward_slash"
  | "backslash"
  | "ampersand"
  | "plus"
  | "comma"
  | "word_and"
  | "repeated_separator"
  | "terminal_split"
  | "terminal_percentage";

type PatternBucket = {
  rows: number;
  source_rows: number[];
};

type FieldAudit = {
  populated_rows: number;
  rows_with_any_signal: number;
  signal_counts: Record<PatternSignal, number>;
  signal_source_rows: Record<PatternSignal, number[]>;
  pattern_combinations: Record<string, PatternBucket>;
  candidate_segment_counts: Record<string, number>;
};

type CrossFieldAudit = {
  customer_signal_rows_with_agent_signal: number;
  customer_segments_matching_known_agent_atoms: number;
  customer_rows_with_agent_atom_match: number[];
};

const OUTPUT_DIR = path.join(process.cwd(), "scripts", "historical", "reports");
const BOOKED_SHEET_ID_ENV = "BACKFILL_BOOKED_SHEET_ID";
const MAX_SOURCE_ROWS_PER_BUCKET = 100;

const SIGNALS: readonly PatternSignal[] = [
  "forward_slash",
  "backslash",
  "ampersand",
  "plus",
  "comma",
  "word_and",
  "repeated_separator",
  "terminal_split",
  "terminal_percentage",
];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueFrom(row: SheetRow, ...aliases: string[]): string {
  const valuesByHeader = new Map(
    Object.entries(row).map(([header, value]) => [
      normalizedHeader(header),
      cell(value),
    ]),
  );
  for (const alias of aliases) {
    const value = valuesByHeader.get(normalizedHeader(alias));
    if (value) return value;
  }
  return "";
}

function normalizedName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function signalsFor(value: string): PatternSignal[] {
  const signals: PatternSignal[] = [];
  if (value.includes("/")) signals.push("forward_slash");
  if (value.includes("\\")) signals.push("backslash");
  if (value.includes("&")) signals.push("ampersand");
  if (value.includes("+")) signals.push("plus");
  if (value.includes(",")) signals.push("comma");
  if (/\band\b/i.test(value)) signals.push("word_and");
  if (/(?:\/\s*){2,}|(?:\\\s*){2,}|(?:&\s*){2,}|(?:\+\s*){2,}/.test(value)) {
    signals.push("repeated_separator");
  }
  if (/\bsplit\s*$/i.test(value)) signals.push("terminal_split");
  if (/\b\d{1,3}(?:\.\d+)?\s*%\s*$/i.test(value)) {
    signals.push("terminal_percentage");
  }
  return signals;
}

function splitCandidateSegments(value: string): string[] {
  return value
    .replace(/\bsplit\s*$/i, "")
    .replace(/\b\d{1,3}(?:\.\d+)?\s*%\s*$/i, "")
    .split(/\s*(?:\/|\\|&|\+|\band\b)\s*/i)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function cappedPush(target: number[], value: number): void {
  if (target.length < MAX_SOURCE_ROWS_PER_BUCKET) target.push(value);
}

function emptyFieldAudit(): FieldAudit {
  const signalCounts = {} as Record<PatternSignal, number>;
  const signalSourceRows = {} as Record<PatternSignal, number[]>;
  for (const signal of SIGNALS) {
    signalCounts[signal] = 0;
    signalSourceRows[signal] = [];
  }
  return {
    populated_rows: 0,
    rows_with_any_signal: 0,
    signal_counts: signalCounts,
    signal_source_rows: signalSourceRows,
    pattern_combinations: {},
    candidate_segment_counts: {},
  };
}

function auditField(
  rows: ParsedSheetRow[],
  aliases: string[],
): FieldAudit {
  const audit = emptyFieldAudit();
  for (const { sheetRow, raw } of rows) {
    const value = valueFrom(raw, ...aliases);
    if (!value) continue;
    audit.populated_rows += 1;
    const signals = signalsFor(value);
    if (signals.length === 0) continue;
    audit.rows_with_any_signal += 1;
    for (const signal of signals) {
      audit.signal_counts[signal] += 1;
      cappedPush(audit.signal_source_rows[signal], sheetRow);
    }
    const patternKey = signals.join("+");
    const bucket = (audit.pattern_combinations[patternKey] ??= {
      rows: 0,
      source_rows: [],
    });
    bucket.rows += 1;
    cappedPush(bucket.source_rows, sheetRow);

    const segmentCount = splitCandidateSegments(value).length;
    audit.candidate_segment_counts[String(segmentCount)] =
      (audit.candidate_segment_counts[String(segmentCount)] ?? 0) + 1;
  }
  return audit;
}

function knownAgentAtoms(rows: ParsedSheetRow[]): Set<string> {
  const atoms = new Set<string>();
  for (const { raw } of rows) {
    const rawAgent = valueFrom(raw, "Agent");
    for (const segment of splitCandidateSegments(rawAgent)) {
      const normalized = normalizedName(segment);
      if (normalized) atoms.add(normalized);
    }
  }
  return atoms;
}

function auditCrossField(
  rows: ParsedSheetRow[],
  agentAtoms: Set<string>,
): CrossFieldAudit {
  let customerSignalRowsWithAgentSignal = 0;
  let customerSegmentsMatchingKnownAgentAtoms = 0;
  const customerRowsWithAgentAtomMatch: number[] = [];

  for (const { sheetRow, raw } of rows) {
    const customer = valueFrom(raw, "Customer Name", "Customer");
    const agent = valueFrom(raw, "Agent");
    if (signalsFor(customer).length > 0 && signalsFor(agent).length > 0) {
      customerSignalRowsWithAgentSignal += 1;
    }
    const matchingSegments = splitCandidateSegments(customer).filter((segment) =>
      agentAtoms.has(normalizedName(segment)),
    );
    if (matchingSegments.length > 0) {
      customerSegmentsMatchingKnownAgentAtoms += matchingSegments.length;
      cappedPush(customerRowsWithAgentAtomMatch, sheetRow);
    }
  }

  return {
    customer_signal_rows_with_agent_signal: customerSignalRowsWithAgentSignal,
    customer_segments_matching_known_agent_atoms:
      customerSegmentsMatchingKnownAgentAtoms,
    customer_rows_with_agent_atom_match: customerRowsWithAgentAtomMatch,
  };
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function readUsedTab(
  spreadsheetId: string,
  tabName: string,
): Promise<ParsedSheetRow[]> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:ZZ`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const matrix = (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  const headers = matrix[0] ?? [];
  const rows: ParsedSheetRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index] ?? [];
    if (isBlankRow(row)) continue;
    rows.push({
      sheetRow: index + 1,
      raw: getHeaderMap(headers, row),
    });
  }
  return rows;
}

function fieldMarkdown(label: string, audit: FieldAudit): string[] {
  const lines = [
    `### ${label}`,
    "",
    `- Populated rows: ${audit.populated_rows}`,
    `- Rows with any profiled signal: ${audit.rows_with_any_signal}`,
    "",
    "| Signal | Rows | Source rows (capped) |",
    "|---|---:|---|",
  ];
  for (const signal of SIGNALS) {
    lines.push(
      `| ${signal} | ${audit.signal_counts[signal]} | ${audit.signal_source_rows[signal].join(", ")} |`,
    );
  }
  lines.push(
    "",
    `- Candidate segment counts: ${Object.entries(audit.candidate_segment_counts)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([segments, count]) => `${segments}=${count}`)
      .join(", ") || "(none)"}`,
    "",
  );
  return lines;
}

function markdownReport(report: {
  generated_at: string;
  tabs: Record<
    string,
    {
      rows: number;
      agent: FieldAudit;
      customer: FieldAudit;
      cross_field: CrossFieldAudit;
    }
  >;
}): string {
  const lines = [
    "# Historical booking name-pattern audit",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "Read-only aggregate audit. Raw agent and customer values are intentionally excluded; source row numbers are retained for reproducible review.",
    "",
  ];
  for (const [tabName, tab] of Object.entries(report.tabs)) {
    lines.push(
      `## ${tabName}`,
      "",
      `Rows: ${tab.rows}`,
      "",
      ...fieldMarkdown("Agent", tab.agent),
      ...fieldMarkdown("Customer", tab.customer),
      "### Cross-field indicators",
      "",
      `- Customer-signal rows whose Agent field also has a signal: ${tab.cross_field.customer_signal_rows_with_agent_signal}`,
      `- Customer segments equal to a known normalized Agent atom: ${tab.cross_field.customer_segments_matching_known_agent_atoms}`,
      `- Source rows with an Agent-atom match (capped): ${tab.cross_field.customer_rows_with_agent_atom_match.join(", ") || "(none)"}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const spreadsheetId = requiredEnv(BOOKED_SHEET_ID_ENV);
  const bookedRows = await readUsedTab(spreadsheetId, "Booked Deals");
  const refundRows = await readUsedTab(spreadsheetId, "Refunds");
  const agentAtoms = knownAgentAtoms([...bookedRows, ...refundRows]);
  const report = {
    generated_at: new Date().toISOString(),
    mode: "read-only",
    pii_policy: "aggregate-and-source-row-ids-only",
    source_row_cap_per_bucket: MAX_SOURCE_ROWS_PER_BUCKET,
    tabs: {
      "Booked Deals": {
        rows: bookedRows.length,
        agent: auditField(bookedRows, ["Agent"]),
        customer: auditField(bookedRows, ["Customer Name", "Customer"]),
        cross_field: auditCrossField(bookedRows, agentAtoms),
      },
      Refunds: {
        rows: refundRows.length,
        agent: auditField(refundRows, ["Agent"]),
        customer: auditField(refundRows, ["Customer Name", "Customer"]),
        cross_field: auditCrossField(refundRows, agentAtoms),
      },
    },
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "name-pattern-audit.json");
  const markdownPath = path.join(OUTPUT_DIR, "name-pattern-audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, markdownReport(report));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
