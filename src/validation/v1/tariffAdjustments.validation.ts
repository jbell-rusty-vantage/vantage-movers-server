import { z } from "zod";
import { nonEmptyString, zipSchema } from "./common";

export const TARIFF_ADJUSTMENT_SERVICES = [
  "Linehaul",
  "Additional Services",
] as const;

export const TARIFF_ADJUSTMENT_FORBIDDEN_KEYS = [
  "customer",
  "name",
  "phone",
  "email",
  "job_no",
  "ref_no",
  "ordref",
  "spreadsheet_id",
  "tab",
] as const;

const tariffAdjustmentRowSchema = z
  .object({
    effective_date: nonEmptyString.optional(),
    pickup_zone: zipSchema,
    delivery_zone: zipSchema,
    service: z.enum(TARIFF_ADJUSTMENT_SERVICES),
    rule: nonEmptyString,
    new_rule: nonEmptyString,
    carrier: nonEmptyString,
  })
  .strict();

export const createTariffAdjustmentsSchema = z
  .object({
    rows: z.array(tariffAdjustmentRowSchema).length(2),
  })
  .strict()
  .superRefine((body, ctx) => {
    const forbidden = collectForbiddenKeys(body);
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Tariff Adjustment payload cannot include ${forbidden.join(", ")}`,
      });
    }

    const services = body.rows.map((row) => row.service);
    const hasLinehaul = services.includes("Linehaul");
    const hasAdditional = services.includes("Additional Services");
    if (!hasLinehaul || !hasAdditional) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "rows must include one Linehaul and one Additional Services",
      });
    }

    const [first, second] = body.rows;
    if (!first || !second) {
      return;
    }

    for (const field of ["effective_date", "pickup_zone", "delivery_zone", "carrier"] as const) {
      if (first[field] !== second[field]) {
        ctx.addIssue({
          code: "custom",
          path: ["rows"],
          message: `${field} must be identical on both Tariff Adjustment rows`,
        });
      }
    }
  });

export type CreateTariffAdjustmentsInput = z.infer<typeof createTariffAdjustmentsSchema>;
export type TariffAdjustmentRequestRow = CreateTariffAdjustmentsInput["rows"][number];

export function formatTariffEffectiveDate(date: Date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function collectForbiddenKeys(value: unknown): string[] {
  const found = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (
        TARIFF_ADJUSTMENT_FORBIDDEN_KEYS.includes(
          key as (typeof TARIFF_ADJUSTMENT_FORBIDDEN_KEYS)[number],
        )
      ) {
        found.add(key);
      }
      visit(nested);
    }
  };

  visit(value);
  return [...found];
}
