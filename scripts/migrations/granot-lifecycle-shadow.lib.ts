import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import type { ExecutionMode, SynchronizationOutcome } from "../../src/services/granotLifecycle/types.js";
import { maskReceiptId } from "./granot-lifecycle-migration.lib.js";

export const GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION = "granot-lifecycle-shadow/1";
export const GRANOT_LIFECYCLE_SHADOW_MAX_LIMIT = 10_000;

export type ShadowCliOptions = { limit: number; after_id?: string; confirm_production?: string };
export type ShadowReceipt = { id: string; captured_at: Date; event_class: string };
export type ShadowDecision = {
  decision_id: string;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: string;
  match_method: string;
  source_ref: string;
  effect_kinds: string[];
};
export type ForbiddenCollectionSnapshot = Record<string, { count: number; state_hash: string }>;
export type ShadowCheckpoint = {
  script_version: string;
  environment_fingerprint: string;
  selection_after_id: string | null;
  last_completed_receipt_id: string;
  completed_count: number;
  report_hash: string;
};
export type ShadowRunReport = {
  script_version: string;
  environment_fingerprint: string;
  selection: { requested_limit: number; effective_after_masked_id: string | null; selected_count: number; excluded_post_cutoff_count: number };
  counts: { processed: number; already_evidenced: number; technical_failures: number };
  distributions: { event_class: Record<string, number>; outcome: Record<string, number>; reason_code: Record<string, number>; match_method: Record<string, number>; source_ref: Record<string, number> };
  masked_sample_ids: string[];
  forbidden_effects: { unchanged: boolean; before: ForbiddenCollectionSnapshot; after: ForbiddenCollectionSnapshot; changed_collections: string[] };
  activation_unchanged: boolean;
  passed: boolean;
};
export type HistoricalShadowDependencies = {
  environmentFingerprint: string;
  activationFingerprint: () => Promise<string>;
  loadCheckpoint: () => Promise<ShadowCheckpoint | null>;
  saveCheckpoint: (checkpoint: ShadowCheckpoint) => Promise<void>;
  listReceipts: (input: { afterId?: string; limit: number }) => Promise<{ receipts: ShadowReceipt[]; excludedPostCutoffCount: number }>;
  snapshotForbiddenCollections: () => Promise<ForbiddenCollectionSnapshot>;
  processReceipt: (receiptId: string) => Promise<{ decision_id: string; outcome: SynchronizationOutcome }>;
  loadDecision: (decisionId: string) => Promise<ShadowDecision | null>;
};

export function parseShadowCliOptions(args: readonly string[]): ShadowCliOptions {
  const allowed = /^(--limit=|--after-id=|--confirm-production=)/;
  const unknown = args.filter((arg) => arg.startsWith("--") && !allowed.test(arg));
  if (unknown.length) throw new Error(`Unknown shadow option: ${unknown[0]}`);
  const limitArgs = args.filter((arg) => arg.startsWith("--limit="));
  if (limitArgs.length !== 1) throw new Error("Exactly one --limit=<positive integer> is required.");
  const limitText = limitArgs[0]!.slice("--limit=".length);
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > GRANOT_LIFECYCLE_SHADOW_MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${GRANOT_LIFECYCLE_SHADOW_MAX_LIMIT}.`);
  }
  const afterArgs = args.filter((arg) => arg.startsWith("--after-id="));
  if (afterArgs.length > 1) throw new Error("--after-id may be supplied only once.");
  const after_id = afterArgs[0]?.slice("--after-id=".length);
  if (after_id && !ObjectId.isValid(after_id)) throw new Error("--after-id must be a valid ObjectId.");
  const confirmationArgs = args.filter((arg) => arg.startsWith("--confirm-production="));
  if (confirmationArgs.length > 1) throw new Error("--confirm-production may be supplied only once.");
  const confirm_production = confirmationArgs[0]?.slice("--confirm-production=".length);
  return { limit, ...(after_id ? { after_id } : {}), ...(confirm_production ? { confirm_production } : {}) };
}

export function assertCheckpointCompatible(input: { checkpoint: ShadowCheckpoint | null; environmentFingerprint: string; requestedAfterId?: string }): string | undefined {
  const { checkpoint } = input;
  if (!checkpoint) return input.requestedAfterId;
  if (checkpoint.script_version !== GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION || checkpoint.environment_fingerprint !== input.environmentFingerprint) {
    throw new Error("Shadow checkpoint belongs to an incompatible environment or script.");
  }
  if (input.requestedAfterId && input.requestedAfterId.toLowerCase() < checkpoint.last_completed_receipt_id.toLowerCase()) {
    throw new Error("--after-id cannot move behind the committed checkpoint.");
  }
  return input.requestedAfterId ?? checkpoint.last_completed_receipt_id;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function stableJson(value: unknown): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortJson(nested)]));
  return value;
}
function increment(target: Record<string, number>, key: string): void { target[key] = (target[key] ?? 0) + 1; }
function changedCollections(before: ForbiddenCollectionSnapshot, after: ForbiddenCollectionSnapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name]?.count !== after[name]?.count || before[name]?.state_hash !== after[name]?.state_hash).sort();
}

export async function runHistoricalShadowCertification(input: { options: ShadowCliOptions; deps: HistoricalShadowDependencies }): Promise<ShadowRunReport> {
  const checkpoint = await input.deps.loadCheckpoint();
  const afterId = assertCheckpointCompatible({ checkpoint, environmentFingerprint: input.deps.environmentFingerprint, requestedAfterId: input.options.after_id });
  const activationBefore = await input.deps.activationFingerprint();
  const before = await input.deps.snapshotForbiddenCollections();
  const selection = await input.deps.listReceipts({ ...(afterId ? { afterId } : {}), limit: input.options.limit });
  const distributions = { event_class: {} as Record<string, number>, outcome: {} as Record<string, number>, reason_code: {} as Record<string, number>, match_method: {} as Record<string, number>, source_ref: {} as Record<string, number> };
  const samples: string[] = [];
  let alreadyEvidenced = 0;
  let completed = checkpoint?.completed_count ?? 0;
  for (const receipt of selection.receipts) {
    let result: Awaited<ReturnType<HistoricalShadowDependencies["processReceipt"]>>;
    try { result = await input.deps.processReceipt(receipt.id); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "technical_failure";
      throw new Error(`Historical shadow stopped on bounded error code: ${code}`);
    }
    const decision = await input.deps.loadDecision(result.decision_id);
    if (!decision) throw new Error("Historical shadow processor returned a missing Decision reference.");
    if (decision.execution_mode !== "historical_shadow") throw new Error("Historical shadow selected receipt produced a non-historical Decision.");
    const forbiddenEffects = decision.effect_kinds.filter((kind) => !["record_link_established", "record_link_confirmed"].includes(kind));
    if (forbiddenEffects.length) throw new Error("Historical shadow Decision recorded a forbidden effect.");
    if (decision.reason_code === "desired_state_already_current") alreadyEvidenced += 1;
    increment(distributions.event_class, receipt.event_class || "none");
    increment(distributions.outcome, decision.outcome);
    increment(distributions.reason_code, decision.reason_code);
    increment(distributions.match_method, decision.match_method || "none");
    increment(distributions.source_ref, decision.source_ref || "none");
    if (samples.length < 10) samples.push(maskReceiptId(receipt.id));
    completed += 1;
    await input.deps.saveCheckpoint({
      script_version: GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION,
      environment_fingerprint: input.deps.environmentFingerprint,
      selection_after_id: afterId ?? null,
      last_completed_receipt_id: receipt.id,
      completed_count: completed,
      report_hash: stableHash({ completed, last_completed_receipt_id: receipt.id, distributions }),
    });
  }
  const after = await input.deps.snapshotForbiddenCollections();
  const changes = changedCollections(before, after);
  const activationUnchanged = activationBefore === await input.deps.activationFingerprint();
  return {
    script_version: GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION,
    environment_fingerprint: input.deps.environmentFingerprint,
    selection: { requested_limit: input.options.limit, effective_after_masked_id: afterId ? maskReceiptId(afterId) : null, selected_count: selection.receipts.length, excluded_post_cutoff_count: selection.excludedPostCutoffCount },
    counts: { processed: selection.receipts.length, already_evidenced: alreadyEvidenced, technical_failures: 0 },
    distributions,
    masked_sample_ids: samples,
    forbidden_effects: { unchanged: changes.length === 0, before, after, changed_collections: changes },
    activation_unchanged: activationUnchanged,
    passed: changes.length === 0 && activationUnchanged,
  };
}

export function fileCheckpointStore(filePath: string): { load: () => Promise<ShadowCheckpoint | null>; save: (checkpoint: ShadowCheckpoint) => Promise<void> } {
  return {
    async load() {
      try { return JSON.parse(await readFile(filePath, "utf8")) as ShadowCheckpoint; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async save(checkpoint) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    },
  };
}
