import type { AnalyticsQuery, AnalyticsReport } from "../../validation/v1.validation";
import { getAdminModels } from "../admin/adminScope.service";
import { getAgentPerformance } from "./agentPerformance.service";
import { getBookingCancellationRatio, getCancellationReasons } from "./cancellationAnalytics.service";
import {
  getGeographicLanes,
  getLocalVsLongDistance,
  getStatePerformance,
} from "./geographicAnalytics.service";
import { getRevenueTrend } from "./revenueTrend.service";
import {
  getReceiverAgentPerformance,
  getReceiverAgentSourceBreakdown,
  getReceiverAgentTrend,
} from "./receiverAgentPerformance.service";
import { getSmsSuccessfullySentThenBooked } from "./smsConversion.service";
import {
  getLeadSourcePerformance,
  getSourceCompanyFunnel,
  getSourceCompanyPerformance,
} from "./sourcePerformance.service";
import { getSummary } from "./summary.service";

export type AnalyticsPayload = Record<string, unknown>;

export type AnalyticsResponse = {
  report: AnalyticsReport;
  generated_at: string;
  data: AnalyticsPayload;
};

export async function getAnalyticsReport(
  report: AnalyticsReport,
  query: AnalyticsQuery,
): Promise<AnalyticsResponse> {
  return {
    report,
    generated_at: new Date().toISOString(),
    data: await buildAnalyticsReport(report, query),
  };
}

async function buildAnalyticsReport(
  report: AnalyticsReport,
  query: AnalyticsQuery,
): Promise<AnalyticsPayload> {
  const models = getAdminModels();
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
      return getReceiverAgentPerformance(models, query);
    case "receiver-agent-trend":
      return getReceiverAgentTrend(models, query);
    case "receiver-agent-source-breakdown":
      return getReceiverAgentSourceBreakdown(models, query);
    case "sms-successfully-sent-then-booked":
      return getSmsSuccessfullySentThenBooked(models, query);
  }
}
