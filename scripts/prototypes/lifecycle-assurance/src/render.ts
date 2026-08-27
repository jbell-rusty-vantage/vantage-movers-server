import { createHash } from "node:crypto";
import type { AssuranceReport, CountRow } from "./types.js";

function table(rows: string[][], headers: string[]): string {
  const clean = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${headers.map(clean).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((value) => clean(String(value))).join(" | ")} |`),
  ].join("\n");
}

function countTable(rows: CountRow[]): string {
  return table(rows.map((row) => [row.key, String(row.count)]), ["Group", "Count"]);
}

function florida(iso: string | null): string {
  if (!iso) return "not available";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "long",
  }).format(new Date(iso));
}

export function renderMarkdown(report: AssuranceReport): string {
  const lines: string[] = [];
  lines.push("# Lifecycle assurance proof");
  lines.push("");
  lines.push(`Generated: ${florida(report.generated_at)}  `);
  lines.push(`Database: \`${report.database}\`  `);
  lines.push(`Window: ${florida(report.window.from)} → ${florida(report.window.to)}  `);
  lines.push(`Granot activation: ${florida(report.activated_at)}`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(report.verdict);
  lines.push("");
  lines.push("**Confidence vocabulary:** `verified` means the required stored joins reconcile; `strong` means a direct immutable or official Mongo fact exists; `bounded` means Vantage is internally accountable but an external edge was not independently compared; `unknown` means the current data cannot answer.");
  lines.push("");
  lines.push("## What can be assured");
  lines.push("");
  lines.push(table(report.stages.map((stage) => [
    stage.stage,
    stage.confidence,
    stage.result,
    stage.evidence,
    stage.limitation,
  ]), ["Lifecycle point", "Confidence", "Result", "Evidence", "Limit"]));
  lines.push("");
  lines.push("## Granot receipt → Observation → latest Decision");
  lines.push("");
  lines.push(table([
    ["Receipts", String(report.granot.receipts)],
    ["Observations", String(report.granot.observations)],
    ["Latest Decisions", String(report.granot.latest_decisions)],
    ["Completed receipts without Observation", String(report.granot.completed_receipts_without_observation)],
    ["Observations without receipt", String(report.granot.observations_without_receipt)],
    ["Observations without Decision", String(report.granot.observations_without_decision)],
    ["Observations with multiple Decision attempts", String(report.granot.observations_with_multiple_attempts)],
    ["Pre-activation Observations (historical shadow)", String(report.granot.pre_activation_observations)],
    ["Post-activation Observations", String(report.granot.post_activation_observations)],
    ["Applied/created latest Decisions", String(report.granot.applied_or_created)],
    ["Applied/created with exact EntityChange", String(report.granot.applied_with_exact_entity_change)],
    ["Applied Lead entities with Sheet job", String(report.granot.applied_with_entity_sheet_job)],
  ], ["Equation", "Count"]));
  lines.push("");
  lines.push("### Receipt states");
  lines.push("");
  lines.push(countTable(report.granot.receipt_states));
  lines.push("");
  lines.push("### Observation routes");
  lines.push("");
  lines.push(countTable(report.granot.observation_routes));
  lines.push("");
  lines.push("### Latest Decision outcomes");
  lines.push("");
  lines.push(countTable(report.granot.decision_outcomes));
  lines.push("");
  lines.push("## RingCentral qualified-call assurance");
  lines.push("");
  lines.push(table([
    ["Processed qualified calls", String(report.ringcentral.processed_calls)],
    ["Materialized ledger outcomes with Call Lead", `${report.ringcentral.materialized_with_call_lead}/${report.ringcentral.materialized_expected}`],
    ["Call Log covered through", report.ringcentral.covered_through ? florida(report.ringcentral.covered_through) : "not available"],
    ["Cursor lag minutes", report.ringcentral.cursor_lag_minutes == null ? "not available" : String(report.ringcentral.cursor_lag_minutes)],
    ["Last run", `${report.ringcentral.last_run_status ?? "unknown"} / ${report.ringcentral.last_error ?? "no error"}`],
    ["Last run counts", `${report.ringcentral.last_run_counts.processed ?? "?"} processed / ${report.ringcentral.last_run_counts.qualified ?? "?"} qualified / ${report.ringcentral.last_run_counts.lead_actions ?? "?"} Lead actions`],
  ], ["Proof", "Result"]));
  lines.push("");
  lines.push("Statuses:");
  lines.push("");
  lines.push(countTable(report.ringcentral.statuses));
  lines.push("");
  lines.push("Ingestion paths:");
  lines.push("");
  lines.push(countTable(report.ringcentral.ingestion_sources));
  lines.push("");
  lines.push("## Lead and official lifecycle activity");
  lines.push("");
  lines.push("### Leads created by origin");
  lines.push("");
  lines.push(countTable(report.lifecycle.leads_by_origin));
  lines.push("");
  lines.push(`Creation EntityChange coverage: **${report.lifecycle.leads_with_create_change}** Leads.`);
  lines.push("");
  lines.push("### Text messages");
  lines.push("");
  lines.push(countTable(report.lifecycle.messages_by_status));
  lines.push("");
  lines.push(countTable(report.lifecycle.messages_by_origin));
  lines.push("");
  lines.push("### Updates by command");
  lines.push("");
  lines.push(countTable(report.lifecycle.changes_by_command));
  lines.push("");
  lines.push("### Changed paths");
  lines.push("");
  lines.push(countTable(report.lifecycle.changed_paths));
  lines.push("");
  lines.push("### Booking and Cancellation");
  lines.push("");
  lines.push(table([
    ["Booking intake cases", String(report.lifecycle.booking_cases_by_state.reduce((sum, row) => sum + row.count, 0))],
    ["Official Bookings", String(report.lifecycle.official_bookings)],
    ["Resolved Booking cases with official fact", `${report.lifecycle.resolved_booking_cases_with_official_fact}/${report.lifecycle.resolved_booking_cases}`],
    ["Finalizing Booking cases with official fact", `${report.lifecycle.finalized_booking_cases_with_official_fact}/${report.lifecycle.finalized_booking_cases}`],
    ["Cancellation intake cases", String(report.lifecycle.cancellation_cases_by_state.reduce((sum, row) => sum + row.count, 0))],
    ["Official Cancellations", String(report.lifecycle.official_cancellations)],
    ["Resolved Cancellation cases with official fact", `${report.lifecycle.resolved_cancellation_cases_with_official_fact}/${report.lifecycle.resolved_cancellation_cases}`],
    ["Finalizing Cancellation cases with official fact", `${report.lifecycle.finalized_cancellation_cases_with_official_fact}/${report.lifecycle.finalized_cancellation_cases}`],
    ["Historical Cancellations with surviving Booking", `${report.lifecycle.historical_cancellations_with_surviving_booking}/${report.lifecycle.historical_cancellations}`],
    ["Historical Cancellations with resolvable Job Number", `${report.lifecycle.historical_cancellations_with_resolvable_job}/${report.lifecycle.historical_cancellations}`],
  ], ["Point", "Count"]));
  lines.push("");
  lines.push("Booking cases:");
  lines.push("");
  lines.push(countTable(report.lifecycle.booking_cases_by_state));
  lines.push("");
  lines.push("Cancellation cases:");
  lines.push("");
  lines.push(countTable(report.lifecycle.cancellation_cases_by_state));
  lines.push("");
  lines.push("## Sheet assurance");
  lines.push("");
  lines.push(countTable(report.sheets.statuses));
  lines.push("");
  lines.push(`Terminal failures: **${report.sheets.terminal_failures}**. Destination read-back verified: **no**.`);
  lines.push("");
  lines.push("A `synced` job is evidence that the write-behind process completed. It is not proof that the current Google row still equals Mongo. This report deliberately does not call that destination-verified.");
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push(table(report.findings.map((finding) => [
    finding.severity,
    finding.code,
    finding.statement,
    finding.count == null ? "" : String(finding.count),
  ]), ["State", "Code", "Statement", "Count"]));
  lines.push("");
  lines.push("## Faithful masked timelines");
  lines.push("");
  lines.push("Aggregate equations above are strictly window-bound. These examples are deliberately full-history Job chains, so they can prove lifecycle shapes whose final event falls outside the selected window.");
  lines.push("");
  if (report.timelines.length === 0) {
    lines.push("No Job Number timeline candidate was found in this window.");
  }
  for (const timeline of report.timelines) {
    lines.push(`### ${timeline.label} — ${timeline.proof_shape}`);
    lines.push("");
    lines.push(`Present: ${timeline.stages.join(", ") || "none"}  `);
    lines.push(`Absent: ${timeline.missing_stages.join(", ") || "none"}`);
    lines.push("");
    lines.push(table(timeline.events.map((event) => [event.event_at, event.kind, event.headline]), [
      "Event at", "Kind", "Headline",
    ]));
    lines.push("");
  }
  lines.push("## Read-only proof and remaining edge questions");
  lines.push("");
  lines.push(`Mongo operations used: ${report.read_only_proof.source_operations.map((op) => `\`${op}\``).join(", ")}.`);
  lines.push("");
  lines.push(countTable(Object.entries(report.read_only_proof.collection_count_deltas).map(([key, count]) => ({ key, count }))));
  lines.push("");
  lines.push(report.read_only_proof.note);
  lines.push("");
  lines.push("The next confidence upgrades are concrete: add a WordPress receipt/idempotency ledger, persist RingCentral poll-window/watermark manifests, and read back Google rows by Mongo ID plus a canonical projection hash. Until then, the report must retain `bounded` at those edges.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function stableId(label: string): string {
  return createHash("sha256").update(label).digest("hex").slice(0, 16);
}

export function renderCanvas(report: AssuranceReport): { nodes: unknown[]; edges: unknown[] } {
  const nodes = [
    { id: stableId("verdict"), type: "text", x: 0, y: 0, width: 520, height: 220, color: report.findings.some((row) => row.severity === "gap") ? "1" : "4", text: `# Lifecycle assurance\n\n${report.verdict}\n\n${report.window.from} → ${report.window.to}` },
    { id: stableId("source"), type: "text", x: -640, y: 320, width: 440, height: 300, color: "3", text: `# Source edge · bounded\n\nStored Leads: ${report.lifecycle.leads_by_origin.reduce((sum, row) => sum + row.count, 0)}\n\nWordPress receipt ledger: not checked\nRingCentral ledger: ${report.ringcentral.materialized_with_call_lead}/${report.ringcentral.materialized_expected} materialized\nRingCentral cursor lag: ${report.ringcentral.cursor_lag_minutes ?? "?"}m` },
    { id: stableId("granot"), type: "text", x: -100, y: 320, width: 440, height: 300, color: report.granot.observations_without_decision > 0 ? "1" : "4", text: `# Granot chain\n\nReceipts: ${report.granot.receipts}\nObservations: ${report.granot.observations}\nLatest Decisions: ${report.granot.latest_decisions}\nMissing Decisions: ${report.granot.observations_without_decision}\nExact Changes: ${report.granot.applied_with_exact_entity_change}/${report.granot.applied_or_created}` },
    { id: stableId("official"), type: "text", x: 440, y: 320, width: 440, height: 300, color: "4", text: `# Official lifecycle\n\nBooking cases: ${report.lifecycle.booking_cases_by_state.reduce((sum, row) => sum + row.count, 0)}\nOfficial Bookings: ${report.lifecycle.official_bookings}\nCancellation cases: ${report.lifecycle.cancellation_cases_by_state.reduce((sum, row) => sum + row.count, 0)}\nOfficial Cancellations: ${report.lifecycle.official_cancellations}` },
    { id: stableId("sheets"), type: "text", x: 980, y: 320, width: 440, height: 260, color: report.sheets.terminal_failures > 0 ? "1" : "3", text: `# Sheet edge · bounded\n\nJobs: ${report.sheets.jobs}\nTerminal failures: ${report.sheets.terminal_failures}\nGoogle destination verified: no\n\nOutbox success is not row equality.` },
    { id: stableId("timeline"), type: "text", x: 440, y: 760, width: 520, height: 300, color: "5", text: `# Masked timeline proof\n\n${report.timelines.map((row) => `${row.label}: ${row.stages.join(" → ") || "no stages"}`).join("\n\n") || "No candidate timelines"}` },
  ];
  const edges = [
    ["source", "granot", "received / matched"],
    ["granot", "official", "intake / owner command"],
    ["official", "sheets", "outbox"],
    ["granot", "timeline", "evidence"],
    ["official", "timeline", "official facts"],
  ].map(([from, to, label]) => ({
    id: stableId(`${from}-${to}`),
    fromNode: stableId(from),
    fromSide: "right",
    toNode: stableId(to),
    toSide: "left",
    toEnd: "arrow",
    label,
  }));
  return { nodes, edges };
}

export function validateCanvas(canvas: { nodes: unknown[]; edges: unknown[] }): void {
  const nodes = canvas.nodes as Array<{ id: string }>;
  const edges = canvas.edges as Array<{ id: string; fromNode: string; toNode: string }>;
  const ids = [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)];
  if (new Set(ids).size !== ids.length) throw new Error("Canvas IDs are not unique");
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      throw new Error(`Canvas edge ${edge.id} is dangling`);
    }
  }
}
