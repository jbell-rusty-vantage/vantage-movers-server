/**
 * Canonical agent-name normalization helper.
 *
 * Lives in its own file so booking creation, allocation upsert, cancellation
 * primary-agent lookup, and any future agent-facing services can compute a
 * consistent normalized form without pulling the heavier allocation service.
 *
 * Behavior matches the original implementation in `v1.service.ts`:
 *   - trims leading/trailing whitespace
 *   - collapses internal whitespace runs to a single space
 *   - lowercases the result
 */
export function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
