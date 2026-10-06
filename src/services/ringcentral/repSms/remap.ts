import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { logger } from "../../../logger";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import type { RepSmsDirection } from "../../../config/domain/ringcentralRepSms";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, type JobLease } from "../../salesIntelligence/jobs";
import { wakeOutreachContactChange, type ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import { repSmsCaptureEnabled } from "./gate";
import { mongoRepSmsEvidenceStore, type RepSmsEvidenceStore } from "./evidenceStore";
import { listReviewedRepMailboxes, type RepMailbox } from "./mailboxes";
import { loadMailboxIdentity } from "./mailboxSync";
import { identityForMessage, type MailboxIdentityAt, type MessageIdentity } from "./mapper";

/**
 * Outreach lifecycle repair C7: re-map rep SMS identity after an Accounts change.
 *
 * Rep SMS evidence stores its P07e identity (`identity_state`, `identity_reason`, `reviewed_rep_ref`) at
 * map time, and the evidence store only rewrites a row when the provider returns the message again with a
 * material change. A row mapped `shared_sender` (its sender was not one of the link's numbers) or
 * `owner_not_reviewed_sales_rep` therefore stayed frozen after the Owner fixed the link in Accounts.
 *
 * `commandAccountAgent` enqueues one `rep_sms_remap` job per connect, change or disconnect, in its own
 * transaction (`enqueueRepSmsRemap`). The job rebuilds the mailbox context exactly as the mailbox sync
 * does (the reviewed identity at each message's creation instant from the extension's links; sender
 * numbers from the current reviewed link), recomputes the identity of the mailbox's last 7 days of
 * evidence with the mapper's own `identityForMessage`, writes each difference with the evidence store's
 * revision CAS (`source_revision + 1`) and wakes the desk for `(row, r<revision>)`, so the contact
 * event is re-derived. A mailbox that is not a reviewed `sales_rep` mailbox now changes nothing:
 * prospective identity keeps the old rows. Gated by `controls.rep_sms_capture_enabled` (fail closed).
 */
export const REP_SMS_REMAP_STAGE = "rep_sms_remap" as const;
/** The evidence window a re-map rewrites (the FSync history, RINGCENTRAL-CAPTURE §5). */
export const REP_SMS_REMAP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Engineering bound on one mailbox's re-mapped rows (a busy mailbox sends ~300 a week). */
export const REP_SMS_REMAP_MAX_ROWS = 2_000;
const REMAP_LEASE_TTL_MS = 120_000;

export function repSmsRemapSubjectKey(account: string, extensionId: string): string {
  return `rep-sms-remap:${account}:${extensionId}`;
}

export function repSmsRemapDedupeKey(extensionId: string, commandId: string): string {
  return `rep-sms-remap:${extensionId}:${commandId}`;
}

function mailboxFromSubjectKey(subjectKey: string | null | undefined): { account: string; extension_id: string } | null {
  const match = subjectKey ? /^rep-sms-remap:([^:]+):([^:]+)$/.exec(subjectKey) : null;
  return match ? { account: match[1]!, extension_id: match[2]! } : null;
}

export type RepSmsRemapEnqueueDeps = {
  enabled?: () => Promise<boolean>;
  enqueue?: typeof enqueueCsiJob;
};

/**
 * In-transaction enqueue (the Accounts command). One job per command and extension; a replayed
 * command finds the same row. Returns null while rep SMS capture is off.
 */
export async function enqueueRepSmsRemap(
  input: { account: string; extension_id: string; command_id: string },
  session: ClientSession,
  now: Date,
  deps: RepSmsRemapEnqueueDeps = {},
): Promise<{ job_id: string } | null> {
  if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) return null;
  const row = await (deps.enqueue ?? enqueueCsiJob)(
    {
      dedupe_key: repSmsRemapDedupeKey(input.extension_id, input.command_id),
      stage: REP_SMS_REMAP_STAGE,
      subject_key: repSmsRemapSubjectKey(input.account, input.extension_id),
      input_revision: 1,
      input_refs: [],
      priority: 15,
    },
    session,
    now,
  );
  return { job_id: String(row._id) };
}

/** One stored evidence row as the re-map reads it. */
export type RemapEvidenceRow = {
  _id: string;
  source_revision: number;
  direction: RepSmsDirection;
  from_number: string | null;
  provider_created_at: Date;
  identity_state: MessageIdentity["identity_state"];
  identity_reason: string | null;
  reviewed_rep_ref: { agent_id: string; link_id: string } | null;
};

export type RepSmsRemapStore = {
  /** The mailbox's evidence created at or after `since`, at most `limit` rows. */
  listMailboxEvidence(account: string, extensionId: string, since: Date, limit: number): Promise<RemapEvidenceRow[]>;
  /** CAS on `source_revision`; false when another writer changed the row first. */
  update: RepSmsEvidenceStore["update"];
};

export function mongoRepSmsRemapStore(): RepSmsRemapStore {
  const evidence = mongoRepSmsEvidenceStore();
  return {
    async listMailboxEvidence(account, extensionId, since, limit) {
      // `sod_rsms_message_unique` prefix {provider_account_id, owning_extension_id}; the creation filter is
      // applied to the fetched rows of that one mailbox.
      const rows = (await getRingCentralRepSmsEvidenceModel()
        .find(
          { provider_account_id: account, owning_extension_id: extensionId, provider_created_at: { $gte: since } },
          { source_revision: 1, direction: 1, from_number: 1, provider_created_at: 1, identity_state: 1, identity_reason: 1, reviewed_rep_ref: 1 },
        )
        .limit(limit)
        .lean()) as unknown as Array<Omit<RemapEvidenceRow, "_id" | "reviewed_rep_ref"> & { _id: unknown; reviewed_rep_ref?: { agent_id?: unknown; link_id?: unknown } | null }>;
      return rows.map((row) => ({
        ...row,
        _id: String(row._id),
        identity_reason: row.identity_reason ?? null,
        from_number: row.from_number ?? null,
        reviewed_rep_ref: row.reviewed_rep_ref ? { agent_id: String(row.reviewed_rep_ref.agent_id), link_id: String(row.reviewed_rep_ref.link_id) } : null,
      }));
    },
    update: (id, expectedRevision, set) => evidence.update(id, expectedRevision, set),
  };
}

const sameIdentity = (row: RemapEvidenceRow, next: MessageIdentity) =>
  row.identity_state === next.identity_state &&
  (row.identity_reason ?? null) === next.identity_reason &&
  (row.reviewed_rep_ref?.agent_id ?? null) === (next.reviewed_rep_ref?.agent_id ?? null) &&
  (row.reviewed_rep_ref?.link_id ?? null) === (next.reviewed_rep_ref?.link_id ?? null);

export type RepSmsRemapSummary = {
  state: "remapped" | "not_reviewed";
  extension_id: string;
  scanned: number;
  changed: number;
  conflicts: number;
  woken: number;
  truncated: boolean;
};

export type RepSmsRemapDeps = {
  now: () => Date;
  mailboxes: (at: Date, account: string) => Promise<RepMailbox[]>;
  identity: (mailbox: RepMailbox) => Promise<MailboxIdentityAt>;
  store: RepSmsRemapStore;
  wake: (sources: ContactChangeSource[]) => Promise<unknown>;
};

/** Re-maps one mailbox's last 7 days. Idempotent: a replay finds nothing to change. */
export async function remapRepSmsMailbox(
  input: { account: string; extension_id: string },
  overrides: Partial<RepSmsRemapDeps> = {},
): Promise<RepSmsRemapSummary> {
  const deps: RepSmsRemapDeps = {
    now: () => new Date(),
    mailboxes: (at, account) => listReviewedRepMailboxes(at, account),
    identity: loadMailboxIdentity,
    store: overrides.store ?? mongoRepSmsRemapStore(),
    wake: (sources) => wakeOutreachContactChange(sources),
    ...overrides,
  };
  const now = deps.now();
  const summary: RepSmsRemapSummary = { state: "not_reviewed", extension_id: input.extension_id, scanned: 0, changed: 0, conflicts: 0, woken: 0, truncated: false };
  const mailbox = (await deps.mailboxes(now, input.account)).find((m) => m.extension_id === input.extension_id);
  if (!mailbox) return summary;
  summary.state = "remapped";
  const identityAt = await deps.identity(mailbox);
  const context = { sender_numbers: mailbox.sender_numbers, identityAt };
  const rows = await deps.store.listMailboxEvidence(input.account, input.extension_id, new Date(now.getTime() - REP_SMS_REMAP_LOOKBACK_MS), REP_SMS_REMAP_MAX_ROWS + 1);
  summary.truncated = rows.length > REP_SMS_REMAP_MAX_ROWS;
  const sources: ContactChangeSource[] = [];
  for (const row of rows.slice(0, REP_SMS_REMAP_MAX_ROWS)) {
    summary.scanned += 1;
    const next = identityForMessage({ direction: row.direction, from_number: row.from_number, created: row.provider_created_at }, context);
    if (sameIdentity(row, next)) continue;
    const revision = row.source_revision + 1;
    const ok = await deps.store.update(row._id, row.source_revision, { ...next, source_revision: revision });
    if (!ok) {
      // A concurrent mailbox sync rewrote the row with the same context; the next re-map or sync settles it.
      summary.conflicts += 1;
      continue;
    }
    summary.changed += 1;
    sources.push({ source_kind: "sms", source_id: row._id, source_revision: `r${revision}` });
  }
  if (sources.length) {
    summary.woken = sources.length;
    await deps.wake(sources);
  }
  logger.info({ msg: "sales_outreach.rep_sms_remap.completed", extensionId: input.extension_id, scanned: summary.scanned, changed: summary.changed, conflicts: summary.conflicts, truncated: summary.truncated });
  return summary;
}

export type RepSmsRemapJobOutcome =
  | { status: "not_claimable"; job_id: string | null }
  | { status: "completed"; job_id: string; state: string; summary: RepSmsRemapSummary | null }
  | { status: "retry"; job_id: string; next_attempt_at: Date }
  | { status: "lease_lost"; job_id: string };

export type RepSmsRemapJobDeps = {
  owner?: string;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  enabled?: () => Promise<boolean>;
  remap?: (input: { account: string; extension_id: string }) => Promise<RepSmsRemapSummary>;
};

export async function runRepSmsRemapJob(jobId: string | undefined, deps: RepSmsRemapJobDeps = {}): Promise<RepSmsRemapJobOutcome> {
  const owner = deps.owner ?? `rep-sms-remap-job:${randomBytes(8).toString("hex")}`;
  if (jobId !== undefined && !mongoose.Types.ObjectId.isValid(jobId)) return { status: "not_claimable", job_id: jobId };
  const row = await (deps.claim ?? claimCsiJob)(owner, jobId, REMAP_LEASE_TTL_MS, REP_SMS_REMAP_STAGE);
  if (!row) return { status: "not_claimable", job_id: jobId ?? null };
  const lease: JobLease = { job_id: String(row._id), owner, epoch: row.lease_epoch };
  const complete = async (state: string, summary: RepSmsRemapSummary | null): Promise<RepSmsRemapJobOutcome> => {
    await (deps.complete ?? completeCsiJob)(lease, async () => undefined, { result: { state, summary } });
    return { status: "completed", job_id: lease.job_id, state, summary };
  };
  try {
    const target = mailboxFromSubjectKey(row.subject_key);
    if (!target) return await complete("subject_invalid", null);
    if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) return await complete("capture_disabled", null);
    const summary = await (deps.remap ?? ((input) => remapRepSmsMailbox(input)))(target);
    return await complete(summary.state, summary);
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost", job_id: lease.job_id };
    logger.error({ msg: "sales_outreach.rep_sms_remap.job_failed", jobId: lease.job_id, errorName: error instanceof Error ? error.name : "Error" });
    try {
      const failed = await (deps.fail ?? failCsiJob)(lease, "transient", 0, { result: { state: "worker_error" } });
      return { status: "retry", job_id: lease.job_id, next_attempt_at: failed.next_attempt_at };
    } catch (failError) {
      if (failError instanceof CsiError && failError.code === "LEASE_LOST") return { status: "lease_lost", job_id: lease.job_id };
      throw failError;
    }
  }
}

/** Job-recovery drain (the queued wake-up may be lost). */
export async function drainRepSmsRemapJobs(
  max = 10,
  deps: RepSmsRemapJobDeps = {},
  options: { deadlineMs?: number; clock?: () => number } = {},
): Promise<{ claimed: number; completed: number; retried: number; lease_lost: number; deadline_reached: boolean }> {
  const summary = { claimed: 0, completed: 0, retried: 0, lease_lost: 0, deadline_reached: false };
  const clock = options.clock ?? (() => Date.now());
  const deadline = clock() + (options.deadlineMs ?? 15_000);
  for (let i = 0; i < max; i += 1) {
    if (clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    const outcome = await runRepSmsRemapJob(undefined, deps);
    if (outcome.status === "not_claimable") break;
    summary.claimed += 1;
    if (outcome.status === "completed") summary.completed += 1;
    else if (outcome.status === "retry") summary.retried += 1;
    else summary.lease_lost += 1;
  }
  return summary;
}
