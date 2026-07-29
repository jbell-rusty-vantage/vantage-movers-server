const DEFAULT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export function getAdminProxySigningSecret(): string | undefined {
  return process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET?.trim() || undefined;
}

export function getAdminProxySignatureMaxAgeMs(): number {
  const raw = process.env.VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS?.trim();
  if (!raw) {
    return DEFAULT_SIGNATURE_MAX_AGE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SIGNATURE_MAX_AGE_MS;
  }
  return Math.min(parsed, DEFAULT_SIGNATURE_MAX_AGE_MS);
}

/**
 * Preview-only escape hatch for unsigned dashboard actor headers while D0
 * signing rolls out. Always disabled for production registry mutations.
 */
export function isOperationsRegistryPreviewUnsignedAllowed(): boolean {
  if (isProductionRuntime()) {
    return false;
  }
  const raw = process.env.OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  return vercelEnv === "production";
}
