import { z } from "zod";
import { EXTENSION_ROLES } from "../../models/ExtensionUser";

export const createExtensionUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(EXTENSION_ROLES),
});

export type CreateExtensionUserBody = z.infer<typeof createExtensionUserSchema>;
