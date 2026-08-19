/**
 * Read-only Granot lifecycle dry-run against vantagemovers.
 *
 * Does not persist observations, decisions, leads, links, or booking cases.
 * Reuses normalizeGranotReceipt, resolveSourcePolicy, resolveLeadIdentity,
 * planLeadDesiredState, evaluateEffectGates, classifyBookingReconciliation,
 * findPreCreationRingCentralConvergenceCandidates, and
 * classifyRingCentralCallLeadDuplicate.
 *
 *   pnpm granot:lifecycle:dry-run -- --confirm-production-db=vantagemovers
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getGranotCrmSourceModel } from "../../../../src/models/GranotCrmSource.js";
import { getGranotObservationModel } from "../../../../src/models/GranotObservation.js";
import { getGranotObservationReceiptModel } from "../../../../src/models/GranotObservationReceipt.js";
import { getGranotLifecycleActivationModel } from "../../../../src/models/GranotLifecycleActivation.js";
import { getGranotRecordLinkModel } from "../../../../src/models/GranotRecordLink.js";
import {
  PRODUCTION_CONFIRMATION,
  assertProductionDryRunArgs,
  withProductionReadOnly,
} from "./lib/connect-production-readonly.js";
import {
  buildHypotheticalSources,
  createHypotheticalPolicyStore,
  loadProductionCatalog,
} from "./lib/hypothetical-registry.js";
import {
  createConfiguredPolicyStore,
  currentFlags,
  planReceipt,
  redactCase,
  type DryRunPolicyMode,
  type LegacyWebhookReceipt,
  type ReceiptDryRun,
} from "./lib/planner.js";

const OUTPUT_ROOT = path.join("scripts", "output", "granot-lifecycle-dry-runs");

type SampleOptions = {
  perCohort: number;
  bookingLimit: number;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  assertProductionDryRunArgs(args);
  const options = parseOptions(args);
  const started = Date.now();

  await withProductionReadOnly(async () => {
    const flags = currentFlags();
    const now = new Date();
    const catalog = await loadProductionCatalog();
    const observationOnlySources = buildHypotheticalSources(catalog, "observation_only");
    const createIfMissingSources = buildHypotheticalSources(catalog, "create_if_missing");
    const stores: Array<{ mode: DryRunPolicyMode; store: ReturnType<typeof createConfiguredPolicyStore> }> = [
      { mode: "as_configured", store: createConfiguredPolicyStore() },
      {
        mode: "hypothetical_observation_only",
        store: createHypotheticalPolicyStore(catalog, observationOnlySources),
      },
      {
        mode: "hypothetical_create_if_missing",
        store: createHypotheticalPolicyStore(catalog, createIfMissingSources),
      },
    ];

    const inventory = await loadInventory(catalog, observationOnlySources);
    const receipts = await sampleReceipts(options);
    const cases: ReceiptDryRun[] = [];
    for (const [index, receipt] of receipts.entries()) {
      if ((index + 1) % 25 === 0 || index === 0) {
        console.log(`Planning ${index + 1}/${receipts.length} receipts…`);
      }
      cases.push(
        redactCase(
          await planReceipt({
            receipt,
            flags,
            now,
            stores,
          }),
        ),
      );
    }

    const outDir = path.join(OUTPUT_ROOT, String(Date.now()));
    await mkdir(outDir, { recursive: true });
    const reports = buildReports({
      outDir,
      started,
      flags,
      inventory,
      cases,
      options,
      hypotheticalSources: observationOnlySources,
    });
    await Promise.all(
      Object.entries(reports).map(([name, body]) =>
        writeFile(path.join(outDir, name), body, "utf8"),
      ),
    );
    console.log(`Wrote ${Object.keys(reports).length} reports to ${outDir}`);
    console.log(`Receipts planned: ${cases.length}`);
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  });
}

function parseOptions(args: readonly string[]): SampleOptions {
  return {
    perCohort: numberFlag(args, "--per-cohort", 6),
    bookingLimit: numberFlag(args, "--booking-limit", 40),
  };
}

function numberFlag(args: readonly string[], name: string, fallback: number): number {
  const raw = args.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function loadInventory(
  catalog: Awaited<ReturnType<typeof loadProductionCatalog>>,
  hypothetical: ReturnType<typeof buildHypotheticalSources>,
) {
  const Receipt = getGranotObservationReceiptModel();
  const [
    receiptTotal,
    receiptByEvent,
    crmSources,
    observations,
    activations,
    recordLinks,
  ] = await Promise.all([
    Receipt.countDocuments({}),
    Receipt.aggregate<{ _id: { event_type?: string; payload_event?: string; source?: string }; count: number }>([
      {
        $group: {
          _id: {
            event_type: "$event_type",
            payload_event: "$payload.event_type",
            source: "$payload.source",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    getGranotCrmSourceModel().find({}).lean().exec(),
    getGranotObservationModel().countDocuments({}),
    getGranotLifecycleActivationModel().find({}).lean().exec(),
    getGranotRecordLinkModel().countDocuments({}),
  ]);
  return {
    receiptTotal,
    receiptByEvent,
    crmSources: crmSources.map((row) => ({
      id: String(row._id),
      label: row.normalized_granot_label ?? row.granot_label,
      enabled: row.enabled === true,
      lifecycle_enabled: row.lifecycle_enabled === true,
      disposition: row.lifecycle_disposition ?? null,
      lead_created_policy: row.lead_created_policy ?? null,
    })),
    observations,
    activations: activations.map((row) => ({
      key: row.key,
      activated_at: row.activated_at,
    })),
    recordLinks,
    catalog,
    hypothetical: hypothetical.map((source) => ({
      label: source.label,
      normalized_label: source.normalized_label,
      company_slug: source.company_slug,
      disposition: source.disposition,
      lead_created_policy: source.lead_created_policy,
      routes: source.routes.map((route) => ({
        route_key: route.route_key,
        lead_model: route.lead_model,
        move_type: route.move_type,
      })),
    })),
  };
}

async function sampleReceipts(options: SampleOptions): Promise<LegacyWebhookReceipt[]> {
  const Receipt = getGranotObservationReceiptModel();
  const cohorts = await Receipt.aggregate<{
    _id: { event_type?: string; payload_event?: string; source?: string };
    count: number;
  }>([
    {
      $group: {
        _id: {
          event_type: "$event_type",
          payload_event: "$payload.event_type",
          source: "$payload.source",
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const selected = new Map<string, LegacyWebhookReceipt>();
  for (const cohort of cohorts) {
    const eventType = cohort._id.event_type;
    const payloadEvent = cohort._id.payload_event ?? "";
    const source = cohort._id.source ?? "";
    const isBooking = eventType === "booking_status_changed";
    const limit = isBooking
      ? payloadEvent === "Booked"
        ? options.bookingLimit
        : Math.max(options.bookingLimit, cohort.count)
      : options.perCohort;
    const rows = await Receipt.find({
      event_type: eventType,
      "payload.event_type": payloadEvent,
      "payload.source": source,
    })
      .sort({ received_at: -1, createdAt: -1 })
      .limit(limit)
      .select({
        event_type: 1,
        route_event_class: 1,
        received_at: 1,
        captured_at: 1,
        createdAt: 1,
        payload: 1,
        processing_status: 1,
      })
      .lean()
      .exec();
    for (const row of rows) {
      selected.set(String(row._id), row as LegacyWebhookReceipt);
    }
  }
  return [...selected.values()].sort((left, right) => {
    const leftTime = new Date(left.received_at ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.received_at ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });
}

function buildReports(input: {
  outDir: string;
  started: number;
  flags: ReturnType<typeof currentFlags>;
  inventory: Awaited<ReturnType<typeof loadInventory>>;
  cases: ReceiptDryRun[];
  options: SampleOptions;
  hypotheticalSources: ReturnType<typeof buildHypotheticalSources>;
}): Record<string, string> {
  const { cases, inventory, flags } = input;
  const leadCreated = cases.filter((row) => row.event_type === "lead_created");
  const priority = cases.filter((row) => row.event_type === "priority_updated");
  const booking = cases.filter((row) => row.event_type === "booking_status_changed");
  const inbound = cases.filter((row) => /inbound/i.test(row.source ?? ""));

  return {
    "cases.json": `${JSON.stringify({ flags, inventory, cases }, null, 2)}\n`,
    "00-inventory.md": renderInventory(input),
    "01-lead-created.md": renderEventReport("lead_created", leadCreated),
    "02-priority-updated.md": renderEventReport("priority_updated", priority),
    "03-booking.md": renderBookingReport(booking),
    "04-call-ringcentral.md": renderCallReport(inbound, cases),
    "05-findings.md": renderFindings(input, { leadCreated, priority, booking, inbound }),
  };
}

function renderInventory(input: {
  flags: ReturnType<typeof currentFlags>;
  inventory: Awaited<ReturnType<typeof loadInventory>>;
  options: SampleOptions;
  cases: ReceiptDryRun[];
}): string {
  const { inventory, flags, options, cases } = input;
  const lines = [
    "# Granot lifecycle dry-run inventory",
    "",
    `Database: \`vantagemovers\` (read-only). Confirmation: \`${PRODUCTION_CONFIRMATION}\`.`,
    `Sampled receipts: ${cases.length}. per-cohort=${options.perCohort}, booking-limit=${options.bookingLimit}.`,
    "",
    "## Checked-in flags (from process.env / defaults)",
    "",
    ...Object.entries(flags).map(([key, value]) => `- \`${key}\`: \`${value}\``),
    "",
    "## Production collections",
    "",
    `- webhook receipts: ${inventory.receiptTotal}`,
    `- observations: ${inventory.observations}`,
    `- record links: ${inventory.recordLinks}`,
    `- lifecycle activations: ${inventory.activations.length}`,
    `- CRM sources: ${inventory.crmSources.length}`,
    "",
    "### CRM sources as stored",
    "",
    ...inventory.crmSources.map(
      (row) =>
        `- \`${row.id}\` label=\`${row.label ?? "—"}\` enabled=${row.enabled} lifecycle_enabled=${row.lifecycle_enabled} disposition=\`${row.disposition ?? "unset"}\` lead_created_policy=\`${row.lead_created_policy ?? "unset (defaults observation_only)"}\``,
    ),
    "",
    "### Receipt cohorts",
    "",
    "| Event | Payload | Source | Count |",
    "| --- | --- | --- | ---: |",
    ...inventory.receiptByEvent.map(
      (row) =>
        `| ${cell(row._id.event_type)} | ${cell(row._id.payload_event)} | ${cell(row._id.source)} | ${row.count} |`,
    ),
    "",
    "### Live source companies / granularities",
    "",
    ...inventory.catalog.companies.map((company) => {
      const rows = inventory.catalog.granularities.filter((item) => item.company_id === company.id);
      return `- **${company.slug}** (${company.active ? "active" : "inactive"}): ${rows
        .map((row) => `\`${row.granularity_key}\` ${row.channel}${row.local ? `/${row.local}` : ""}`)
        .join(", ")}`;
    }),
    "",
    "### Hypothetical registry overlay (not written)",
    "",
    "Built from live companies + granularities + aliases. Used only in memory.",
    "",
    ...inventory.hypothetical.map(
      (source) =>
        `- \`${source.normalized_label}\` → ${source.company_slug ?? "no company"} / ${source.disposition} / ${source.lead_created_policy} / routes=${source.routes
          .map((route) => `${route.lead_model}:${route.move_type}`)
          .join("|") || "none"}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderEventReport(title: string, rows: ReceiptDryRun[]): string {
  const lines = [
    `# ${title} dry-run`,
    "",
    `Cases: ${rows.length}`,
    "",
    summarizeModes(rows),
    "",
    "## Cases",
    "",
    ...rows.flatMap((row) => renderCase(row)),
  ];
  return `${lines.join("\n")}\n`;
}

function renderBookingReport(rows: ReceiptDryRun[]): string {
  const booked = rows.filter((row) => row.payload_event_type === "Booked");
  const release = rows.filter((row) => row.payload_event_type === "Releas" || row.normalization.booking_action === "release");
  const empty = rows.filter((row) => !row.payload_event_type);
  const lines = [
    "# booking_status_changed dry-run",
    "",
    `Cases: ${rows.length} (Booked ${booked.length}, Releas ${release.length}, empty ${empty.length})`,
    "",
    summarizeModes(rows),
    "",
    "## Classification under hypothetical_observation_only",
    "",
    tally(
      rows,
      (row) => {
        const booking = row.policies.find((policy) => policy.mode === "hypothetical_observation_only")?.booking;
        if (!booking) return "no-booking-block";
        if (booking.classification.kind === "case") {
          return `${booking.classification.kind}:${booking.classification.mode}/${booking.classification.evidence_action}`;
        }
        if (booking.classification.kind === "none") return `none:${booking.classification.reason}`;
        if (booking.classification.kind === "booking_discrepancy_required") {
          return `discrepancy:${booking.classification.reason_code}`;
        }
        return booking.classification.kind;
      },
    ),
    "",
    "## Cases",
    "",
    ...rows.flatMap((row) => renderCase(row)),
  ];
  return `${lines.join("\n")}\n`;
}

function renderCallReport(inbound: ReceiptDryRun[], all: ReceiptDryRun[]): string {
  const withRc = all.filter((row) =>
    row.policies.some((policy) => policy.ringcentral),
  );
  const lines = [
    "# Call / RingCentral dry-run",
    "",
    `Inbound-source receipts sampled: ${inbound.length}`,
    `Receipts with a RingCentral block (CallLead route or inbound label): ${withRc.length}`,
    "",
    "There are **no** production `lead_created` webhooks from inbound/call sources. Call jobs arrive as `priority_updated` and `booking_status_changed`.",
    "",
    "## Hypothetical CallLead identity / RC attach",
    "",
    tally(
      withRc,
      (row) => {
        const policy = row.policies.find((item) => item.mode === "hypothetical_observation_only");
        const identity = policy?.identity;
        const rc = policy?.ringcentral;
        if (!identity) return "no-policy";
        return [
          identity.outcome,
          identity.match_method ?? "no-match",
          rc?.matched_call_lead?.has_ringcentral_ids ? "rc-ids" : "no-rc-ids",
          rc?.duplicate?.isDuplicate ? "dup" : "not-dup",
          `precreate:${rc?.pre_creation_candidates ?? 0}`,
        ].join(" / ");
      },
    ),
    "",
    "## Cases",
    "",
    ...withRc.flatMap((row) => renderCase(row)),
  ];
  return `${lines.join("\n")}\n`;
}

function renderFindings(
  input: {
    flags: ReturnType<typeof currentFlags>;
    inventory: Awaited<ReturnType<typeof loadInventory>>;
    cases: ReceiptDryRun[];
  },
  slices: {
    leadCreated: ReceiptDryRun[];
    priority: ReceiptDryRun[];
    booking: ReceiptDryRun[];
    inbound: ReceiptDryRun[];
  },
): string {
  const asConfiguredReasons = tallyList(
    input.cases,
    (row) => row.policies.find((policy) => policy.mode === "as_configured")?.policy_reason ?? "ok",
  );
  const hypoLeadCreated = tallyList(
    slices.leadCreated,
    (row) => {
      const policy = row.policies.find((item) => item.mode === "hypothetical_observation_only");
      return `${policy?.identity?.outcome ?? "none"} / ${policy?.plan?.reason_code ?? "no-plan"}`;
    },
  );
  const createIfMissing = tallyList(
    slices.leadCreated,
    (row) => {
      const policy = row.policies.find((item) => item.mode === "hypothetical_create_if_missing");
      return `${policy?.plan?.outcome ?? "none"} / ${policy?.plan?.reason_code ?? "no-plan"} / create=${policy?.plan?.creation_eligibility ?? "n/a"}`;
    },
  );
  const formMatches = slices.leadCreated.filter((row) => {
    const policy = row.policies.find((item) => item.mode === "hypothetical_observation_only");
    return policy?.identity?.match_method === "form_ref_no_exact"
      || policy?.matched_lead?.ingestion_origin === "wordpress_form";
  }).length;
  const wordpress = slices.leadCreated.filter((row) => {
    const policy = row.policies.find((item) => item.mode === "hypothetical_observation_only");
    return policy?.matched_lead?.ingestion_origin === "wordpress_form";
  }).length;

  return `# Findings — Granot lifecycle dry-run through Unit 23

Database: \`vantagemovers\`. Read-only. ${input.cases.length} sampled receipts.

## Defaults you asked about

1. **\`lead_created\` does not create by default.** Model and command default is \`observation_only\`. \`create_if_missing\` is legal only on a \`source_scoped_lead\` GranotCrmSource. Production has **no lifecycle-enabled CRM sources** — only four leftover CSV-unmapped stubs — so every live webhook is \`source_unclassified\` as configured.
2. **Form \`lead_created\` webhooks are the ones Granot actually sends.** Sampled sources: Best Relocation Forms, TBM Forms, Top10 Forms, Paid Overflow, TBM Forms Prime, Main Site Forms. No inbound \`lead_created\` rows exist. WordPress already created most of those Form Leads; identity matches on \`ref_no\` (UUID). Under a hypothetical enabled registry with default \`observation_only\`, unmatched form jobs still **do not create**. They stay policy-blocked (\`creation_policy_observation_only\`) or pending/unmatched. \`create_if_missing\` is the opt-in that would authorize creation when identity is empty and minimum data is present.
3. **Call leads are not created from Granot \`lead_created\` today.** Inbound jobs show up as priority updates and booking events. Identity uses the Call ladder: record link → scoped job number → scoped phone. RingCentral attach is the other direction: the cron looks for a Granot-created CallLead in a 12-hour window (\`pending\` convergence, no RC ids). Duplicate flagging is same source-granularity + same phone inside **90 days**, excluding unresolved Granot-created candidates.
4. **Booking.** \`Booked\` (and Priority 5 without an existing booking) classifies into \`create_missing_booking\` or \`review_existing_booking\`. Live payload token \`Releas\` is a release and is \`opposite_action_kind\` for the Unit 22 booking case. Empty booking payloads normalize invalid/unsupported and do not open a case. Booking case writes stay gated off (\`booking_cases_enabled=false\`, no activation).

## As configured (production registry)

${asConfiguredReasons}

Checked-in flags: processing=${input.flags.processing_enabled}, shadow=${input.flags.shadow_mode}, lead_writes=${input.flags.lead_writes_enabled}, lead_creation=${input.flags.lead_creation_enabled}, booking_cases=${input.flags.booking_cases_enabled}. No activation row. Execution mode for every receipt is \`historical_shadow\`, so even a configured registry would not apply effects.

Observations persisted: ${input.inventory.observations}. Record links: ${input.inventory.recordLinks}.

## Hypothetical enabled registry, default \`observation_only\`

${hypoLeadCreated}

Form \`lead_created\` matched via \`form_ref_no_exact\` or WordPress origin: ${formMatches}/${slices.leadCreated.length} sampled (WordPress origin on matched lead: ${wordpress}).

Paid Overflow, Auto, Quote Runner, Equate Media, APM_Leads, IQM Inbounds stay unclassified — no live granularity.

## Hypothetical \`create_if_missing\` (counterfactual only)

${createIfMissing}

This is **not** the default. It only answers “what if we turned creation on for that source.”

## Booking / inbound

Booking sampled: ${slices.booking.length}. Inbound-source sampled: ${slices.inbound.length}. See \`03-booking.md\` and \`04-call-ringcentral.md\`.

## Safe to say we are good through Unit 23?

- **Code path:** normalization, policy-before-identity, desired-state, effect gates, booking classification, and RingCentral pre-creation / 90-day duplicate logic all ran against real receipts and live leads.
- **Production wiring is not ready to apply:** empty lifecycle CRM registry, no activation, shadow + every effect flag false. That is correct for Units 19–23. Do not treat this dry-run as permission to enable flags.
- **Registry work is the next operational gap** if you want live matching: seed GranotCrmSource rows for the webhook labels, default them to \`observation_only\` / \`link_only\`, and only flip \`create_if_missing\` on sources that should invent leads. Form sources should stay observation/link so WordPress remains the creator.
`;
}

function renderCase(row: ReceiptDryRun): string[] {
  const hypo = row.policies.find((policy) => policy.mode === "hypothetical_observation_only");
  const configured = row.policies.find((policy) => policy.mode === "as_configured");
  const create = row.policies.find((policy) => policy.mode === "hypothetical_create_if_missing");
  return [
    `### ${row.event_type} / ${row.payload_event_type || "—"} / ${row.source || "—"} / job ${row.job_no || "—"}`,
    "",
    `- receipt \`${row.receipt_id}\` captured ${row.captured_at} ref=${row.ref_no_kind} service=${row.service_type || "—"}`,
    `- normalize ${row.normalization.result} kind=${row.normalization.kind || "—"} booking=${row.normalization.booking_action || "—"} priority=${row.normalization.priority ?? "—"} issues=${row.normalization.issue_codes.join(",") || "none"}`,
    `- as_configured: ${configured?.policy_ok ? "ok" : `${configured?.policy_outcome}/${configured?.policy_reason}`}`,
    `- hypo observation_only: identity ${hypo?.identity?.outcome}/${hypo?.identity?.reason_code}${hypo?.identity?.match_method ? ` via ${hypo.identity.match_method}` : ""} target=${hypo?.identity?.target ? `${hypo.identity.target.model} ${hypo.identity.target.id}` : "none"} plan=${hypo?.plan ? `${hypo.plan.outcome}/${hypo.plan.reason_code}` : "n/a"} gated=${hypo?.gated_outcome ? `${hypo.gated_outcome.outcome}/${hypo.gated_outcome.reason_code}` : "n/a"}`,
    `- hypo create_if_missing: plan=${create?.plan ? `${create.plan.outcome}/${create.plan.reason_code} create=${create.plan.creation_eligibility ?? "n/a"}` : "n/a"}`,
    hypo?.booking
      ? `- booking enter=${hypo.booking.would_enter_booking_path} class=${formatClass(hypo.booking.classification)} suggestion=${hypo.booking.suggestion ? `${hypo.booking.suggestion.model} ${hypo.booking.suggestion.id}` : "none"}`
      : "",
    hypo?.ringcentral
      ? `- ringcentral model=${hypo.ringcentral.selected_lead_model ?? "—"} precreate=${hypo.ringcentral.pre_creation_candidates} dup=${hypo.ringcentral.duplicate ? `${hypo.ringcentral.duplicate.isDuplicate}/${hypo.ringcentral.duplicate.reason}` : "n/a"} matched_rc=${hypo.ringcentral.matched_call_lead ? `${hypo.ringcentral.matched_call_lead.ingestion_origin}/${hypo.ringcentral.matched_call_lead.has_ringcentral_ids ? "ids" : "no-ids"}` : "none"}`
      : "",
    "",
  ].filter((line) => line !== undefined);
}

function formatClass(classification: NonNullable<ReceiptDryRun["policies"][number]["booking"]>["classification"]): string {
  if (classification.kind === "case") {
    return `${classification.mode}/${classification.evidence_action}`;
  }
  if (classification.kind === "none") return `none/${classification.reason}`;
  if (classification.kind === "booking_discrepancy_required") return `discrepancy/${classification.reason_code}`;
  if (classification.kind === "employee_booking_lead_reconciliation") {
    return `employee/${classification.case_id}`;
  }
  return classification.kind;
}

function summarizeModes(rows: ReceiptDryRun[]): string {
  const modes: DryRunPolicyMode[] = [
    "as_configured",
    "hypothetical_observation_only",
    "hypothetical_create_if_missing",
  ];
  return modes
    .map((mode) => {
      const header = `### ${mode}`;
      const body = tally(rows, (row) => {
        const policy = row.policies.find((item) => item.mode === mode);
        if (!policy) return "missing";
        if (!policy.policy_ok) return `policy ${policy.policy_outcome}/${policy.policy_reason}`;
        return `identity ${policy.identity?.outcome}/${policy.identity?.reason_code} → plan ${policy.plan?.outcome}/${policy.plan?.reason_code}`;
      });
      return `${header}\n\n${body}`;
    })
    .join("\n\n");
}

function tally(rows: ReceiptDryRun[], keyFn: (row: ReceiptDryRun) => string): string {
  return tallyList(rows, keyFn);
}

function tallyList<T>(rows: T[], keyFn: (row: T) => string): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return "_none_";
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `- ${count} × ${key}`)
    .join("\n");
}

function cell(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
