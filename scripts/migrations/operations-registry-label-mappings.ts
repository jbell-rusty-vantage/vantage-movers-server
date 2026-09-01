/**
 * ORS-1 — report / manifest / apply typed sheet and legacy label mappings.
 *
 * Default is --report. Does not apply production indexes. Does not read
 * production Lead payloads unless the inventory production-confirm flag is
 * present (this pass does not pass that flag).
 *
 *   TEST_MODE=true pnpm migrations:operations-registry-label-mappings
 *   TEST_MODE=true pnpm migrations:operations-registry-label-mappings -- --manifest
 *   TEST_MODE=true pnpm migrations:operations-registry-label-mappings -- --apply --manifest=<path>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { SOURCE_LABEL_TO_COMPANY } from "../../src/config/domain/sources.js";
import { connectMongo } from "../../src/db.js";
import { getCallLeadModel } from "../../src/models/CallLead.js";
import { getFormLeadModel } from "../../src/models/FormLead.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { createLabelMapping } from "../../src/services/operationsRegistry/labelMappings.js";
import type { RegistryActorContext } from "../../src/services/operationsRegistry/types.js";
import {
  assertInventoryDatabaseAllowed,
  assertLabelMappingManifestChecksum,
  assertNoApplyFlag,
  blockingLabelMappingProposals,
  buildLabelMappingManifest,
  collectLabelMappingInventoryLabels,
  proposeLabelMappings,
  reportEmbeddedGranularitiesUsage,
  summarizeLabelInventoryOrigins,
  summarizeLabelMappingClassifications,
  type LabelMappingManifest,
  type LabelMappingProposal,
} from "./operations-registry-inventory.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-label-mappings",
);

function parseArgs(args: readonly string[]): {
  mode: "report" | "manifest" | "apply";
  manifestPath?: string;
} {
  const apply = args.includes("--apply");
  const manifestFlag = args.find((arg) => arg.startsWith("--manifest"));
  if (apply) {
    const manifestPath = manifestFlag?.includes("=")
      ? manifestFlag.split("=").slice(1).join("=")
      : undefined;
    if (!manifestPath) {
      throw new Error("--apply requires --manifest=<path>.");
    }
    return { mode: "apply", manifestPath };
  }
  if (manifestFlag === "--manifest" || manifestFlag?.startsWith("--manifest=")) {
    return { mode: "manifest" };
  }
  return { mode: "report" };
}

function staticLabels(): LabelMappingProposal["namespace"] extends infer _N
  ? Array<{
      label: string;
      namespace: "sheet_lead_source" | "legacy_api_source";
      static_company_slug: string;
    }>
  : never {
  return Object.entries(SOURCE_LABEL_TO_COMPANY).map(([label, slug]) => ({
    label,
    namespace: "sheet_lead_source" as const,
    static_company_slug: slug,
  }));
}

async function loadFeeds(): Promise<
  Array<{
    id: string;
    company_id: string;
    company_slug: string;
    crm_label: string;
    aliases: string[];
    active: boolean;
  }>
> {
  const companies = await getLeadSourceCompanyModel()
    .find({}, { company_slug: 1 })
    .lean()
    .exec();
  const companySlugById = new Map(
    companies.map((company) => [String(company._id), String(company.company_slug)]),
  );
  const feeds = await getLeadSourceGranularityModel()
    .find({}, { source_company: 1, crm_label: 1, aliases: 1, active: 1 })
    .lean()
    .exec();
  return feeds.map((feed) => ({
    id: String(feed._id),
    company_id: String(feed.source_company),
    company_slug: companySlugById.get(String(feed.source_company)) ?? "",
    crm_label: String(feed.crm_label ?? ""),
    aliases: Array.isArray(feed.aliases)
      ? feed.aliases.filter((item): item is string => typeof item === "string")
      : [],
    active: feed.active !== false,
  }));
}

async function loadObservedLeadSnapshotLabels(): Promise<string[]> {
  const fields = [
    "crm_source_label_snapshot",
    "source_company_label_snapshot",
  ] as const;
  const values = await Promise.all([
    ...fields.map((field) => getFormLeadModel().distinct(field)),
    ...fields.map((field) => getCallLeadModel().distinct(field)),
  ]);
  return [
    ...new Set(
      values.flat().filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function printReport(
  proposals: LabelMappingProposal[],
  databaseName: string,
): void {
  const counts = summarizeLabelMappingClassifications(proposals);
  const blocking = blockingLabelMappingProposals(proposals);
  const usage = reportEmbeddedGranularitiesUsage();
  const payload = {
    database_name: databaseName,
    mode: "report",
    classification_counts: counts,
    origin_counts: summarizeLabelInventoryOrigins(proposals),
    blocking_labels: blocking.map((item) => ({
      label: item.label,
      classification: item.classification,
      origin: item.origin,
      matched_company_slugs: item.matched_company_slugs,
    })),
    proposals,
    embedded_granularities_usage: usage,
    observed_sheet_values_note:
      "Sheet spellings are inventoried from stored Lead crm_source_label_snapshot / source_company_label_snapshot on the allowed database. Live Google Sheet payloads are not read.",
  };
  console.log(JSON.stringify(payload, null, 2));
}

async function writeManifest(
  proposals: LabelMappingProposal[],
): Promise<string> {
  const manifest = buildLabelMappingManifest(proposals);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(
    OUTPUT_DIR,
    `label-mappings-${manifest.checksum.slice(0, 12)}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return filePath;
}

async function applyManifest(manifestPath: string): Promise<void> {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as LabelMappingManifest;
  assertLabelMappingManifestChecksum(raw);
  for (const [index, proposal] of raw.proposals.entries()) {
    const actor: RegistryActorContext = {
      actorType: "system",
      actorId: "operations-registry-label-mappings",
      actorLabel: "operations-registry-label-mappings",
      actorRole: "owner",
      requestId: `ors1-label-mapping-${index}-${Date.now()}`,
    };
    await createLabelMapping(
      {
        label: proposal.label,
        namespace: proposal.namespace,
        source_company: proposal.source_company,
        source_granularity: proposal.source_granularity,
        change_reason: "Apply reviewed ORS-1 label-mapping manifest",
      },
      actor,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  if (parsed.mode !== "apply") {
    assertNoApplyFlag(args);
  }

  await connectMongo();
  try {
    const databaseName = mongoose.connection.name;
    assertInventoryDatabaseAllowed(databaseName, args);

    if (parsed.mode === "apply" && parsed.manifestPath) {
      await applyManifest(parsed.manifestPath);
      console.log(
        JSON.stringify(
          {
            database_name: databaseName,
            mode: "apply",
            manifest: parsed.manifestPath,
            ok: true,
            embedded_granularities_usage: reportEmbeddedGranularitiesUsage(),
          },
          null,
          2,
        ),
      );
      return;
    }

    const feeds = await loadFeeds();
    const labels = collectLabelMappingInventoryLabels({
      staticLabels: staticLabels(),
      feeds,
      leadSnapshots: await loadObservedLeadSnapshotLabels(),
    });
    const proposals = proposeLabelMappings({
      labels,
      feeds,
    });
    printReport(proposals, databaseName);

    if (parsed.mode === "manifest") {
      const blocking = blockingLabelMappingProposals(proposals);
      if (blocking.length) {
        process.exitCode = 1;
        console.error(
          `Refusing to emit a manifest. Blocking labels: ${blocking
            .map((item) => `${item.label} (${item.classification})`)
            .join(", ")}`,
        );
        return;
      }
      const filePath = await writeManifest(proposals);
      console.error(`Wrote manifest ${filePath}`);
    } else if (blockingLabelMappingProposals(proposals).length) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => undefined);
});
