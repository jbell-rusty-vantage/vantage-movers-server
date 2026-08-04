import { SHEET_CONTAINER_ENV_VARS } from "../../config/domain/sheets";
import type { OperationalWorkbookRegistration } from "./registry";

export const CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS =
  Object.freeze<readonly OperationalWorkbookRegistration[]>([
    {
      registration_key: "sheet_sync.master_leads",
      purpose: "sheet_sync_target",
      env_key: SHEET_CONTAINER_ENV_VARS.masterLeads,
      required_in_production: true,
      owner_module: "sheet_sync",
      display_label: "Master Leads",
    },
    {
      registration_key: "sheet_sync.master_booked",
      purpose: "sheet_sync_target",
      env_key: SHEET_CONTAINER_ENV_VARS.masterBooked,
      required_in_production: true,
      owner_module: "sheet_sync",
      display_label: "Master Booked",
    },
    ...Object.entries(SHEET_CONTAINER_ENV_VARS.sourceLeads).map(
      ([sourceKey, envKey]): OperationalWorkbookRegistration => ({
        registration_key: `sheet_sync.source.${sourceKey}`,
        purpose: "sheet_sync_target",
        env_key: envKey,
        required_in_production: false,
        owner_module: "sheet_sync",
        display_label: `Sheet Sync source: ${sourceKey}`,
      }),
    ),
  ]);

export const BEST_RELOCATION_STAGE_2_REGISTRATION_CHECKLIST = Object.freeze([
  "BEST_RELOCATION_SYNC_SHEET_ID",
  "BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID",
] as const);
