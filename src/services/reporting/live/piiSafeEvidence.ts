/**
 * PII-safe evidence helpers for live Google integration and janitor output.
 */

export type MaskedLiveTestEvidence = {
  run_tag: string;
  oauth_path: "owner_oauth";
  commit_sha?: string;
  workflow_run_id?: string;
  artifact_ids_masked: string[];
  checksum?: string;
  cleanup_outcome: "pending" | "completed" | "partial" | "failed" | "skipped";
  janitor_status?: "not_run" | "completed" | "failed" | "skipped";
  limitation?: string;
  steps: Array<{ name: string; outcome: "passed" | "failed" | "skipped"; detail?: string }>;
};

export type LiveTestCleanupError = {
  code: string;
  message: string;
  artifact_id_masked?: string;
};

const SENSITIVE_KEY =
  /(?:^|_)(email|phone|name|customer|lead|address|ssn|token|secret|refresh|authorization)(?:$|_)/i;
const SENSITIVE_VALUE =
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?:\+?\d[\d\s().-]{7,}\d)/;
const GOOGLE_FILE_ID_EMBEDDED = /\b[a-zA-Z0-9_-]{20,}\b/g;
const GOOGLE_DRIVE_URL =
  /https?:\/\/(?:docs\.google\.com|drive\.google\.com)\/[^\s]+/gi;
const BEARER_TOKEN = /\b(?:ya29\.|Bearer\s+)[A-Za-z0-9._-]+\b/gi;

export function maskGoogleFileId(fileId: string): string {
  const trimmed = fileId.trim();
  if (trimmed.length <= 10) return "***";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function maskRunTag(runTag: string): string {
  const trimmed = runTag.trim();
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function sanitizeLiveTestString(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(GOOGLE_DRIVE_URL, "[redacted_url]");
  sanitized = sanitized.replace(BEARER_TOKEN, "[redacted_token]");
  sanitized = sanitized.replace(GOOGLE_FILE_ID_EMBEDDED, (match) =>
    looksLikeGoogleFileId(match) ? maskGoogleFileId(match) : match,
  );
  if (SENSITIVE_VALUE.test(sanitized)) return "[redacted]";
  return sanitized;
}

export function sanitizeLiveTestLogDetail(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeLiveTestString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLiveTestLogDetail(item));
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      sanitized[key] = sanitizeLiveTestLogDetail(nested);
    }
    return sanitized;
  }
  return "[redacted]";
}

export function buildStructuredCleanupError(input: {
  code: string;
  message: string;
  fileId?: string;
}): LiveTestCleanupError {
  return {
    code: input.code,
    message: sanitizeLiveTestString(input.message),
    ...(input.fileId ? { artifact_id_masked: maskGoogleFileId(input.fileId) } : {}),
  };
}

export function buildMaskedLiveTestEvidence(
  input: Omit<MaskedLiveTestEvidence, "artifact_ids_masked"> & {
    artifactIds: string[];
  },
): MaskedLiveTestEvidence {
  return sanitizeLiveTestLogDetail({
    run_tag: maskRunTag(input.run_tag),
    oauth_path: input.oauth_path,
    ...(input.commit_sha ? { commit_sha: input.commit_sha.slice(0, 12) } : {}),
    ...(input.workflow_run_id ? { workflow_run_id: input.workflow_run_id } : {}),
    artifact_ids_masked: input.artifactIds.map(maskGoogleFileId),
    ...(input.checksum ? { checksum: input.checksum } : {}),
    cleanup_outcome: input.cleanup_outcome,
    ...(input.janitor_status ? { janitor_status: input.janitor_status } : {}),
    ...(input.limitation ? { limitation: input.limitation } : {}),
    steps: input.steps,
  }) as MaskedLiveTestEvidence;
}

function looksLikeGoogleFileId(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return false;
  if (/^[a-z][a-z0-9_]*$/.test(trimmed)) return false;
  return true;
}
