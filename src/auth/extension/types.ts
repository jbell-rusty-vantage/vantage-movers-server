import type { ExtensionRole } from "../../models/ExtensionUser";

export type { ExtensionRole };

export type PublicExtensionUser = {
  id: string;
  email: string;
  role: ExtensionRole;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
