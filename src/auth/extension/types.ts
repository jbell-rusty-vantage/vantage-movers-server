import type { CurrentExtensionRole } from "./roles";

export type ExtensionRole = CurrentExtensionRole;

export type PublicExtensionUser = {
  id: string;
  email: string;
  roles: CurrentExtensionRole[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
