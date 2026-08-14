/**
 * Read-only dump of every catalog spelling that has to line up for
 * source companies, agents, merchants, RingCentral inbound queues,
 * GranotCrmSource labels, and live Granot webhook receipt sources.
 *
 * Production:
 *   pnpm ops:dump-name-link-inventory -- --confirm-production-db=vantagemovers
 *
 * Writes docs/operations-name-link-inventory.md
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {
  CRM_SOURCE_LABELS,
  SOURCE_COMPANY_CONFIGS,
  SOURCE_LABEL_TO_COMPANY,
} from "../src/config/domain/sources.js";
import { connectMongo } from "../src/db.js";
import { Agent } from "../src/models/Agent.js";
import { getCallLeadModel } from "../src/models/CallLead.js";
import { getFormLeadModel } from "../src/models/FormLead.js";
import { GranotAutomationSource } from "../src/models/GranotAutomationSource.js";
import { getGranotCrmSourceModel } from "../src/models/GranotCrmSource.js";
import { getGranotWebhookReceiptModel } from "../src/models/GranotObservationReceipt.js";
import { getLeadSourceCompanyModel } from "../src/models/LeadSourceCompany.js";
import { Merchant } from "../src/models/Merchant.js";
import { getRingCentralInboundRouteAssignmentModel } from "../src/models/RingCentralInboundRouteAssignment.js";
import { getRingCentralInboundRouteModel } from "../src/models/RingCentralInboundRoute.js";
import { RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE } from "../src/services/ringcentral/call-lead-sources.js";
import { normalizePhoneNumberToE164Like } from "../src/services/ringcentral/phone-normalization.js";
import {
  PRODUCTION_CONFIRMATION,
  PRODUCTION_DATABASE,
  assertInventoryDatabaseAllowed,
} from "./migrations/operations-registry-inventory.lib.js";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "docs",
  "operations-name-link-inventory.md",
);

type GranularityRow = {
  id: string;
  company_id: string;
  company_slug: string;
  company_name: string;
  granularity_key: string;
  channel: string;
  owner_label: string;
  crm_label: string;
  aliases: string[];
  active: boolean;
  inbound_phone_numbers: string[];
  source_sites: string[];
  sheet_tab_name: string | null;
  cpl: number;
};

function cell(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function bool(value: boolean | null | undefined): string {
  if (value == null) return "—";
  return value ? "yes" : "no";
}

function list(values: readonly string[] | undefined): string {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return cleaned.length === 0 ? "—" : cleaned.map((value) => `\`${value}\``).join(", ");
}

function fold(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function upper(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

type MatchKind = "exact" | "casefold" | "none";

function matchKind(left: string, right: string): MatchKind {
  if (left === right) return "exact";
  if (fold(left) === fold(right) && left && right) return "casefold";
  return "none";
}

function bestMatch(
  candidate: string,
  pool: readonly string[],
): { value: string; kind: MatchKind } | null {
  const exact = pool.find((item) => item === candidate);
  if (exact) return { value: exact, kind: "exact" };
  const folded = pool.find((item) => fold(item) === fold(candidate));
  if (folded) return { value: folded, kind: "casefold" };
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertInventoryDatabaseAllowed(databaseName, args);

  const sourceCompanyModel = getLeadSourceCompanyModel();
  const granotCrmSourceModel = getGranotCrmSourceModel();
  const webhookModel = getGranotWebhookReceiptModel();
  const routeModel = getRingCentralInboundRouteModel();
  const assignmentModel = getRingCentralInboundRouteAssignmentModel();
  const formLeadModel = getFormLeadModel();
  const callLeadModel = getCallLeadModel();

  const [
    companies,
    agents,
    merchants,
    granotCrmSources,
    automationSources,
    routes,
    assignments,
    webhookSourceRows,
    webhookUserRows,
    formSourceCompanies,
    formCrmLabels,
    callSourceCompanies,
    callCrmLabels,
  ] = await Promise.all([
    sourceCompanyModel.find({}).sort({ company_slug: 1 }).lean().exec(),
    Agent.find({}).sort({ normalized_name: 1 }).lean().exec(),
    Merchant.find({}).sort({ normalized_name: 1 }).lean().exec(),
    granotCrmSourceModel.find({}).sort({ granot_label: 1 }).lean().exec(),
    GranotAutomationSource.find({}).sort({ label: 1 }).lean().exec(),
    routeModel.find({}).sort({ phone_number: 1 }).lean().exec(),
    assignmentModel.find({}).sort({ effective_from: 1 }).lean().exec(),
    webhookModel
      .aggregate<{ _id: string; count: number }>([
        {
          $group: {
            _id: {
              $ifNull: ["$payload.source", "$payload.Source"],
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec(),
    webhookModel
      .aggregate<{ _id: { user: string; rep: string }; count: number }>([
        {
          $group: {
            _id: {
              user: { $ifNull: ["$payload.user", ""] },
              rep: { $ifNull: ["$payload.rep", ""] },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec(),
    formLeadModel.distinct("source_company").exec(),
    formLeadModel.distinct("crm_source_label_snapshot").exec(),
    callLeadModel.distinct("source_company").exec(),
    callLeadModel.distinct("crm_source_label_snapshot").exec(),
  ]);

  const granularities: GranularityRow[] = [];
  for (const company of companies) {
    for (const granularity of company.granularities ?? []) {
      granularities.push({
        id: String(granularity._id),
        company_id: String(company._id),
        company_slug: company.company_slug,
        company_name: company.name,
        granularity_key: granularity.granularity_key,
        channel: granularity.channel,
        owner_label: granularity.owner_label,
        crm_label: granularity.crm_label,
        aliases: [...(granularity.aliases ?? [])],
        active: granularity.active,
        inbound_phone_numbers: [...(granularity.inbound_phone_numbers ?? [])],
        source_sites: [...(granularity.source_sites ?? [])],
        sheet_tab_name: granularity.sheet_tab_name ?? null,
        cpl: granularity.cpl,
      });
    }
  }

  const granularityById = new Map(granularities.map((row) => [row.id, row]));
  const crmLabels = granularities.map((row) => row.crm_label);
  const crmLabelAliases = granularities.flatMap((row) => [row.crm_label, ...row.aliases]);
  const companySlugs = companies.map((company) => company.company_slug);
  const granotLabels = granotCrmSources.map((source) => source.granot_label);
  const automationLabels = automationSources.map((source) => source.label);
  const webhookSources = webhookSourceRows
    .map((row) => asString(row._id))
    .filter(Boolean);

  const agentUsernames = [
    ...agents.map((agent) => asString(agent.granot_crm_username)),
    ...agents.map((agent) => asString(agent.granot_identity?.username)),
  ].filter(Boolean);

  const webhookUsernames = new Map<string, number>();
  for (const row of webhookUserRows) {
    for (const raw of [row._id.user, row._id.rep]) {
      const username = upper(raw);
      if (!username) continue;
      webhookUsernames.set(username, (webhookUsernames.get(username) ?? 0) + row.count);
    }
  }

  const assignmentByRoute = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const routeId = String(assignment.route);
    const existing = assignmentByRoute.get(routeId) ?? [];
    existing.push(assignment);
    assignmentByRoute.set(routeId, existing);
  }

  const capturedAt = new Date().toISOString();
  const sections: string[] = [];

  sections.push(heading(1, "Operations name link inventory"));
  sections.push("");
  sections.push(
    "Generated from live MongoDB via mongoose. This is a spelling and mapping inventory so source companies, granularities, agents, merchants, RingCentral inbound queues, Granot CRM labels, and webhook receipt `source` / `user` / `rep` values can be lined up exactly.",
  );
  sections.push("");
  sections.push(
    table(
      ["Field", "Value"],
      [
        ["Captured at", capturedAt],
        ["Database", databaseName],
        ["Confirmation", PRODUCTION_CONFIRMATION],
        ["Source companies", companies.length],
        ["Granularities", granularities.length],
        ["Agents", agents.length],
        ["Merchants", merchants.length],
        ["RingCentral inbound routes", routes.length],
        ["RingCentral assignments", assignments.length],
        ["GranotCrmSource rows", granotCrmSources.length],
        ["Granot automation source labels", automationSources.length],
        ["Distinct webhook payload.source values", webhookSources.length],
      ],
    ),
  );

  sections.push("");
  sections.push(heading(2, "1. Source companies and granularities"));
  sections.push("");
  sections.push(
    "Canonical registry is `lead_source_companies`. Each company has embedded granularities. Form/call ingest, RingCentral routing, and Granot label mapping should all resolve to a `company_slug` + `granularity_key`.",
  );

  for (const company of companies) {
    const companyGranularities = granularities.filter(
      (row) => row.company_id === String(company._id),
    );
    sections.push("");
    sections.push(heading(3, `\`${company.company_slug}\` — ${company.name}`));
    sections.push("");
    sections.push(
      table(
        ["Field", "Value"],
        [
          ["_id", String(company._id)],
          ["name", company.name],
          ["owner_label", company.owner_label],
          ["aliases", (company.aliases ?? []).join(" | ") || "—"],
          ["active", bool(company.active)],
          ["default_form_granularity_key", company.default_form_granularity_key ?? "—"],
          ["default_call_granularity_key", company.default_call_granularity_key ?? "—"],
          ["created_from", company.created_from],
          ["static config label", SOURCE_COMPANY_CONFIGS[company.company_slug as keyof typeof SOURCE_COMPANY_CONFIGS]?.label ?? "not in SOURCE_COMPANY_CONFIGS"],
          [
            "static config aliases",
            (SOURCE_COMPANY_CONFIGS[company.company_slug as keyof typeof SOURCE_COMPANY_CONFIGS]?.aliases ?? []).join(" | ") || "—",
          ],
        ],
      ),
    );
    sections.push("");
    sections.push(
      table(
        [
          "granularity_key",
          "channel",
          "owner_label",
          "crm_label",
          "aliases",
          "inbound_phone_numbers",
          "source_sites",
          "active",
          "cpl",
          "sheet_tab_name",
        ],
        companyGranularities.map((row) => [
          row.granularity_key,
          row.channel,
          row.owner_label,
          row.crm_label,
          row.aliases.join(" | ") || "—",
          row.inbound_phone_numbers.join(" | ") || "—",
          row.source_sites.join(" | ") || "—",
          bool(row.active),
          row.cpl,
          row.sheet_tab_name ?? "—",
        ]),
      ),
    );
  }

  sections.push("");
  sections.push(heading(2, "2. Agents"));
  sections.push("");
  sections.push(
    "Webhook `payload.user` and `payload.rep` must map to `granot_crm_username` or `granot_identity.username` (both stored uppercase). `name` / `name_aliases` are the Vantage-facing spellings.",
  );
  sections.push("");
  sections.push(
    table(
      [
        "name",
        "normalized_name",
        "aliases",
        "granot_crm_username",
        "granot_identity.username",
        "identity verified",
        "active",
        "role",
      ],
      agents.map((agent) => [
        agent.name,
        agent.normalized_name,
        (agent.name_aliases ?? []).join(" | ") || "—",
        agent.granot_crm_username ?? "—",
        agent.granot_identity?.username ?? "—",
        bool(agent.granot_identity?.verified),
        bool(agent.active),
        agent.role,
      ]),
    ),
  );

  sections.push("");
  sections.push(heading(2, "3. Merchants"));
  sections.push("");
  sections.push(
    table(
      ["name", "normalized_name", "aliases", "active", "created_from"],
      merchants.map((merchant) => [
        merchant.name,
        merchant.normalized_name,
        (merchant.name_aliases ?? []).join(" | ") || "—",
        bool(merchant.active),
        merchant.created_from,
      ]),
    ),
  );

  sections.push("");
  sections.push(heading(2, "4. RingCentral inbound queue numbers"));
  sections.push("");
  sections.push(
    "A route's live source mapping is the **active assignment** on `ringcentral_inbound_route_assignments`, which points at a source company + embedded granularity `_id`. The same E.164 number should also appear on that granularity's `inbound_phone_numbers`. The static `RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE` map is a legacy fallback only.",
  );
  sections.push("");

  const routeRows: Array<Array<string | number>> = [];
  const unmatchedRoutes: string[] = [];
  const phoneOnWrongGranularity: string[] = [];

  for (const route of routes) {
    const routeId = String(route._id);
    const routeAssignments = assignmentByRoute.get(routeId) ?? [];
    const activeAssignment = routeAssignments.find((item) => item.active) ?? null;
    const assigned = activeAssignment
      ? granularityById.get(String(activeAssignment.source_granularity))
      : undefined;
    const normalized = normalizePhoneNumberToE164Like(route.phone_number);
    const listedOnAssigned = Boolean(
      assigned &&
        assigned.inbound_phone_numbers.some(
          (phone) => normalizePhoneNumberToE164Like(phone) === normalized,
        ),
    );
    const listedOnAny = granularities.filter((row) =>
      row.inbound_phone_numbers.some(
        (phone) => normalizePhoneNumberToE164Like(phone) === normalized,
      ),
    );
    const staticMap = normalized
      ? RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE[
          normalized as keyof typeof RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE
        ]
      : undefined;

    if (!assigned) unmatchedRoutes.push(route.phone_number);
    if (assigned && !listedOnAssigned) {
      phoneOnWrongGranularity.push(
        `${route.phone_number} assigned to ${assigned.granularity_key} but inbound_phone_numbers is [${assigned.inbound_phone_numbers.join(", ")}]`,
      );
    }

    routeRows.push([
      route.phone_number,
      route.display_label,
      bool(route.active),
      route.validation_status,
      route.ringcentral_queue_name ?? "—",
      assigned?.company_slug ?? "UNASSIGNED",
      assigned?.granularity_key ?? "UNASSIGNED",
      assigned?.crm_label ?? "—",
      listedOnAssigned ? "yes" : listedOnAny.map((row) => row.granularity_key).join(", ") || "no",
      staticMap
        ? `${staticMap.sourceLabel} → ${staticMap.sourceCompany}`
        : "not in static map",
      (route.observed_target_names ?? []).join(" | ") || "—",
    ]);
  }

  sections.push(
    table(
      [
        "phone_number",
        "display_label",
        "active",
        "validation",
        "queue_name",
        "assigned company_slug",
        "assigned granularity_key",
        "assigned crm_label",
        "listed on granularity inbound numbers",
        "static fallback map",
        "observed_target_names",
      ],
      routeRows,
    ),
  );

  sections.push("");
  sections.push(heading(3, "Call granularities and inbound numbers"));
  sections.push("");
  sections.push(
    table(
      ["company_slug", "granularity_key", "crm_label", "inbound_phone_numbers", "matching RC route"],
      granularities
        .filter((row) => row.channel === "call")
        .map((row) => {
          const matchedRoutes = row.inbound_phone_numbers.map((phone) => {
            const normalized = normalizePhoneNumberToE164Like(phone);
            const route = routes.find(
              (item) => normalizePhoneNumberToE164Like(item.phone_number) === normalized,
            );
            return route ? `${phone} → ${route.display_label}` : `${phone} → NO ROUTE`;
          });
          return [
            row.company_slug,
            row.granularity_key,
            row.crm_label,
            row.inbound_phone_numbers.join(" | ") || "NONE",
            matchedRoutes.join(" | ") || "—",
          ];
        }),
    ),
  );

  sections.push("");
  sections.push(heading(2, "5. GranotCrmSource"));
  sections.push("");
  sections.push(
    "These are the Granot-side labels. Incoming webhook `payload.source` must match `granot_label` (or a granularity `crm_label` / alias). `source_company` on this collection is the Vantage slug string.",
  );
  sections.push("");
  sections.push(
    table(
      [
        "granot_label",
        "crm_origin",
        "workspace_slug",
        "source_company (slug)",
        "default_channel",
        "enabled",
        "matches granularity crm_label",
        "notes",
      ],
      granotCrmSources.map((source) => {
        const crmMatch = bestMatch(source.granot_label, crmLabels);
        const aliasMatch = crmMatch
          ? null
          : bestMatch(source.granot_label, crmLabelAliases);
        const slugOk = companySlugs.includes(source.source_company);
        const notes = [
          crmMatch
            ? `crm_label ${crmMatch.kind}`
            : aliasMatch
              ? `alias ${aliasMatch.kind} → ${aliasMatch.value}`
              : "NO granularity crm_label/alias",
          slugOk ? "slug ok" : `UNKNOWN slug ${source.source_company}`,
          source.notes?.trim() || "",
        ]
          .filter(Boolean)
          .join("; ");
        return [
          source.granot_label,
          source.crm_origin,
          source.workspace_slug,
          source.source_company,
          source.default_channel,
          bool(source.enabled),
          crmMatch ? `${crmMatch.kind}: ${crmMatch.value}` : aliasMatch ? `alias: ${aliasMatch.value}` : "NO",
          notes,
        ];
      }),
    ),
  );

  sections.push("");
  sections.push(heading(3, "Granot automation source catalog (separate collection)"));
  sections.push("");
  sections.push(
    "Labels the HTTP/extension automation picker uses. These should stay in lockstep with `GranotCrmSource.granot_label` and granularity `crm_label`.",
  );
  sections.push("");
  sections.push(
    table(
      ["label", "active", "supported_operations", "created_from", "matches GranotCrmSource", "matches crm_label"],
      automationSources.map((source) => {
        const crmSource = bestMatch(source.label, granotLabels);
        const crmLabel = bestMatch(source.label, crmLabels);
        return [
          source.label,
          bool(source.active),
          (source.supported_operations ?? []).join(", "),
          source.created_from,
          crmSource ? crmSource.kind : "NO",
          crmLabel ? crmLabel.kind : "NO",
        ];
      }),
    ),
  );

  sections.push("");
  sections.push(heading(2, "6. Live Granot webhook receipt sources"));
  sections.push("");
  sections.push(
    "Distinct `payload.source` (or legacy `payload.Source`) values currently in `granot_webhook_receipts`. This is the spelling Granot is actually sending.",
  );
  sections.push("");
  sections.push(
    table(
      [
        "webhook source",
        "receipts",
        "GranotCrmSource.granot_label",
        "granularity crm_label",
        "granularity alias",
        "SOURCE_LABEL_TO_COMPANY",
        "automation catalog",
        "resolved company_slug",
      ],
      webhookSourceRows
        .filter((row) => asString(row._id))
        .map((row) => {
          const source = asString(row._id);
          const crmSource = bestMatch(source, granotLabels);
          const crmLabel = bestMatch(source, crmLabels);
          const alias = crmLabel
            ? null
            : bestMatch(source, crmLabelAliases);
          const staticCompany =
            SOURCE_LABEL_TO_COMPANY[source as keyof typeof SOURCE_LABEL_TO_COMPANY] ??
            Object.entries(SOURCE_LABEL_TO_COMPANY).find(
              ([label]) => fold(label) === fold(source),
            )?.[1];
          const automation = bestMatch(source, automationLabels);
          const granularity = granularities.find(
            (item) =>
              fold(item.crm_label) === fold(source) ||
              item.aliases.some((value) => fold(value) === fold(source)),
          );
          const crmSourceRow = granotCrmSources.find(
            (item) => fold(item.granot_label) === fold(source),
          );
          return [
            source,
            row.count,
            crmSource ? crmSource.kind : "MISSING",
            crmLabel ? crmLabel.kind : "MISSING",
            alias ? `${alias.kind} → ${alias.value}` : "—",
            staticCompany ?? "MISSING",
            automation ? automation.kind : "MISSING",
            crmSourceRow?.source_company ?? granularity?.company_slug ?? "UNRESOLVED",
          ];
        }),
    ),
  );

  sections.push("");
  sections.push(heading(2, "7. Webhook user / rep → agents"));
  sections.push("");
  sections.push(
    "Distinct non-empty `payload.user` and `payload.rep` values from live receipts, matched to agent Granot usernames.",
  );
  sections.push("");
  const webhookUserTable = [...webhookUsernames.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([username, count]) => {
      const agent = agents.find(
        (item) =>
          upper(item.granot_crm_username) === username ||
          upper(item.granot_identity?.username) === username,
      );
      return [
        username,
        count,
        agent?.name ?? "UNMAPPED",
        agent?.granot_crm_username ?? "—",
        agent?.granot_identity?.username ?? "—",
        agent ? bool(agent.active) : "—",
      ];
    });
  sections.push(
    table(
      ["webhook user/rep", "receipts mentioning it", "agent name", "granot_crm_username", "identity.username", "agent active"],
      webhookUserTable.length > 0
        ? webhookUserTable
        : [["(none)", "0", "—", "—", "—", "—"]],
    ),
  );

  sections.push("");
  sections.push(heading(2, "8. Stored lead source spellings"));
  sections.push("");
  sections.push(
    "Distinct `source_company` and `crm_source_label_snapshot` already persisted on Form Leads and Call Leads. These show what ingest actually wrote, not customer data.",
  );
  sections.push("");
  sections.push(heading(3, "FormLead.source_company"));
  sections.push(list(formSourceCompanies.map(asString).filter(Boolean).sort()));
  sections.push("");
  sections.push(heading(3, "FormLead.crm_source_label_snapshot"));
  sections.push(
    list(formCrmLabels.map(asString).filter(Boolean).sort()),
  );
  sections.push("");
  sections.push(heading(3, "CallLead.source_company"));
  sections.push(list(callSourceCompanies.map(asString).filter(Boolean).sort()));
  sections.push("");
  sections.push(heading(3, "CallLead.crm_source_label_snapshot"));
  sections.push(
    list(callCrmLabels.map(asString).filter(Boolean).sort()),
  );

  sections.push("");
  sections.push(heading(2, "9. Static code maps (for comparison)"));
  sections.push("");
  sections.push(heading(3, "CRM_SOURCE_LABELS"));
  sections.push(list([...CRM_SOURCE_LABELS]));
  sections.push("");
  sections.push(heading(3, "SOURCE_LABEL_TO_COMPANY"));
  sections.push("");
  sections.push(
    table(
      ["label", "company_slug"],
      Object.entries(SOURCE_LABEL_TO_COMPANY).map(([label, slug]) => [label, slug]),
    ),
  );

  const unresolvedWebhookSources = webhookSources.filter((source) => {
    const crmSource = bestMatch(source, granotLabels);
    const crmLabel = bestMatch(source, crmLabels);
    const alias = bestMatch(source, crmLabelAliases);
    return !crmSource && !crmLabel && !alias;
  });
  const webhookSourcesMissingCrmSource = webhookSources.filter(
    (source) => !bestMatch(source, granotLabels),
  );
  const granotLabelsMissingGranularity = granotLabels.filter(
    (label) => !bestMatch(label, crmLabelAliases),
  );
  const unmappedWebhookUsers = [...webhookUsernames.keys()].filter(
    (username) =>
      !agentUsernames.some((item) => upper(item) === username),
  );
  const agentsMissingGranotUsername = agents.filter(
    (agent) =>
      agent.active &&
      !asString(agent.granot_crm_username) &&
      !asString(agent.granot_identity?.username),
  );
  const crmSourcesUnknownSlug = granotCrmSources.filter(
    (source) => !companySlugs.includes(source.source_company),
  );

  sections.push("");
  sections.push(heading(2, "10. Gaps that will break linking"));
  sections.push("");
  sections.push(
    table(
      ["Gap", "Count", "Values"],
      [
        [
          "Webhook payload.source with no GranotCrmSource.granot_label",
          webhookSourcesMissingCrmSource.length,
          webhookSourcesMissingCrmSource.join(" | ") || "none",
        ],
        [
          "Webhook payload.source with no granularity crm_label or alias",
          unresolvedWebhookSources.length,
          unresolvedWebhookSources.join(" | ") || "none",
        ],
        [
          "GranotCrmSource.granot_label with no matching granularity crm_label/alias",
          granotLabelsMissingGranularity.length,
          granotLabelsMissingGranularity.join(" | ") || "none",
        ],
        [
          "GranotCrmSource.source_company slug not in lead_source_companies",
          crmSourcesUnknownSlug.length,
          crmSourcesUnknownSlug
            .map((source) => `${source.granot_label} → ${source.source_company}`)
            .join(" | ") || "none",
        ],
        [
          "Webhook user/rep with no matching agent Granot username",
          unmappedWebhookUsers.length,
          unmappedWebhookUsers.join(" | ") || "none",
        ],
        [
          "Active agents with no Granot username at all",
          agentsMissingGranotUsername.length,
          agentsMissingGranotUsername.map((agent) => agent.name).join(" | ") || "none",
        ],
        [
          "RingCentral routes with no active assignment",
          unmatchedRoutes.length,
          unmatchedRoutes.join(" | ") || "none",
        ],
        [
          "Assigned RC number missing from that granularity inbound_phone_numbers",
          phoneOnWrongGranularity.length,
          phoneOnWrongGranularity.join(" | ") || "none",
        ],
      ],
    ),
  );

  const allSourceSpellings = new Map<string, Set<string>>();
  const remember = (spelling: string, seenIn: string) => {
    const key = spelling.trim();
    if (!key) return;
    const existing = allSourceSpellings.get(key) ?? new Set<string>();
    existing.add(seenIn);
    allSourceSpellings.set(key, existing);
  };

  for (const company of companies) {
    remember(company.company_slug, "lead_source_companies.company_slug");
    remember(company.name, "lead_source_companies.name");
    remember(company.owner_label, "lead_source_companies.owner_label");
    for (const alias of company.aliases ?? []) {
      remember(alias, `lead_source_companies.aliases (${company.company_slug})`);
    }
  }
  for (const granularity of granularities) {
    remember(granularity.granularity_key, "granularity_key");
    remember(granularity.owner_label, "granularity.owner_label");
    remember(granularity.crm_label, "granularity.crm_label");
    for (const alias of granularity.aliases) {
      remember(alias, `granularity.aliases (${granularity.granularity_key})`);
    }
  }
  for (const source of granotCrmSources) {
    remember(source.granot_label, "granot_crm_sources.granot_label");
    remember(source.source_company, "granot_crm_sources.source_company");
  }
  for (const source of automationSources) {
    remember(source.label, "granot_automation_sources.label");
  }
  for (const source of webhookSources) {
    remember(source, "granot_webhook_receipts.payload.source");
  }
  for (const [label, slug] of Object.entries(SOURCE_LABEL_TO_COMPANY)) {
    remember(label, "SOURCE_LABEL_TO_COMPANY key");
    remember(slug, "SOURCE_LABEL_TO_COMPANY value");
  }
  for (const label of CRM_SOURCE_LABELS) {
    remember(label, "CRM_SOURCE_LABELS");
  }
  for (const value of [...formSourceCompanies, ...callSourceCompanies]) {
    remember(asString(value), "lead.source_company");
  }
  for (const value of [...formCrmLabels, ...callCrmLabels]) {
    remember(asString(value), "lead.crm_source_label_snapshot");
  }

  sections.push("");
  sections.push(heading(2, "11. Master source-spelling index"));
  sections.push("");
  sections.push(
    "Every distinct source-related string across registry, Granot catalogs, static maps, webhook receipts, and stored leads. Use this to catch `BestRelocation` vs `Best Relocation`, `TBM Forms Prime` vs `TBM Prime Forms`, `Paid Overflow`, etc.",
  );
  sections.push("");
  sections.push(
    table(
      ["exact spelling", "seen in"],
      [...allSourceSpellings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([spelling, seen]) => [spelling, [...seen].sort().join(" · ")]),
    ),
  );

  const markdown = `${sections.join("\n")}\n`;
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown, "utf8");
  await mongoose.disconnect();
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Database: ${databaseName}`);
  console.log(`Webhook sources: ${webhookSources.join(", ") || "(none)"}`);
  console.log(
    `Unresolved webhook sources: ${unresolvedWebhookSources.join(", ") || "none"}`,
  );
  console.log(
    `Unmapped webhook users: ${unmappedWebhookUsers.join(", ") || "none"}`,
  );
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("dump-operations-name-link-inventory.ts");
}

if (isDirectExecution()) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => undefined);
    }
    process.exitCode = 1;
  });
}
