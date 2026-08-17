import { z } from "zod";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import {
  looseEmailString,
  moveSizeSchema,
  nonEmptyString,
  optionalFloridaCalendarDate,
  optionalString,
  zipSchema,
} from "../../validation/v1/common";

function hasLeadName(value: { name?: string; first_name?: string; last_name?: string }) {
  return Boolean(value.name || value.first_name || value.last_name);
}

const trustedGranotFormLeadCreateFields = {
  job_no: nonEmptyString,
  name: optionalString,
  first_name: optionalString,
  last_name: optionalString,
  phone_number: nonEmptyString,
  email: looseEmailString,
  pickup_city: optionalString,
  pickup_zip: zipSchema,
  delivery_city: optionalString,
  destination_zip: zipSchema,
  pickup_state: optionalString,
  delivery_state: optionalString,
  move_size: moveSizeSchema.optional(),
  move_date: optionalFloridaCalendarDate,
  source_company: optionalString,
  post_to_granot: z.boolean().optional(),
};

export const trustedGranotFormLeadCreateSchema = z
  .object(trustedGranotFormLeadCreateFields)
  .strict()
  .superRefine((value, ctx) => {
    if (!hasLeadName(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Form Lead requires first name, last name, or display name",
        path: ["name"],
      });
    }
    if (!normalizePhoneNumberForMatch(value.phone_number)) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Form Lead requires a normalized phone",
        path: ["phone_number"],
      });
    }
    if (!normalizeJobNo(value.job_no)) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Form Lead requires a normalized Job Number",
        path: ["job_no"],
      });
    }
    if (value.post_to_granot === true) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Leads must persist post_to_granot=false",
        path: ["post_to_granot"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    post_to_granot: false as const,
    ingestion_origin: "granot_lead_created" as const,
  }));

export const trustedGranotCallLeadCreateSchema = z
  .object({
    job_no: nonEmptyString,
    phone_number: optionalString,
    name: optionalString,
    first_name: optionalString,
    last_name: optionalString,
    email: looseEmailString,
    source_company: optionalString,
    post_to_granot: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!normalizeJobNo(value.job_no)) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Call Lead requires a normalized Job Number",
        path: ["job_no"],
      });
    }
    if (value.post_to_granot === true) {
      ctx.addIssue({
        code: "custom",
        message: "Granot-created Leads must persist post_to_granot=false",
        path: ["post_to_granot"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    post_to_granot: false as const,
    ingestion_origin: "granot_lead_created" as const,
  }));

export type TrustedGranotFormLeadCreateInput = z.infer<
  typeof trustedGranotFormLeadCreateSchema
>;
export type TrustedGranotCallLeadCreateInput = z.infer<
  typeof trustedGranotCallLeadCreateSchema
>;
