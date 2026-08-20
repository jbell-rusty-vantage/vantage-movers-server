/** Synthetic dependency seed for the exact Unit 34 disposable certification database. */
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { captureGranotLifecycleWebhookReceipt } from "../../src/services/granotLifecycle/capture";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel";
import { REVIEWED_SOURCE_CLASSIFICATION_MANIFEST } from "../migrations/granot-lifecycle-source-registry.manifest";

const UNIT34_DATABASE = "testvantagemovers_unit34cert";

async function main(): Promise<void> {
  const database = getMongoDatabaseName();
  if (!isTestMode() || database !== UNIT34_DATABASE) {
    throw new Error(`Unit 34 seed refuses every database except ${UNIT34_DATABASE}.`);
  }
  if (process.env.SHEET_SYNC_MODE !== "disabled") {
    throw new Error("Unit 34 seed requires SHEET_SYNC_MODE=disabled.");
  }
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db || db.databaseName !== database) {
    throw new Error("Unit 34 seed connected to an unexpected database.");
  }

  const protectedCollections = [
    "lead_source_companies",
    "lead_source_granularities",
    "granot_crm_sources",
    "granot_webhook_receipts",
  ] as const;
  for (const collection of protectedCollections) {
    if (await db.collection(collection).estimatedDocumentCount()) {
      throw new Error("Unit 34 seed requires an empty isolated database.");
    }
  }

  const companyId = new mongoose.Types.ObjectId();
  const granularities = {
    best_relocation_leads_call: new mongoose.Types.ObjectId(),
    best_relocation_leads_form_local: new mongoose.Types.ObjectId(),
    best_relocation_leads_form_long_distance: new mongoose.Types.ObjectId(),
  };
  await db.collection("lead_source_companies").insertOne({
    _id: companyId,
    company_slug: "best_relocation_leads",
    owner_label: "Synthetic Best Relocation",
    name: "Synthetic Best Relocation",
    active: true,
  });
  await db.collection("lead_source_granularities").insertMany([
    {
      _id: granularities.best_relocation_leads_call,
      granularity_key: "best_relocation_leads_call",
      owner_label: "Synthetic Call",
      source_company: companyId,
      channel: "call",
      active: true,
    },
    {
      _id: granularities.best_relocation_leads_form_local,
      granularity_key: "best_relocation_leads_form_local",
      owner_label: "Synthetic Local Form",
      source_company: companyId,
      channel: "form",
      local: "local",
      active: true,
    },
    {
      _id: granularities.best_relocation_leads_form_long_distance,
      granularity_key: "best_relocation_leads_form_long_distance",
      owner_label: "Synthetic Long Distance Form",
      source_company: companyId,
      channel: "form",
      local: "long_distance",
      active: true,
    },
  ]);

  const sourceRows = REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families.map((family) => {
    const label = family.normalized_labels[0]!;
    const routes = family.routes.map((route) => ({
      route_key: route.route_key,
      lead_model: route.lead_model,
      move_type: route.move_type,
      source_granularity_id:
        granularities[route.granularity_key as keyof typeof granularities],
    }));
    return {
      _id: new mongoose.Types.ObjectId(),
      granot_label: label,
      normalized_granot_label: normalizeGranotSourceLabel(label),
      enabled: true,
      lifecycle_enabled: family.lifecycle_enabled,
      lifecycle_disposition: family.lifecycle_disposition,
      lead_created_policy: family.lead_created_policy,
      ...("company_slug" in family && family.company_slug
        ? { lead_source_company: companyId }
        : {}),
      lifecycle_routes: routes,
      lifecycle_policy_version: family.lifecycle_enabled
        ? REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.policy_version
        : "",
      default_channel:
        family.family === "best_relocation_call"
          ? "call"
          : family.family === "best_relocation_form"
            ? "form"
            : "unknown",
      crm_origin: "synthetic",
      workspace_slug: "unit34",
      source_company: "synthetic",
    };
  });
  await db.collection("granot_crm_sources").insertMany(sourceRows);
  await captureGranotLifecycleWebhookReceipt({
    route_event_class: "lead_created",
    captured_at: new Date("2000-01-01T00:00:00.000Z"),
    authentication_method: "header_secret",
    headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", source: "Paid Overflow" },
  });

  console.log(
    JSON.stringify({
      seeded: true,
      database_mode: "isolated_test",
      companies: 1,
      granularities: 3,
      sources: sourceRows.length,
      receipts: 1,
    }),
  );
}

main()
  .catch(() => {
    console.error("Unit 34 synthetic seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
