import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export type EncryptedGoogleToken = {
  encrypted_refresh_token: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  encryption_version: 1;
};

export function encryptGoogleRefreshToken(
  refreshToken: string,
  key: Buffer,
  ownerEmail: string,
): EncryptedGoogleToken {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(associatedData(ownerEmail));
  const encrypted = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);

  return {
    encrypted_refresh_token: encrypted.toString("base64"),
    refresh_token_iv: iv.toString("base64"),
    refresh_token_auth_tag: cipher.getAuthTag().toString("base64"),
    encryption_version: 1,
  };
}

export function decryptGoogleRefreshToken(
  encrypted: EncryptedGoogleToken,
  key: Buffer,
  ownerEmail: string,
): string {
  assertKey(key);
  if (encrypted.encryption_version !== 1) {
    throw new Error(
      `Unsupported Google OAuth token encryption version: ${encrypted.encryption_version}`,
    );
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encrypted.refresh_token_iv, "base64"),
  );
  decipher.setAAD(associatedData(ownerEmail));
  decipher.setAuthTag(
    Buffer.from(encrypted.refresh_token_auth_tag, "base64"),
  );
  return Buffer.concat([
    decipher.update(
      Buffer.from(encrypted.encrypted_refresh_token, "base64"),
    ),
    decipher.final(),
  ]).toString("utf8");
}

function associatedData(ownerEmail: string): Buffer {
  return Buffer.from(
    `vantage-google-drive-oauth:v1:${ownerEmail.trim().toLowerCase()}`,
    "utf8",
  );
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("Google OAuth token encryption key must be 32 bytes");
  }
}
