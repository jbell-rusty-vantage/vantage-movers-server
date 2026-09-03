import fs from "node:fs/promises";
import path from "node:path";
import type { BestRelocationApplicationPlan } from "./applicationPlan";
import type { BestRelocationTabCount } from "./sheets";

export type BestRelocationDryRunReportInput = {
  outputDirectory: string;
  checksum: string;
  inspection: {
    cutoff: string;
    source_read_through: string;
    leads: { id: string; title: string };
    booked: { id: string; title: string };
    tabs: BestRelocationTabCount[];
  };
  raw_counters: Record<string, number>;
  policy_plan: BestRelocationApplicationPlan;
  policy: {
    receipts_applied: boolean;
    canonical_adoption_applied: boolean;
    connection_id?: string;
  };
};

export async function writeBestRelocationDryRunReports(
  input: BestRelocationDryRunReportInput,
): Promise<{ markdownPath: string; jsonPath: string }> {
  await fs.mkdir(input.outputDirectory, { recursive: true, mode: 0o700 });
  const summary = summarize(input);
  const markdownPath = path.join(input.outputDirectory, "DRY-RUN-REPORT.md");
  const jsonPath = path.join(input.outputDirectory, "dry-run-report.json");
  await fs.writeFile(markdownPath, formatMarkdown(summary), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { markdownPath, jsonPath };
}

function summarize(input: BestRelocationDryRunReportInput) {
  const actions = input.policy_plan.actions;
  const byCommand: Record<string, number> = {};
  const byDataset: Record<string, Record<string, number>> = {};
  const adoptionMethods: Record<string, number> = {};
  const conflicts: Array<{
    dataset_key: string;
    type?: string;
    severity?: string;
    method?: string;
    job_no?: string;
  }> = [];
  const bookings: Array<{
    classification: string;
    command: string;
    job_no?: string;
    method?: string;
    score?: number;
  }> = [];

  for (const action of actions) {
    byCommand[action.command] = (byCommand[action.command] ?? 0) + 1;
    const dataset = (byDataset[action.dataset_key] ??= {});
    dataset[action.classification] = (dataset[action.classification] ?? 0) + 1;
    if (action.classification === "adoption" && action.matching?.method) {
      adoptionMethods[action.matching.method] =
        (adoptionMethods[action.matching.method] ?? 0) + 1;
    }
    if (action.classification === "conflict") {
      conflicts.push({
        dataset_key: action.dataset_key,
        type: action.conflict?.type,
        severity: action.conflict?.severity,
        method: action.matching?.method,
        job_no: jobNoFromAction(action),
      });
    }
    if (action.dataset_key === "booked_deals" || action.dataset_key === "refunds") {
      bookings.push({
        classification: action.classification,
        command: action.command,
        job_no: jobNoFromAction(action),
        method: action.matching?.method,
        score: action.matching?.score,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    cutoff: input.inspection.cutoff,
    timezone: "America/New_York",
    source_read_through: input.inspection.source_read_through,
    plan_checksum: input.checksum,
    workbooks: {
      leads: maskWorkbook(input.inspection.leads),
      booked: maskWorkbook(input.inspection.booked),
    },
    policy: input.policy,
    tab_inspection: input.inspection.tabs,
    raw_planner_counters: input.raw_counters,
    policy_counters: input.policy_plan.counters,
    commands: byCommand,
    datasets: byDataset,
    adoption_methods: adoptionMethods,
    booking_and_refund_actions: bookings,
    conflicts,
    warnings: input.policy_plan.warnings,
  };
}

function formatMarkdown(summary: ReturnType<typeof summarize>): string {
  const tabRows = summary.tab_inspection
    .map(
      (tab) =>
        `| ${tab.tab} | ${tab.populated_rows} | ${tab.parsed_rows} | ${tab.in_window_rows} | ${tab.pre_cutoff_rows} | ${tab.missing_timestamp_rows} | ${tab.missing_durable_identity_rows} | ${tab.best_relocation_source_rows ?? "—"} | ${tab.in_window_best_relocation_source_rows ?? "—"} |`,
    )
    .join("\n");
  const datasetRows = Object.entries(summary.datasets)
    .map(([dataset, counts]) => {
      const parts = Object.entries(counts)
        .map(([classification, count]) => `${classification}: ${count}`)
        .join(", ");
      return `- **${dataset}**: ${parts}`;
    })
    .join("\n");
  const adoptionRows = Object.keys(summary.adoption_methods).length
    ? Object.entries(summary.adoption_methods)
        .map(([method, count]) => `- \`${method}\`: **${count}**`)
        .join("\n")
    : "_None._";
  const bookingRows = summary.booking_and_refund_actions.length
    ? summary.booking_and_refund_actions
        .map((row) => {
          const job = row.job_no ? ` \`${row.job_no}\`` : "";
          const match = row.method
            ? ` (${row.method}${row.score !== undefined ? ` @ ${row.score}` : ""})`
            : "";
          return `- ${row.classification} / \`${row.command}\`${job}${match}`;
        })
        .join("\n")
    : "_None._";
  const conflictRows = summary.conflicts.length
    ? summary.conflicts
        .map((row) => {
          const job = row.job_no ? ` job \`${row.job_no}\`` : "";
          return `- **${row.dataset_key}** ${row.type ?? "unknown"} (${row.severity ?? "n/a"})${job}`;
        })
        .join("\n")
    : "_None._";

  return [
    "# Best Relocation ingest dry-run report",
    "",
    `Generated: ${summary.generated_at}`,
    `Cutoff: **${summary.cutoff}** (${summary.timezone})`,
    `Source read-through: ${summary.source_read_through}`,
    `Plan checksum: \`${summary.plan_checksum}\``,
    "",
    "## Policy",
    "",
    `- Receipt skip/adopt applied: **${summary.policy.receipts_applied}**`,
    `- Canonical adopt-before-create applied: **${summary.policy.canonical_adoption_applied}**`,
    summary.policy.connection_id
      ? `- Connection: \`${summary.policy.connection_id}\``
      : "- Connection: not found (receipt policy skipped)",
    "",
    "## Workbooks",
    "",
    `- Leads: ${summary.workbooks.leads.title} (\`${summary.workbooks.leads.masked_id}\`)`,
    `- Booked Deal Form Responses: ${summary.workbooks.booked.title} (\`${summary.workbooks.booked.masked_id}\`)`,
    "",
    "## Tab inspection",
    "",
    "Rows at or after 2026-04-30 Eastern may enter the plan. Pre-cutoff rows never become actions. Refunds are Cancellations.",
    "",
    "| Tab | Populated | Parsed | In window | Pre-cutoff | Missing timestamp | Missing identity | BR source | BR source in window |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    tabRows,
    "",
    "## Planner vs policy",
    "",
    `- Raw planner: ${JSON.stringify(summary.raw_planner_counters)}`,
    `- After skip/adopt: ${JSON.stringify(summary.policy_counters)}`,
    "",
    "## Commands after policy",
    "",
    Object.entries(summary.commands)
      .map(([command, count]) => `- \`${command}\`: **${count}**`)
      .join("\n"),
    "",
    "## By dataset",
    "",
    datasetRows,
    "",
    "## Adoption methods",
    "",
    adoptionRows,
    "",
    "## Booked Deals and Refunds (job numbers only)",
    "",
    bookingRows,
    "",
    "## Conflicts",
    "",
    conflictRows,
    "",
    "## Notes",
    "",
    "- This report has no customer names, phones, or emails.",
    "- `adopt_existing` writes a receipt only. It does not mint a second Form Lead.",
    "- `create_cancelled_lead` is a Cancellation from the Refunds tab.",
    "- Below-threshold Booked Deal matches stay leadless plus a reconciliation conflict.",
    ...(summary.warnings.length
      ? summary.warnings.map((warning) => `- ${warning}`)
      : []),
    "",
  ].join("\n");
}

function jobNoFromAction(action: {
  command_payload?: Record<string, unknown>;
  stable_source_row_id: string;
}): string | undefined {
  const payload = action.command_payload ?? {};
  const raw = payload.job_no ?? payload.call_job_no;
  if (typeof raw === "string" && raw.trim()) return raw.trim().toUpperCase();
  const fromId = action.stable_source_row_id.match(/^booking:(.+)$/i);
  return fromId?.[1];
}

function maskWorkbook(input: { id: string; title: string }): {
  title: string;
  masked_id: string;
} {
  const id = input.id.trim();
  const masked =
    id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
  return { title: input.title, masked_id: masked };
}
