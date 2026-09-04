import { z } from "zod";
import { EXTENSION_ROLES } from "../../models/ExtensionUser";
import { objectIdSchema } from "./common";

const rolesSchema = z.array(z.enum(EXTENSION_ROLES)).min(1);

export const createExtensionUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  roles: rolesSchema,
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
  })
  .refine(
    (value) =>
      value.email !== undefined || value.password !== undefined || value.roles !== undefined,
    { message: "At least one of email, password, or roles is required" },
  );

export const extensionUserIdParamSchema = z.object({
  id: objectIdSchema,
});

export type CreateExtensionUserBody = z.infer<typeof createExtensionUserSchema>;
export type UpdateExtensionUserBody = z.infer<typeof updateExtensionUserSchema>;
