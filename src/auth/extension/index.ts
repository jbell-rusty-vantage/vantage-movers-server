export { getExtensionAuthConfig, type ExtensionAuthConfig } from "./config";
export { hashPassword, verifyPassword } from "./password";
export {
  CURRENT_EXTENSION_ROLES,
  formatTariffActorRole,
  hasExtensionRole,
  normalizeExtensionRoles,
  resolveStoredExtensionRoles,
  rolesSetsEqual,
  type CurrentExtensionRole,
} from "./roles";
export {
  accessTokenMatchesStoredUser,
  authenticateExtensionUser,
  getExtensionUserFromAccessToken,
  issueTokens,
  normalizeEmail,
  refreshExtensionSession,
  refreshTokenMatchesStoredUser,
  toPublicExtensionUser,
  type AccessTokenUserLookup,
  type StoredExtensionUserForAccess,
} from "./session";
export {
  isAccessTokenPayload,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type AccessTokenPayload,
  type RefreshTokenPayload,
  type VerifiedAccessToken,
  type VerifiedRefreshToken,
} from "./tokens";
export type { AuthTokens, ExtensionRole, PublicExtensionUser } from "./types";
