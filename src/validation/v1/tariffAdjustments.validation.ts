import { z } from "zod";
import { isCatalogTariffPair } from "../../config/domain/tariffCatalog";
import { nonEmptyString, zipSchema } from "./common";

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
  "title",
  "source",
] as const;

const SHARED_ROW_FIELDS = [
  "effective_date",
  "pickup_zone",
  "delivery_zone",
  "carrier",
] as const;

const tariffAdjustmentRowSchema = z
  .object({
    effective_date: nonEmptyString.optional(),
    pickup_zone: zipSchema,
    delivery_zone: zipSchema,
    service: nonEmptyString,
    rule: nonEmptyString,
    new_rule: nonEmptyString,
    carrier: nonEmptyString,
  })
  .strict();

export const createTariffAdjustmentsSchema = z
  .object({
    rows: z.array(tariffAdjustmentRowSchema).min(1).max(20),
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

    const hasLinehaul = body.rows.some((row) => row.service === "Linehaul");
    if (!hasLinehaul) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "rows must include at least one Linehaul",
      });
    }

    body.rows.forEach((row, index) => {
      if (!isCatalogTariffPair(row.service, row.rule)) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "rule"],
          message: `rule is not valid for service ${row.service}`,
        });
      }
    });

    const [first] = body.rows;
    if (!first) {
      return;
    }

    for (const field of SHARED_ROW_FIELDS) {
      if (body.rows.some((row) => row[field] !== first[field])) {
        ctx.addIssue({
          code: "custom",
          path: ["rows"],
          message: `${field} must be identical on all Tariff Adjustment rows`,
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
