import jwt, { type JwtPayload } from "jsonwebtoken";
import { getExtensionAuthConfig } from "./config";
import type { ExtensionRole } from "./types";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: ExtensionRole;
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

function isAccessTokenPayload(payload: string | JwtPayload): payload is VerifiedAccessToken {
  return (
    typeof payload !== "string" &&
    typeof payload.sub === "string" &&
    typeof payload.email === "string" &&
    (payload.role === "owner" || payload.role === "employee")
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
