import { isTestMode } from "./runtime";

export const GRANOT_CRM_CSV_KINDS = ["follow_up", "booked"] as const;
export type GranotCrmCsvKind = (typeof GRANOT_CRM_CSV_KINDS)[number];

export const GRANOT_CRM_DEFAULT_BUCKET = "vantage-granot-crm-csv-prod";
export const GRANOT_CRM_DEFAULT_REGION = "us-east-1";
export const GRANOT_CRM_DEFAULT_PREFIX = "prod/crm";
export const GRANOT_CRM_DEFAULT_ORIGIN = "https://eagle.hellomoving.com";
export const GRANOT_CRM_AWS_PROFILE = "overtonadmin";

export function getGranotCrmCsvBucket(): string {
  return (
    process.env.GRANOT_CRM_CSV_BUCKET?.trim() ||
    GRANOT_CRM_DEFAULT_BUCKET
  );
}

export function getGranotCrmCsvRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    GRANOT_CRM_DEFAULT_REGION
  );
}

export function getGranotCrmCsvPrefix(): string {
  const raw =
    process.env.GRANOT_CRM_CSV_PREFIX?.trim() ||
    (isTestMode() ? "test/crm" : GRANOT_CRM_DEFAULT_PREFIX);
  return raw.replace(/^\/+|\/+$/g, "");
}

export function getGranotCrmAwsProfile(): string | undefined {
  return (
    process.env.GRANOT_CRM_AWS_PROFILE?.trim() ||
    process.env.AWS_PROFILE?.trim() ||
    undefined
  );
}
