import { connectMongo } from "../../../db";
import { Agent } from "../../../models/Agent";
import { Merchant } from "../../../models/Merchant";
import { LeadSourceCompany } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { OperationsRegistryChange } from "../../../models/OperationsRegistryChange";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import {
  getAdminProxySignatureMaxAgeMs,
  getAdminProxySigningSecret,
  isOperationsRegistryPreviewUnsignedAllowed,
} from "../config";
import type { RegistryOverviewResult } from "../types";

export async function getRegistryOverview(): Promise<RegistryOverviewResult> {
  await connectMongo();

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
  };
}
