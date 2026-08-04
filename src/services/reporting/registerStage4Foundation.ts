import { setReportingDestinationPort } from "./destinationContract";
import { productionReportingDestinationPort } from "./reportingDestinationPort.adapter";
import { registerPersistedManifestPageAdapter } from "./manifestPageAdapter";

let registered = false;

export function registerReportingStage4Foundation(): void {
  if (registered) return;
  setReportingDestinationPort(productionReportingDestinationPort);
  registerPersistedManifestPageAdapter();
  registered = true;
}
