/**
 * Provider account resolution for account-scoped Call Interaction identity.
 *
 * Identity is never keyed on a shared null account. The account comes from
 * trusted provider evidence first (webhook party `accountId`, the event path,
 * or a Call Log record `uri`) and from the verified configured account second.
 * Disagreement between evidence and configuration is an explicit failure, not
 * a silent choice. Callers decide whether to skip the observation or fail the
 * run; they never fabricate a default account.
 */
export class ProviderAccountError extends Error {
  constructor(
    readonly code: "account_unresolved" | "account_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ProviderAccountError";
  }
}

const ACCOUNT_PATH = /\/restapi\/v1\.0\/account\/(\d+)(?:\/|$)/;

export function accountIdFromProviderPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = ACCOUNT_PATH.exec(value);
  return match ? match[1]! : null;
}

export function configuredRingCentralAccountId(): string | null {
  const value = process.env.RINGCENTRAL_ACCOUNT_ID?.trim();
  return value && /^\d+$/.test(value) ? value : null;
}

export function resolveProviderAccountId(
  evidence: ReadonlyArray<string | null | undefined>,
  configured: string | null = configuredRingCentralAccountId(),
): string {
  const observed = new Set(
    evidence.filter((v): v is string => typeof v === "string" && v.trim() !== "" && v !== "~"),
  );
  if (observed.size > 1) {
    throw new ProviderAccountError(
      "account_mismatch",
      "Provider evidence names more than one account",
    );
  }
  const fromEvidence = observed.size === 1 ? [...observed][0]! : null;
  if (fromEvidence && configured && fromEvidence !== configured) {
    throw new ProviderAccountError(
      "account_mismatch",
      "Provider evidence disagrees with the configured account",
    );
  }
  const account = fromEvidence ?? configured;
  if (!account) {
    throw new ProviderAccountError(
      "account_unresolved",
      "No provider account in evidence and RINGCENTRAL_ACCOUNT_ID is not configured",
    );
  }
  return account;
}
