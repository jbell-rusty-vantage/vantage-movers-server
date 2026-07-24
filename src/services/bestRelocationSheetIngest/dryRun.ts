import fs from "node:fs/promises";
import path from "node:path";
import type { IngestPlan } from "./types";

export async function writeDryRunArtifacts(
  plan: IngestPlan,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await fs.mkdir(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, "ingest-plan.json");
  const markdownPath = path.join(outputDirectory, "ingest-plan-summary.md");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
    fs.writeFile(markdownPath, formatPlanSummary(plan), {
      encoding: "utf8",
      mode: 0o600,
    }),
  ]);
  return { jsonPath, markdownPath };
}

export function formatPlanSummary(plan: IngestPlan): string {
  const counts = plan.summary.mutations;
  const unmatched = plan.unmatched_booking_jobs.length
    ? plan.unmatched_booking_jobs
        .map(
          (row) =>
            `- \`${row.job_no}\` (sheet rows ${row.rows.join(", ")}${
              row.best_match_confidence === undefined
                ? ""
                : `; best rejected match ${row.best_match_method} @ ${row.best_match_confidence}`
            })`,
        )
        .join("\n")
    : "_None._";
  return [
    "# Best Relocation ingest dry run",
    "",
    `Generated: ${plan.generated_at}`,
    `Production target: \`${plan.base_url}\``,
    `Match threshold: **${plan.threshold}**`,
    "",
    "## Planned mutations",
    "",
    `- Form leads: **${counts.create_form_lead}** (${plan.summary.local_forms} local)`,
    `- Call leads: **${counts.create_call_lead}**`,
    `- Bookings from source: **${counts.create_booked_from_source}**`,
    `- Leadless bookings: **${counts.create_leadless_booking}**`,
    `- Cancellations/refunds: **${counts.create_cancelled_lead}**`,
    `- Total: **${plan.mutations.length}**`,
    "",
    "## Booking coverage",
    "",
    `- Source rows: **${plan.summary.booking_rows}**`,
    `- Unique jobs: **${plan.summary.booking_jobs}**`,
    `- Rows collapsed into another allocation: **${plan.summary.collapsed_booking_rows}**`,
    `- Accepted lead attachments: **${plan.summary.accepted_booking_matches}**`,
    "",
    "## Unmatched / below-threshold booking jobs",
    "",
    unmatched,
    "",
    "## Refund coverage",
    "",
    `- Best Relocation refunds: **${plan.summary.refunds}**`,
    `- Planned cancellations: **${plan.summary.matched_refunds}**`,
    `- Unmatched refunds: **${plan.summary.unmatched_refunds}**`,
    "",
    "## Notes",
    "",
    ...plan.warnings.map((warning) => `- ${warning}`),
    "",
    "The sibling `ingest-plan.json` contains the ordered endpoint, payload, idempotency key, dependency binding, confidence, and source-row provenance for every proposed request.",
    "",
  ].join("\n");
}
