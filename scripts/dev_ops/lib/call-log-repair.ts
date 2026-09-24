/**
 * CC-07 historical repair core (Call Log capture completeness §6.7). Used by
 * `scripts/dev_ops/repair-call-log-capture.ts` and its replica proof.
 *
 * 1. Re-reads the provider Call Log in 24 h start-time windows (Detailed, 250 per page, paced,
 *    429 → the documented 10-minute wait) and classifies every record against the stored row
 *    exactly like `diff-call-log-vs-interactions.ts`: MISSING / STALE / unchanged.
 * 2. In write mode applies every record through `applyInteractionObservation` with the LIVE
 *    source (`call_log_reconcile`, proof `call_log_repair:<id>`, the run id as request id), so the
 *    live downstream scheduling applies (the `backfill` source only schedules attachment refresh).
 * 3. Immediately after each changed interaction commits, drives its downstream chain in this
 *    process by job id: recording discovery → media fetch → transcription → conversation analysis
 *    → application → number refresh → application. Model and STT work run on whatever key the
 *    caller configured (the entry point sets the operator's personal key and ledger).
 *
 * Job-claim exclusivity: every stage is claimed by id the moment the previous stage commits
 * (no queue wake-up is published from this process), and any unit that cannot run now is put on
 * an `operator_hold` (status `paused`, which no cron or queue consumer claims) until this runner
 * releases and claims it. A unit a production consumer claimed first is recorded as `peer`.
 *
 * Manifests and logs carry identifiers, counts and outcomes only: no phone numbers or content.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose from "mongoose";
import { csiDataset } from "../../../src/config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../src/models/CallInteraction";
import { getContactNumberModel } from "../../../src/models/ContactNumber";
import { getIntelligenceRunModel } from "../../../src/models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../src/models/IntelligenceSubmission";
import { getLeadConversationModel } from "../../../src/models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../../src/models/SalesIntelligenceJob";
import {
  accountIdFromProviderPath,
  configuredRingCentralAccountId,
  resolveProviderAccountId,
} from "../../../src/services/numberActivity/accountIdentity";
import {
  fetchDetailedCallLogPage,
  isProviderThrottle,
  throttleRetryAfterMs,
  type CallLogPageFetcher,
} from "../../../src/services/numberActivity/callLogClient";
import { loadDirectoryLookup, type DirectoryLookup } from "../../../src/services/numberActivity/directory";
import { identityFromCallLogRecord, type CallLogRecordInput } from "../../../src/services/numberActivity/interactionProjection";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
  type ApplyResult,
} from "../../../src/services/numberActivity/persistInteraction";
import type { RouteResolver } from "../../../src/services/numberActivity/types";
import { waitForBackfillPeer } from "../../backfill-csi-structured-analysis.lib";
import { recoveryKindFor, stampCaptureRecovery } from "./call-log-repair-recovery";

export const REPAIR_MANIFEST_VERSION = "call-log-repair-v1" as const;
export const OPERATOR_HOLD_REASON = "operator_hold";
export const DAY_MS = 86_400_000;
export const DEFAULT_PACE_MS = 6_000;
export const THROTTLE_WAIT_MS = 10 * 60_000;
export const PER_PAGE = 250;
const MAX_PAGES_PER_WINDOW = 40;

// ── Classification (mirrors diff-call-log-vs-interactions.ts) ─────────────────
export type RepairClass = "MISSING" | "STALE" | "unchanged";
export type StoredCallRow = {
  _id: unknown;
  provider_result?: string | null;
  duration_seconds?: number | null;
  provider_last_modified_at?: Date | null;
  recordings?: Array<{ provider_recording_id: string }>;
};

export function recordRecordingIds(record: CallLogRecordInput): string[] {
  const legs = Array.isArray(record.legs) ? (record.legs as Array<{ recording?: unknown }>) : [];
  return [record.recording, ...legs.map(leg => leg.recording)]
    .filter((r): r is { id: string } => !!r && typeof (r as { id?: unknown }).id === "string")
    .map(r => r.id);
}

export function classifyAgainstStored(record: CallLogRecordInput, stored: StoredCallRow | null): { kind: RepairClass; reasons: string[] } {
  if (!stored) return { kind: "MISSING", reasons: ["not_stored"] };
  const reasons: string[] = [];
  const storedRecordings = new Set((stored.recordings ?? []).map(r => r.provider_recording_id));
  const providerModified = typeof record.lastModifiedTime === "string" ? new Date(record.lastModifiedTime) : null;
  const storedModified = stored.provider_last_modified_at ?? null;
  if (providerModified && (!storedModified || providerModified > storedModified)) reasons.push("provider_newer_than_stored");
  if ((record.result ?? null) !== (stored.provider_result ?? null)) reasons.push("result_differs");
  if (typeof record.duration === "number" && record.duration !== stored.duration_seconds) reasons.push("duration_differs");
  if (recordRecordingIds(record).some(id => !storedRecordings.has(id))) reasons.push("recording_missing_in_store");
  return { kind: reasons.length ? "STALE" : "unchanged", reasons };
}

export async function loadStoredCanonical(accountId: string, record: CallLogRecordInput): Promise<StoredCallRow | null> {
  const identity = identityFromCallLogRecord(record);
  const or: Record<string, unknown>[] = [];
  if (identity.telephony_session_id) or.push({ telephony_session_id: identity.telephony_session_id });
  if (identity.call_log_ids.length) or.push({ call_log_ids: { $in: identity.call_log_ids } });
  if (!or.length) return null;
  const Interactions = getCallInteractionModel();
  const projection = "provider_result duration_seconds provider_last_modified_at recordings merged_into_id";
  let row = await Interactions.findOne({ provider: "ringcentral", provider_account_id: accountId, $or: or }).select(projection).lean();
  for (let hop = 0; hop < 5 && row?.merged_into_id; hop++) row = await Interactions.findById(row.merged_into_id).select(projection).lean();
  return (row as StoredCallRow | null) ?? null;
}

// ── Manifest ───────────────────────────────────────────────────────────────────
export type Counts = { MISSING: number; STALE: number; unchanged: number };
export type DayEntry = {
  day: string; from: string; to: string;
  state: "pending" | "classified" | "projected" | "failed";
  pages: number; records: number;
  counts: Counts | null;
  applied: { created: number; updated: number; noop: number; failed: number; changed_without_diff: number };
  error?: string;
};
export type StageRecord = {
  stage: string; job_id: string; outcome: "done" | "deferred" | "blocked" | "failed" | "missing";
  by: "repair" | "peer" | "prior" | null; paid: boolean; reason?: string;
};
export type InteractionEntry = {
  interaction_id: string; day: string; record_id: string | null; classification: RepairClass;
  created: boolean; contact_number_id: string | null; job_keys: string[];
  downstream: "pending" | "done" | "deferred" | "blocked" | "failed" | "none" | "transcribed";
  stages: StageRecord[]; reason?: string;
};
export type HoldEntry = { job_id: string; stage: string; interaction_id: string; prior_status: string; prior_reason: string | null; due_at: string; held_at: string };
export type RepairManifest = {
  version: typeof REPAIR_MANIFEST_VERSION;
  run_id: string;
  mode: "dry_run" | "apply";
  created_at: string;
  range: { from: string; to: string };
  dataset: { deployment: string; database: string };
  credential: string | null;
  models: Record<string, string | null>;
  days: DayEntry[];
  interactions: InteractionEntry[];
  holds: HoldEntry[];
};

export function dayWindows(from: Date, to: Date): Array<{ day: string; from: Date; to: Date }> {
  if (!(from < to)) throw new Error("--from must be before --to");
  const out: Array<{ day: string; from: Date; to: Date }> = [];
  for (let start = from.getTime(); start < to.getTime(); start += DAY_MS) {
    const end = Math.min(start + DAY_MS, to.getTime());
    out.push({ day: new Date(start).toISOString().slice(0, 10), from: new Date(start), to: new Date(end) });
  }
  return out;
}

export function newManifest(input: { mode: "dry_run" | "apply"; from: Date; to: Date; now: Date; credential: string | null; models: Record<string, string | null> }): RepairManifest {
  return {
    version: REPAIR_MANIFEST_VERSION, run_id: new mongoose.Types.ObjectId().toHexString(), mode: input.mode,
    created_at: input.now.toISOString(), range: { from: input.from.toISOString(), to: input.to.toISOString() },
    dataset: csiDataset(), credential: input.credential, models: input.models,
    days: dayWindows(input.from, input.to).map(w => ({ day: w.day, from: w.from.toISOString(), to: w.to.toISOString(), state: "pending",
      pages: 0, records: 0, counts: null, applied: { created: 0, updated: 0, noop: 0, failed: 0, changed_without_diff: 0 } })),
    interactions: [], holds: [],
  };
}

export async function loadManifest(path: string): Promise<RepairManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as RepairManifest;
    if (parsed.version !== REPAIR_MANIFEST_VERSION) throw new Error(`manifest ${path} is not ${REPAIR_MANIFEST_VERSION}`);
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function manifestSaver(path: string) {
  let pending = Promise.resolve();
  return (manifest: RepairManifest) => {
    const contents = JSON.stringify(manifest, null, 2) + "\n";
    pending = pending.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, contents);
      await rename(temporary, path);
    });
    return pending;
  };
}

export function jsonlLogger(path: string, runId: string, echo: (line: string) => void = () => undefined) {
  let pending = Promise.resolve();
  return (event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), run_id: runId, event, ...fields });
    echo(line);
    pending = pending.then(async () => { await mkdir(dirname(path), { recursive: true }); await appendFile(path, line + "\n"); });
    return pending;
  };
}

// ── Downstream stages ───────────────────────────────────────────────────────────
type StageResult = { status: string; reason?: string; run_id?: string };
export type StageRunners = {
  discovery(jobId: string): Promise<StageResult>;
  media(jobId: string): Promise<StageResult>;
  /** Targeted transcription scheduling for one conversation; returns created job ids. */
  scheduleTranscription(conversationId: string): Promise<string[]>;
  transcription(jobId: string): Promise<StageResult>;
  analysis(jobId: string, stage: "analysis" | "number_refresh"): Promise<StageResult>;
  application(jobId: string): Promise<StageResult>;
};
const PAID_STAGES = new Set(["transcription", "analysis", "number_refresh"]);

export type RepairSeams = {
  now?: () => Date;
  sleep?: (ms: number) => Promise<unknown>;
  fetchPage?: CallLogPageFetcher;
  directory?: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId?: string | null;
  apply?: typeof applyInteractionObservation;
  stages?: StageRunners;
  paceMs?: number;
  throttleWaitMs?: number;
  /** How long the run keeps waiting for held (not yet due) units before leaving them held for a resume. */
  maxWaitMs?: number;
  save: (manifest: RepairManifest) => Promise<unknown>;
  log: (event: string, fields?: Record<string, unknown>) => Promise<unknown>;
  /** S5c-RECOVERY (G4): stamps `capture_recovery` on a call this run inserted or completed. Default: the real write. */
  stampRecovery?: typeof stampCaptureRecovery;
};

type JobRow = { _id: unknown; status: string; reason?: string | null; next_attempt_at: Date; leased_until?: Date | null; completed_at?: Date | null;
  stage: string; dedupe_key: string; input_refs: unknown[] };

class Downstream {
  /**
   * `throughTranscription`: stop each conversation after transcription and put its analysis job on
   * `operator_hold`, so the operator can analyse later with an improved analysis (a later run without
   * the option releases and claims the held analyses by id).
   */
  constructor(private readonly manifest: RepairManifest, private readonly stages: StageRunners, private readonly seams: RepairSeams,
    private readonly throughTranscription = false) {}
  private now() { return (this.seams.now ?? (() => new Date()))(); }
  private jobs() { return getSalesIntelligenceJobModel(); }
  private async load(jobId: string) {
    return (await this.jobs().findById(jobId).select("status reason next_attempt_at leased_until completed_at stage dedupe_key input_refs").lean()) as JobRow | null;
  }

  /** Paused jobs are claimed by no cron, queue consumer or drain; only this runner releases its own hold. */
  private async hold(entry: InteractionEntry, stage: string, job: JobRow) {
    const held = await this.jobs().updateOne({ _id: String(job._id), status: { $in: ["pending", "retry"] } },
      { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } });
    if (held.modifiedCount !== 1) return false;
    this.manifest.holds.push({ job_id: String(job._id), stage, interaction_id: entry.interaction_id, prior_status: job.status,
      prior_reason: job.reason ?? null, due_at: job.next_attempt_at.toISOString(), held_at: this.now().toISOString() });
    await this.seams.log("hold", { interaction_id: entry.interaction_id, stage, job_id: String(job._id), due_at: job.next_attempt_at });
    return true;
  }

  /** Restores the job's own status, due now, so the immediate by-id claim that follows can take it. */
  private async release(jobId: string) {
    const index = this.manifest.holds.findIndex(h => h.job_id === jobId);
    if (index < 0) return false;
    const hold = this.manifest.holds[index]!;
    await this.jobs().updateOne({ _id: jobId, status: "paused", reason: OPERATOR_HOLD_REASON },
      { $set: { status: hold.prior_status, reason: hold.prior_reason, next_attempt_at: this.now() } });
    this.manifest.holds.splice(index, 1);
    await this.seams.log("release", { job_id: jobId, stage: hold.stage });
    return true;
  }

  /** Hand every held unit back to production consumers (operator decision, `--release-holds`). */
  async releaseAllToProduction() {
    for (const hold of [...this.manifest.holds]) {
      await this.jobs().updateOne({ _id: hold.job_id, status: "paused", reason: OPERATOR_HOLD_REASON },
        { $set: { status: hold.prior_status, reason: hold.prior_reason, next_attempt_at: new Date(hold.due_at) } });
      await this.seams.log("released_to_production", { job_id: hold.job_id, stage: hold.stage, interaction_id: hold.interaction_id });
    }
    this.manifest.holds = [];
  }

  private record(entry: InteractionEntry, record: StageRecord) {
    const existing = entry.stages.findIndex(s => s.job_id === record.job_id);
    if (existing >= 0) entry.stages[existing] = record; else entry.stages.push(record);
    return this.seams.log("stage", { interaction_id: entry.interaction_id, ...record });
  }

  /**
   * One stage unit by id. Returns the outcome; `deferred` units are held. A unit that a production
   * consumer claimed first is waited for and recorded as `peer`.
   */
  private async runUnit(entry: InteractionEntry, stage: string, jobId: string, invoke: () => Promise<StageResult>): Promise<StageRecord & { result?: StageResult }> {
    const paid = PAID_STAGES.has(stage);
    const touched = entry.stages.some(s => s.job_id === jobId && s.by === "repair");
    let job = await this.load(jobId);
    if (!job) return { stage, job_id: jobId, outcome: "missing", by: null, paid };
    if (job.status === "completed") {
      // Completed before this run started: prior production work. Completed since, not by this runner: a peer consumer.
      const since = job.completed_at && job.completed_at >= new Date(this.manifest.created_at);
      return { stage, job_id: jobId, outcome: "done", by: touched ? "repair" : since ? "peer" : "prior", paid };
    }
    if (job.status === "dead_letter") return { stage, job_id: jobId, outcome: "failed", by: null, paid, reason: job.reason ?? "dead_letter" };
    if (job.status === "paused" && job.reason === OPERATOR_HOLD_REASON) {
      const due = this.manifest.holds.find(h => h.job_id === jobId);
      if (due && new Date(due.due_at) > this.now()) return { stage, job_id: jobId, outcome: "deferred", by: null, paid, reason: "held_until_due" };
      await this.release(jobId);
      job = (await this.load(jobId))!;
    }
    if (job.status === "paused") return { stage, job_id: jobId, outcome: "blocked", by: null, paid, reason: job.reason ?? "paused" };
    if (["pending", "retry"].includes(job.status) && job.next_attempt_at > this.now()) {
      await this.hold(entry, stage, job);
      return { stage, job_id: jobId, outcome: "deferred", by: null, paid, reason: `not_due:${job.reason ?? job.status}` };
    }
    let result: StageResult | undefined = await invoke();
    let by: StageRecord["by"] = "repair";
    if (result.status === "not_claimable" || result.status === "lease_lost") {
      by = "peer";
      await waitForBackfillPeer(async () => this.load(jobId) as Promise<{ status: string; leased_until?: Date | null } | null>,
        this.seams.sleep ?? (ms => new Promise(r => setTimeout(r, ms))));
      result = undefined;
    }
    const after = await this.load(jobId);
    if (!after) return { stage, job_id: jobId, outcome: "missing", by: null, paid };
    if (after.status === "completed") return { stage, job_id: jobId, outcome: "done", by, paid, result };
    if (after.status === "dead_letter") return { stage, job_id: jobId, outcome: "failed", by, paid, reason: after.reason ?? "dead_letter", result };
    if (after.status === "paused") return { stage, job_id: jobId, outcome: "blocked", by, paid, reason: after.reason ?? "paused", result };
    if (["pending", "retry"].includes(after.status)) {
      await this.hold(entry, stage, after);
      return { stage, job_id: jobId, outcome: "deferred", by: null, paid, reason: `${result?.status ?? "peer"}:${after.reason ?? after.status}`, result };
    }
    return { stage, job_id: jobId, outcome: "deferred", by: null, paid, reason: `still_${after.status}`, result };
  }

  /** Runs a unit and stops the chain (returns false) unless it is done. */
  private async step(entry: InteractionEntry, stage: string, jobId: string, invoke: () => Promise<StageResult>) {
    const outcome = await this.runUnit(entry, stage, jobId, invoke);
    const { result, ...record } = outcome;
    await this.record(entry, record);
    if (outcome.outcome === "done") return { ok: true as const, result };
    entry.downstream = outcome.outcome === "missing" ? "failed" : outcome.outcome;
    entry.reason = `${stage}:${outcome.reason ?? outcome.outcome}`;
    return { ok: false as const, result };
  }

  async drive(entry: InteractionEntry): Promise<void> {
    entry.downstream = "pending";
    delete entry.reason;
    const Jobs = this.jobs();
    // 1. Recording discovery jobs this repair scheduled (live source) for the interaction.
    for (const key of entry.job_keys.filter(k => k.startsWith("csi:recording_discovery:"))) {
      const job = await Jobs.findOne({ dedupe_key: key }).select("_id").lean();
      if (!job) continue;
      if (!(await this.step(entry, "recording_discovery", String(job._id), () => this.stages.discovery(String(job._id)))).ok) return;
    }
    // 2. Every conversation of the interaction: media → transcription → analysis → application.
    const conversations = await getLeadConversationModel().find({ call_interaction_id: entry.interaction_id }).select("_id").sort({ _id: 1 }).lean();
    for (const { _id } of conversations) if (!(await this.driveConversation(entry, String(_id)))) return;
    if (this.throughTranscription) {
      // Analysis is held; the number synthesis follows the applications of a later full run.
      entry.downstream = entry.stages.some(s => s.stage === "analysis") ? "transcribed" : entry.stages.length ? "done" : "none";
      return;
    }
    // 3. The number synthesis the conversation applications scheduled.
    if (entry.contact_number_id && conversations.length && !(await this.driveNumberRefresh(entry, entry.contact_number_id))) return;
    entry.downstream = entry.stages.length ? "done" : "none";
  }

  private async driveConversation(entry: InteractionEntry, conversationId: string): Promise<boolean> {
    const Jobs = this.jobs(), Conversations = getLeadConversationModel();
    const subject = `conversation:${conversationId}`;
    const media = await Jobs.findOne({ ...csiDataset(), stage: "media_fetch", subject_key: subject }).sort({ input_revision: -1 }).select("_id").lean();
    if (media && !(await this.step(entry, "media_fetch", String(media._id), () => this.stages.media(String(media._id)))).ok) return false;
    let conversation = await Conversations.findById(conversationId).select("state media_digest_sha256 latest_transcript_version analysis_eligibility").lean();
    if (!conversation) return true;
    if (!conversation.latest_transcript_version) {
      if (!conversation.media_digest_sha256) {
        // Excluded, unavailable or no recording: nothing paid follows for this conversation.
        await this.seams.log("conversation_skipped", { interaction_id: entry.interaction_id, conversation_id: conversationId, state: conversation.state,
          eligibility: conversation.analysis_eligibility?.status ?? null });
        return true;
      }
      const created = await this.stages.scheduleTranscription(conversationId);
      const transcription = created[0] ? { _id: created[0] } : await Jobs.findOne({ ...csiDataset(), stage: "transcription",
        dedupe_key: `csi:transcription:${subject}:${conversation.media_digest_sha256}` }).select("_id").lean();
      if (!transcription) {
        conversation = await Conversations.findById(conversationId).select("state media_digest_sha256 latest_transcript_version analysis_eligibility").lean();
        await this.seams.log("conversation_skipped", { interaction_id: entry.interaction_id, conversation_id: conversationId, state: conversation?.state ?? null,
          eligibility: conversation?.analysis_eligibility?.status ?? null, reason: "transcription_not_scheduled" });
        return true;
      }
      if (!(await this.step(entry, "transcription", String(transcription._id), () => this.stages.transcription(String(transcription._id)))).ok) return false;
      conversation = await Conversations.findById(conversationId).select("state media_digest_sha256 latest_transcript_version analysis_eligibility").lean();
      if (!conversation?.latest_transcript_version) return true;
    }
    const analysis = await Jobs.findOne({ ...csiDataset(), stage: "analysis", subject_key: subject,
      dedupe_key: `csi:analysis:${subject}:${conversation.latest_transcript_version}` }).select("_id").lean();
    if (!analysis) {
      await this.seams.log("conversation_skipped", { interaction_id: entry.interaction_id, conversation_id: conversationId, reason: "analysis_not_scheduled" });
      return true;
    }
    if (this.throughTranscription) return this.holdAnalysis(entry, String(analysis._id));
    if (!(await this.step(entry, "analysis", String(analysis._id), () => this.stages.analysis(String(analysis._id), "analysis"))).ok) return false;
    return this.driveApplication(entry, String(analysis._id));
  }

  /** `--through transcription`: hold a due analysis so no cron runs it; a later full run releases and claims it. */
  private async holdAnalysis(entry: InteractionEntry, jobId: string): Promise<boolean> {
    const job = await this.load(jobId);
    if (!job) return true;
    const held = job.status === "paused" && job.reason === OPERATOR_HOLD_REASON
      ? true
      : ["pending", "retry"].includes(job.status) ? await this.hold(entry, "analysis", job) : false;
    await this.record(entry, { stage: "analysis", job_id: jobId, outcome: held ? "deferred" : job.status === "completed" ? "done" : "blocked",
      by: job.status === "completed" ? "peer" : null, paid: PAID_STAGES.has("analysis"), reason: held ? "held_for_later_analysis" : job.status });
    return true;
  }

  private async driveApplication(entry: InteractionEntry, analysisJobId: string): Promise<boolean> {
    const run = await getIntelligenceRunModel().findOne({ job_id: analysisJobId }).select("_id").sort({ _id: -1 }).lean();
    const submission = run ? await getIntelligenceSubmissionModel().findOne({ run_id: run._id }).select("application_job_id").lean() : null;
    if (!submission?.application_job_id) return true; // No receipt (shadow, faked or not produced): nothing to apply.
    const id = String(submission.application_job_id);
    return (await this.step(entry, "application", id, () => this.stages.application(id))).ok;
  }

  /**
   * Application schedules the number synthesis 15 s ahead (coalescing). No consumer can claim it
   * before it is due, so this runner makes it due and claims it by id in the same moment.
   */
  private async driveNumberRefresh(entry: InteractionEntry, numberId: string): Promise<boolean> {
    const number = await getContactNumberModel().findById(numberId).select("intelligence_schedule").lean();
    const jobId = number?.intelligence_schedule?.job_id ? String(number.intelligence_schedule.job_id) : null;
    if (!jobId) return true;
    const job = await this.load(jobId);
    if (!job || job.stage !== "number_refresh" || job.status === "completed") return true;
    await this.jobs().updateOne({ _id: jobId, status: "pending", next_attempt_at: { $gt: this.now() } }, { $set: { next_attempt_at: this.now() } });
    if (!(await this.step(entry, "number_refresh", jobId, () => this.stages.analysis(jobId, "number_refresh"))).ok) return false;
    return this.driveApplication(entry, jobId);
  }

  /** Re-drive deferred interactions as their held units fall due, until none remain or the wait budget is spent. */
  async settleDeferred(deadline: number) {
    const sleep = this.seams.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    for (;;) {
      const waiting = this.manifest.interactions.filter(e => e.downstream === "deferred" || e.downstream === "pending");
      if (!waiting.length) return;
      const nextDue = Math.min(...this.manifest.holds.map(h => new Date(h.due_at).getTime()), Number.POSITIVE_INFINITY);
      const now = this.now().getTime();
      if (nextDue > now) {
        if (!Number.isFinite(nextDue) || nextDue > deadline) return;
        await sleep(nextDue - now);
      }
      for (const entry of waiting) {
        await this.drive(entry);
        await this.seams.save(this.manifest);
      }
      if (this.now().getTime() > deadline) return;
      if (nextDue <= now) await sleep(1_000);
    }
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────────
async function fetchWindow(window: { from: Date; to: Date }, day: DayEntry, seams: RepairSeams, firstRequest: { done: boolean }) {
  const fetchPage = seams.fetchPage ?? fetchDetailedCallLogPage;
  const sleep = seams.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const records: CallLogRecordInput[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; ) {
    if (firstRequest.done) await sleep(seams.paceMs ?? DEFAULT_PACE_MS);
    firstRequest.done = true;
    let rows: unknown[];
    try {
      rows = await fetchPage({ from: window.from, to: window.to, page, perPage: PER_PAGE });
    } catch (error) {
      if (!isProviderThrottle(error)) throw error;
      const wait = Math.max(throttleRetryAfterMs(error), seams.throttleWaitMs ?? THROTTLE_WAIT_MS);
      await seams.log("throttled", { day: day.day, page, wait_ms: wait });
      await sleep(wait);
      continue;
    }
    const valid = rows.filter((r): r is CallLogRecordInput => !!r && typeof r === "object" && !Array.isArray(r));
    records.push(...valid);
    day.pages = page;
    await seams.log("page", { day: day.day, page, records: valid.length });
    if (rows.length < PER_PAGE) return records;
    page++;
  }
  throw new Error(`window ${day.day} exceeded ${MAX_PAGES_PER_WINDOW} pages`);
}

const startMs = (r: CallLogRecordInput) => {
  const t = typeof r.startTime === "string" ? Date.parse(r.startTime) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

export type RepairSummary = { days: Array<Pick<DayEntry, "day" | "state" | "records" | "counts" | "applied">>; interactions: number;
  downstream: Record<string, number>; peer_paid_units: number; holds: number };

export function summarize(manifest: RepairManifest): RepairSummary {
  const downstream: Record<string, number> = {};
  for (const e of manifest.interactions) downstream[e.downstream] = (downstream[e.downstream] ?? 0) + 1;
  return {
    days: manifest.days.map(d => ({ day: d.day, state: d.state, records: d.records, counts: d.counts, applied: d.applied })),
    interactions: manifest.interactions.length, downstream,
    peer_paid_units: manifest.interactions.flatMap(e => e.stages).filter(s => s.paid && s.by === "peer").length,
    holds: manifest.holds.length,
  };
}

/**
 * Classify (always) and, in apply mode, project and drive downstream per changed interaction.
 * Resumable: a `projected` day is skipped, a `classified` day keeps its first counts and is
 * re-applied (unchanged records are semantic no-ops), and deferred interactions are re-driven.
 */
export async function runCallLogRepair(manifest: RepairManifest, seams: RepairSeams,
  options: { releaseHolds?: boolean; throughTranscription?: boolean } = {}): Promise<RepairSummary> {
  const now = seams.now ?? (() => new Date());
  const apply = seams.apply ?? applyInteractionObservation;
  const directoryFor = seams.directory ?? loadDirectoryLookup;
  if (manifest.mode === "apply" && !seams.stages) throw new Error("apply mode requires downstream stage runners");
  const downstream = manifest.mode === "apply" ? new Downstream(manifest, seams.stages!, seams, options.throughTranscription ?? false) : null;
  if (downstream && options.releaseHolds) {
    await downstream.releaseAllToProduction();
    await seams.save(manifest);
    return summarize(manifest);
  }
  const firstRequest = { done: false };
  let resolveRoute = seams.resolveRoute ?? null;
  const directories = new Map<string, DirectoryLookup>();

  for (const day of manifest.days) {
    if (day.state === "projected" || (manifest.mode === "dry_run" && day.state === "classified")) continue;
    const window = { from: new Date(day.from), to: new Date(day.to) };
    let records: CallLogRecordInput[];
    try {
      records = await fetchWindow(window, day, seams, firstRequest);
    } catch (error) {
      day.state = "failed";
      day.error = error instanceof Error ? error.message.slice(0, 160) : "fetch_failed";
      await seams.save(manifest);
      await seams.log("window_failed", { day: day.day, error: day.error });
      throw error;
    }
    records.sort((a, b) => startMs(a) - startMs(b));
    day.records = records.length;
    delete day.error;
    if (!records.length) {
      day.counts ??= { MISSING: 0, STALE: 0, unchanged: 0 };
      day.state = manifest.mode === "apply" ? "projected" : "classified";
      await seams.save(manifest);
      continue;
    }
    const accountId = resolveProviderAccountId(
      records.map(r => accountIdFromProviderPath(typeof r.uri === "string" ? r.uri : null)),
      seams.configuredAccountId === undefined ? configuredRingCentralAccountId() : seams.configuredAccountId,
    );
    if (!directories.has(accountId)) directories.set(accountId, await directoryFor(accountId));
    const directory = directories.get(accountId)!;

    // Classification happens before any write and is recorded once per day (first pass wins on resume).
    const classes = new Map<CallLogRecordInput, { kind: RepairClass; reasons: string[] }>();
    const counts: Counts = { MISSING: 0, STALE: 0, unchanged: 0 };
    for (const record of records) {
      const verdict = classifyAgainstStored(record, await loadStoredCanonical(accountId, record));
      classes.set(record, verdict);
      counts[verdict.kind]++;
      if (verdict.kind !== "unchanged") await seams.log("classified", { day: day.day, record_id: record.id ?? null,
        telephony_session_id: record.telephonySessionId ?? null, start: record.startTime ?? null, duration_s: record.duration ?? null,
        result: record.result ?? null, class: verdict.kind, reasons: verdict.reasons, recordings: recordRecordingIds(record).length });
    }
    day.counts ??= counts;
    day.state = day.state === "pending" ? "classified" : day.state;
    await seams.log("day_classified", { day: day.day, records: records.length, counts });
    await seams.save(manifest);
    if (!downstream) continue;

    resolveRoute ??= await defaultRouteResolver();
    day.applied = { created: 0, updated: 0, noop: 0, failed: 0, changed_without_diff: 0 };
    for (const record of records) {
      const verdict = classes.get(record)!;
      const recordId = typeof record.id === "string" ? record.id : null;
      let result: ApplyResult;
      try {
        result = await apply(accountId,
          { kind: "call_log", record, proof_ref: `call_log_repair:${recordId ?? "unknown"}`, source: "call_log_reconcile" },
          { now, directory, resolveRoute, request_id: manifest.run_id });
      } catch (error) {
        // One failing record never blocks the window (spec D5); it is listed for a targeted retry.
        day.applied.failed++;
        await seams.log("apply_failed", { day: day.day, record_id: recordId, class: verdict.kind,
          error_code: error instanceof InteractionPersistenceError ? error.code : error instanceof Error ? error.name : "unknown" });
        continue;
      }
      if (result.noop) { day.applied.noop++; continue; }
      if (result.created) day.applied.created++; else day.applied.updated++;
      // G4: provenance for the Owner timeline and the Case File; never bumps projection_revision.
      const recoveryKind = recoveryKindFor(verdict.kind, result.created);
      if (recoveryKind) await (seams.stampRecovery ?? stampCaptureRecovery)(result.interaction_id, { run_id: manifest.run_id, at: now(), kind: recoveryKind });
      if (verdict.kind === "unchanged") day.applied.changed_without_diff++;
      let entry = manifest.interactions.find(e => e.interaction_id === result.interaction_id);
      if (!entry) {
        entry = { interaction_id: result.interaction_id, day: day.day, record_id: recordId, classification: verdict.kind, created: result.created,
          contact_number_id: result.contact_number_id, job_keys: [], downstream: "pending", stages: [] };
        manifest.interactions.push(entry);
      }
      entry.contact_number_id = result.contact_number_id ?? entry.contact_number_id;
      entry.job_keys = [...new Set([...entry.job_keys, ...result.jobs])];
      await seams.log("applied", { day: day.day, record_id: recordId, class: verdict.kind, interaction_id: result.interaction_id,
        created: result.created, contact_number_created: result.contact_number_created, new_recordings: result.new_recording_ids.length, jobs: result.jobs });
      await seams.save(manifest);
      // Depth-first: the next stage is claimed by id the moment this one commits.
      await downstream.drive(entry);
      await seams.save(manifest);
    }
    day.state = "projected";
    await seams.log("day_projected", { day: day.day, applied: day.applied });
    await seams.save(manifest);
  }
  if (downstream) {
    // Interactions deferred earlier (this run or a previous one) are re-driven as their units fall due.
    // A full run (no `--through transcription`) also finishes interactions an earlier run stopped after transcription.
    const redrive = new Set<InteractionEntry["downstream"]>(options.throughTranscription ? ["pending", "deferred"] : ["pending", "deferred", "transcribed"]);
    for (const entry of manifest.interactions.filter(e => redrive.has(e.downstream))) {
      await downstream.drive(entry);
      await seams.save(manifest);
    }
    await downstream.settleDeferred(now().getTime() + (seams.maxWaitMs ?? 0));
    await seams.save(manifest);
  }
  const summary = summarize(manifest);
  await seams.log("summary", summary as unknown as Record<string, unknown>);
  return summary;
}
