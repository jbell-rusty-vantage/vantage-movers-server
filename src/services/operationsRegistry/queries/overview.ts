import { connectMongo } from "../../../db";
import { Agent } from "../../../models/Agent";
import { Merchant } from "../../../models/Merchant";
import { LeadSourceCompany } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { OperationsRegistryChange } from "../../../models/OperationsRegistryChange";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import { getOperationalEventModel } from "../../../models/OperationalEvent";
import {
  getAdminProxySignatureMaxAgeMs,
  getAdminProxySigningSecret,
  isOperationsRegistryPreviewUnsignedAllowed,
} from "../config";
import type { RegistryOverviewResult } from "../types";
import {
  getRegistryRuntimeTelemetry,
  mergeDurableCompatibilityTelemetry,
  type RegistryCompatibilityConsumer,
} from "../runtimeTelemetry";

export async function getRegistryOverview(): Promise<RegistryOverviewResult> {
  await connectMongo();
  const observationCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    agentsTotal,
    agentsActive,
    merchantsTotal,
    merchantsActive,
    sourceCompaniesTotal,
    sourceCompaniesActive,
    sourceGranularitiesTotal,
    sourceGranularitiesActive,
    ringCentralRoutesTotal,
    ringCentralRoutesActive,
    registryChangesTotal,
    compatibilityEvents,
  ] = await Promise.all([
    Agent.countDocuments({}),
    Agent.countDocuments({ active: true }),
    Merchant.countDocuments({}),
    Merchant.countDocuments({ active: true }),
    LeadSourceCompany.countDocuments({}),
    LeadSourceCompany.countDocuments({ active: true }),
    getLeadSourceGranularityModel().countDocuments({}),
    getLeadSourceGranularityModel().countDocuments({ active: true }),
    getRingCentralInboundRouteModel().countDocuments({}),
    getRingCentralInboundRouteModel().countDocuments({ active: true }),
    OperationsRegistryChange.countDocuments({}),
    getOperationalEventModel()
      .find({
        event_key: "operations_registry.compatibility_read",
        occurred_at: { $gte: observationCutoff },
      })
      .sort({ occurred_at: -1 })
      .limit(100)
      .lean()
      .exec(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    counts: {
      agents_total: agentsTotal,
      agents_active: agentsActive,
      merchants_total: merchantsTotal,
      merchants_active: merchantsActive,
      source_companies_total: sourceCompaniesTotal,
      source_companies_active: sourceCompaniesActive,
      source_granularities_total: sourceGranularitiesTotal,
      source_granularities_active: sourceGranularitiesActive,
      ringcentral_routes_total: ringCentralRoutesTotal,
      ringcentral_routes_active: ringCentralRoutesActive,
      registry_changes_total: registryChangesTotal,
    },
    signing: {
      secret_configured: Boolean(getAdminProxySigningSecret()),
      preview_unsigned_allowed: isOperationsRegistryPreviewUnsignedAllowed(),
      signature_max_age_ms: getAdminProxySignatureMaxAgeMs(),
    },
    runtime: mergeDurableCompatibilityTelemetry(
      getRegistryRuntimeTelemetry(),
      compatibilityEvents
        .map((event) => {
          const path = event.details.compatibility_path;
          const consumer = event.details.consumer_category;
          return typeof path === "string" && isCompatibilityConsumer(consumer)
            ? {
                path,
                consumer_category: consumer,
                occurred_at: event.occurred_at,
              }
            : null;
        })
        .filter(
          (
            event,
          ): event is {
            path: string;
            consumer_category: RegistryCompatibilityConsumer;
            occurred_at: Date;
          } => event !== null,
        ),
    ),
  };
}

function isCompatibilityConsumer(
  value: unknown,
): value is RegistryCompatibilityConsumer {
  return [
    "admin_list",
    "booking_legacy_parse",
    "enrichment",
    "reconciliation",
    "unknown",
  ].includes(String(value));
}
