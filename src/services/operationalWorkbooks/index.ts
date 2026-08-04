import { CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS } from "./registrations";
import { createOperationalWorkbookRegistry } from "./registry";

export * from "./registrations";
export * from "./registry";

export const operationalWorkbookRegistry =
  createOperationalWorkbookRegistry({
    registrations: CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS,
  });
