import jwt, { type JwtPayload } from "jsonwebtoken";
import { normalizeExtensionRoles, type CurrentExtensionRole } from "./roles";
import { getExtensionAuthConfig } from "./config";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  roles: CurrentExtensionRole[];
  token_version: number;
};

export type RefreshTokenPayload = {
  sub: string;
  token_version: number;
};

export type VerifiedAccessToken = AccessTokenPayload & JwtPayload;
export type VerifiedRefreshToken = RefreshTokenPayload & JwtPayload;

export function signAccessToken(payload: AccessTokenPayload): string {
  const config = getExtensionAuthConfig();
  return jwt.sign(payload, config.accessTokenSecret, {
    expiresIn: config.accessTokenTtlSeconds,
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const config = getExtensionAuthConfig();
  return jwt.sign(payload, config.refreshTokenSecret, {
    expiresIn: `${config.refreshTokenTtlDays}d`,
  });
}

export function verifyAccessToken(token: string): VerifiedAccessToken {
  const config = getExtensionAuthConfig();
  const payload = jwt.verify(token, config.accessTokenSecret);
  if (!isAccessTokenPayload(payload)) {
    throw new Error("Invalid access token payload");
  }
  return payload;
}

export function verifyRefreshToken(token: string): VerifiedRefreshToken {
  const config = getExtensionAuthConfig();
  const payload = jwt.verify(token, config.refreshTokenSecret);
  if (!isRefreshTokenPayload(payload)) {
    throw new Error("Invalid refresh token payload");
  }
  return payload;
}

export function isAccessTokenPayload(
  payload: string | JwtPayload,
): payload is VerifiedAccessToken {
  if (typeof payload === "string") {
    return false;
  }
  const roles = normalizeExtensionRoles(payload.roles);
  return (
    typeof payload.sub === "string" &&
    typeof payload.email === "string" &&
    typeof payload.token_version === "number" &&
    roles !== null
  );
}

function isRefreshTokenPayload(
  payload: string | JwtPayload,
): payload is VerifiedRefreshToken {
  return (
    typeof payload !== "string" &&
    typeof payload.sub === "string" &&
    typeof payload.token_version === "number"
  );
}
