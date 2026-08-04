import { CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS } from "./registrations";
import {
  createOperationalWorkbookRegistry,
  type OperationalWorkbookRegistry,
} from "./registry";

export * from "./registrations";
export * from "./registry";

const defaultOperationalWorkbookRegistry = createOperationalWorkbookRegistry({
  registrations: CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS,
});

let operationalWorkbookRegistryOverride: OperationalWorkbookRegistry | undefined;

export const operationalWorkbookRegistry = defaultOperationalWorkbookRegistry;

export function getOperationalWorkbookRegistry(): OperationalWorkbookRegistry {
  return operationalWorkbookRegistryOverride ?? defaultOperationalWorkbookRegistry;
}

export function setOperationalWorkbookRegistryForTests(
  registry: OperationalWorkbookRegistry | undefined,
): void {
  operationalWorkbookRegistryOverride = registry;
}
