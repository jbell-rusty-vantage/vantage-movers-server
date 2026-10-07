import { z } from "zod";
import { EXTENSION_ROLES } from "../../models/ExtensionUser";
import { objectIdSchema } from "./common";

const rolesSchema = z.array(z.enum(EXTENSION_ROLES)).min(1);

export const createExtensionUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  roles: rolesSchema,
  agent_id: objectIdSchema.nullable().optional(),
});

export const updateExtensionUserSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.preprocess((value) => {
      if (typeof value === "string" && value === "") {
        return undefined;
      }
      return value;
    }, z.string().min(8).optional()),
    roles: rolesSchema.optional(),
    agent_id: objectIdSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.email !== undefined ||
      value.password !== undefined ||
      value.roles !== undefined ||
      value.agent_id !== undefined,
    { message: "At least one of email, password, roles, or agent_id is required" },
  );

export const extensionUserIdParamSchema = z.object({
  id: objectIdSchema,
});

export type CreateExtensionUserBody = z.infer<typeof createExtensionUserSchema>;
export type UpdateExtensionUserBody = z.infer<typeof updateExtensionUserSchema>;
