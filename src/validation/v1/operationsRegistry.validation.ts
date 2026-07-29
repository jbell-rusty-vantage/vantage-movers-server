import { z } from "zod";
import {
  REGISTRY_CHANGE_ACTIONS,
  REGISTRY_CHANGE_ENTITY_TYPES,
} from "../../models/OperationsRegistryChange";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const pageInput = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(1).optional(),
);

const limitInput = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(1).max(100).optional(),
);

export const registryChangesQuerySchema = z
  .object({
    entity_type: z.enum(REGISTRY_CHANGE_ENTITY_TYPES).optional(),
    entity_id: optionalTrimmedString,
    actor_id: optionalTrimmedString,
    action: z.enum(REGISTRY_CHANGE_ACTIONS).optional(),
    request_id: optionalTrimmedString,
    from: optionalDateString,
    to: optionalDateString,
    page: pageInput,
    limit: limitInput,
  })
  .strict();

export type RegistryChangesQuery = z.infer<typeof registryChangesQuerySchema>;

export const registryOverviewQuerySchema = z.object({}).strict();

export type RegistryOverviewQuery = z.infer<typeof registryOverviewQuerySchema>;

export const registryHealthQuerySchema = z.object({}).strict();

export type RegistryHealthQuery = z.infer<typeof registryHealthQuerySchema>;
