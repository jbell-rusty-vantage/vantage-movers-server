import type { AnalyticsQuery, AnalyticsReport } from "../../validation/v1.validation";
import {
  concreteScopes,
  getAdminModels,
  type ConcreteAdminScope,
} from "../admin/adminScope.service";
import { getAgentPerformance } from "./agentPerformance.service";
import { getBookingCancellationRatio, getCancellationReasons } from "./cancellationAnalytics.service";
import {
  getGeographicLanes,
  getLocalVsLongDistance,
  getStatePerformance,
} from "./geographicAnalytics.service";
import { mergeAnalyticsPayload, type AnalyticsPayload } from "./analyticsMerge";
import { getRevenueTrend } from "./revenueTrend.service";
import {
  getReceiverAgentPerformance,
  getReceiverAgentSourceBreakdown,
  getReceiverAgentTrend,
  unsupportedReceiverAgentReport,
} from "./receiverAgentPerformance.service";
import {
  getLeadSourcePerformance,
  getSourceCompanyFunnel,
  getSourceCompanyPerformance,
} from "./sourcePerformance.service";
import { getSummary } from "./summary.service";

export type AnalyticsResponse = {
  report: AnalyticsReport;
  database_scope: AnalyticsQuery["database_scope"];
  generated_at: string;
  data: AnalyticsPayload;
};

export async function getAnalyticsReport(
  report: AnalyticsReport,
  query: AnalyticsQuery,
): Promise<AnalyticsResponse> {
  const scopes = concreteScopes(query.database_scope);
  const payloads = await Promise.all(
    scopes.map((scope) => getConcreteAnalyticsReport(report, { ...query, database_scope: scope }, scope)),
  );
  const data = query.database_scope === "combined" ? mergeAnalyticsPayload(report, payloads) : payloads[0];
  return {
    report,
    database_scope: query.database_scope,
    generated_at: new Date().toISOString(),
    data,
  };
}

async function getConcreteAnalyticsReport(
  report: AnalyticsReport,
  query: AnalyticsQuery,
  scope: ConcreteAdminScope,
): Promise<AnalyticsPayload> {
  const models = getAdminModels(scope);
  switch (report) {
    case "summary":
      return getSummary(models, query);
    case "revenue-trend":
      return getRevenueTrend(models, query);
    case "source-company-performance":
      return getSourceCompanyPerformance(models, query);
    case "agent-performance":
      return getAgentPerformance(models, query);
    case "booking-cancellation-ratio":
      return getBookingCancellationRatio(models, query);
    case "source-company-funnel":
      return getSourceCompanyFunnel(models, query);
    case "cancellation-reasons":
      return getCancellationReasons(models, query);
    case "lead-source-performance":
      return getLeadSourcePerformance(models, query);
    case "local-vs-long-distance":
      return getLocalVsLongDistance(models, query);
    case "geographic-lanes":
      return getGeographicLanes(models, query);
    case "pickup-state-performance":
      return getStatePerformance(models, query, "pickup_state");
    case "delivery-state-performance":
      return getStatePerformance(models, query, "delivery_state");
    case "receiver-agent-performance":
      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentPerformance(models, query);
    case "receiver-agent-trend":
      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentTrend(models, query);
    case "receiver-agent-source-breakdown":
      return scope === "historical" ? unsupportedReceiverAgentReport() : getReceiverAgentSourceBreakdown(models, query);
  }
}
