export { getExtensionAuthConfig, type ExtensionAuthConfig } from "./config";
export { hashPassword, verifyPassword } from "./password";
export {
  authenticateExtensionUser,
  getExtensionUserFromAccessToken,
  normalizeEmail,
  refreshExtensionSession,
} from "./session";
export {
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
