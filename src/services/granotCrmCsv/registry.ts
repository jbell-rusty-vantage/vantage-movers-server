import {
  GRANOT_CRM_DEFAULT_ORIGIN,
  normalizeSourceCompany,
} from "../../config/domain";
import {
  getGranotCrmSourceModel,
  type GranotCrmSourceDocument,
} from "../../models/GranotCrmSource";
import type { GranotCrmSourceSeed } from "./types";

export const GRANOT_CRM_SOURCE_SEEDS: GranotCrmSourceSeed[] = [
  {
    workspace_slug: "10best-inbounds",
    granot_label: "10best Inbounds",
    default_channel: "call",
    source_company: "tbm_leads",
  },
  {
    workspace_slug: "best-relocation-forms",
    granot_label: "Best Relocation Forms",
    default_channel: "form",
    source_company: "best_relocation_leads",
  },
  {
    workspace_slug: "bestrelocation-inbounds",
    granot_label: "BestRelocation Inbounds",
    default_channel: "call",
    source_company: "best_relocation_leads",
  },
  {
    workspace_slug: "get-movers",
    granot_label: "Get Movers",
    default_channel: "form",
    source_company: "get_movers_leads",
  },
  {
    workspace_slug: "getmovers-forms",
    granot_label: "GetMovers Forms",
    default_channel: "form",
    source_company: "get_movers_leads",
  },
  {
    workspace_slug: "getmovers-inbounds",
    granot_label: "GetMovers Inbounds",
    default_channel: "call",
    source_company: "get_movers_leads",
  },
  {
    workspace_slug: "main-site-inbounds",
    granot_label: "Main Site Inbounds",
    default_channel: "call",
    source_company: "main_site",
  },
  {
    workspace_slug: "tbm-forms",
    granot_label: "TBM Forms",
    default_channel: "form",
    source_company: "tbm_leads",
  },
  {
    workspace_slug: "tbm-forms-prime",
    granot_label: "TBM Forms Prime",
    default_channel: "form",
    source_company: "tbm_prime_leads",
  },
  {
    workspace_slug: "tbm-prime-inbounds",
    granot_label: "TBM Prime Inbounds",
    default_channel: "call",
    source_company: "tbm_prime_leads",
    csv_paths: {
      follow_up: "/vantage/bu/follow_advr1628.csv",
      booked: "/vantage/bu/book_advr1628.csv",
    },
  },
  {
    workspace_slug: "top10-forms",
    granot_label: "Top10 Forms",
    default_channel: "form",
    source_company: "top10_leads",
  },
  {
    workspace_slug: "top10-inbounds",
    granot_label: "Top10 Inbounds",
    default_channel: "call",
    source_company: "top10_leads",
  },
  {
    workspace_slug: "auto",
    granot_label: "Auto",
    default_channel: "unknown",
    source_company: "not_provided",
    enabled: false,
    notes: "Source mapping TBD.",
  },
  {
    workspace_slug: "quote-runner-premium-branded",
    granot_label: "Quote Runner - Premium Branded",
    default_channel: "unknown",
    source_company: "not_provided",
    enabled: false,
    notes: "Source mapping TBD.",
  },
  {
    workspace_slug: "referral",
    granot_label: "Referral",
    default_channel: "unknown",
    source_company: "not_provided",
    enabled: false,
    notes: "Source mapping TBD.",
  },
  {
    workspace_slug: "regional-exclusive",
    granot_label: "Regional Exclusive",
    default_channel: "unknown",
    source_company: "not_provided",
    enabled: false,
    notes: "Source mapping TBD.",
  },
];

export async function seedGranotCrmSources(
  crmOrigin = GRANOT_CRM_DEFAULT_ORIGIN,
): Promise<GranotCrmSourceDocument[]> {
  const Source = getGranotCrmSourceModel();
  const results: GranotCrmSourceDocument[] = [];
  for (const seed of GRANOT_CRM_SOURCE_SEEDS) {
    const source = await Source.findOneAndUpdate(
      { crm_origin: normalizeCrmOrigin(crmOrigin), workspace_slug: seed.workspace_slug },
      {
        $setOnInsert: {
          crm_origin: normalizeCrmOrigin(crmOrigin),
          workspace_slug: seed.workspace_slug,
          granot_label: seed.granot_label,
          default_channel: seed.default_channel,
          source_company: seed.source_company,
          enabled: seed.enabled ?? true,
          notes: seed.notes,
        },
        $set: {
          ...(seed.csv_paths ? { csv_paths: seed.csv_paths } : {}),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).orFail();
    results.push(source);
  }
  return results;
}

export async function listGranotCrmSources(
  crmOrigin?: string,
): Promise<GranotCrmSourceDocument[]> {
  const Source = getGranotCrmSourceModel();
  const filter = crmOrigin ? { crm_origin: normalizeCrmOrigin(crmOrigin) } : {};
  return Source.find(filter).sort({ workspace_slug: 1 }).exec();
}

export async function findSourceForUpload(input: {
  crmOrigin: string;
  workspaceSlug?: string;
  granotLabel?: string;
  csvPath: string;
}): Promise<GranotCrmSourceDocument | null> {
  const Source = getGranotCrmSourceModel();
  const crm_origin = normalizeCrmOrigin(input.crmOrigin);
  if (input.workspaceSlug) {
    const source = await Source.findOne({
      crm_origin,
      workspace_slug: slugifyWorkspace(input.workspaceSlug),
    }).exec();
    if (source) {
      return source;
    }
  }

  const path = normalizeCsvPath(input.csvPath);
  const byPath = await Source.findOne({
    crm_origin,
    $or: [{ "csv_paths.follow_up": path }, { "csv_paths.booked": path }],
  }).exec();
  if (byPath) {
    return byPath;
  }

  if (input.granotLabel) {
    return Source.findOne({
      crm_origin,
      granot_label: new RegExp(`^${escapeRegex(input.granotLabel.trim())}$`, "i"),
    }).exec();
  }

  return null;
}

export async function ensureSourceForUpload(input: {
  crmOrigin: string;
  workspaceSlug?: string;
  granotLabel?: string;
  csvPath: string;
  csvKind: "follow_up" | "booked";
}): Promise<GranotCrmSourceDocument> {
  const Source = getGranotCrmSourceModel();
  const existing = await findSourceForUpload(input);
  if (existing) {
    const normalizedPath = normalizeCsvPath(input.csvPath);
    if (existing.csv_paths?.[input.csvKind] !== normalizedPath) {
      existing.csv_paths = {
        ...(existing.csv_paths ?? {}),
        [input.csvKind]: normalizedPath,
      };
      await existing.save();
    }
    return existing;
  }

  const workspaceSlug =
    input.workspaceSlug?.trim() ||
    `unmapped/${csvBasenameWithoutExtension(input.csvPath)}`;
  const granotLabel = input.granotLabel?.trim() || workspaceSlug;
  return Source.findOneAndUpdate(
    {
      crm_origin: normalizeCrmOrigin(input.crmOrigin),
      workspace_slug: slugifyWorkspace(workspaceSlug, { allowSlash: true }),
    },
    {
      $setOnInsert: {
        crm_origin: normalizeCrmOrigin(input.crmOrigin),
        workspace_slug: slugifyWorkspace(workspaceSlug, { allowSlash: true }),
        granot_label: granotLabel,
        default_channel: "unknown",
        source_company: normalizeSourceCompany(granotLabel),
        enabled: false,
        notes: "Auto-created from Granot CSV upload; source mapping needs review.",
      },
      $set: {
        [`csv_paths.${input.csvKind}`]: normalizeCsvPath(input.csvPath),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).orFail();
}

export function normalizeCrmOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/g, "").toLowerCase();
  }
}

export function normalizeCsvPath(value: string): string {
  try {
    const url = new URL(value, "https://placeholder.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return value.trim();
  }
}

export function slugifyWorkspace(
  value: string,
  options: { allowSlash?: boolean } = {},
): string {
  const slash = options.allowSlash ? "/" : "";
  const pattern = new RegExp(`[^a-z0-9${slash}]+`, "g");
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(pattern, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function csvBasenameWithoutExtension(value: string): string {
  const path = normalizeCsvPath(value).split("?")[0];
  return (path.split("/").pop() ?? "granot-csv").replace(/\.csv$/i, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
