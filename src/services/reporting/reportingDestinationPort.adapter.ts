import type { ReportingDestinationPort } from "./destinationContract";
import { buildValidatedDestinationSnapshot } from "./reportingDestination.service";

export class ProductionReportingDestinationPort implements ReportingDestinationPort {
  async getValidatedSnapshot(destinationId: string) {
    return buildValidatedDestinationSnapshot(destinationId);
  }
}

export const productionReportingDestinationPort =
  new ProductionReportingDestinationPort();
