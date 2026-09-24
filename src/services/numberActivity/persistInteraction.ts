import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getCallInteractionAliasModel } from "../../models/CallInteractionAlias";
import { getContactNumberModel } from "../../models/ContactNumber";
import { csiWorkerActor, CsiError } from "../salesIntelligence/auth";
import { enqueueCsiJob } from "../salesIntelligence/jobs";
import {
  appendCsiAudit,
  duplicateKey,
  type CsiTransactionContext,
} from "../salesIntelligence/transactions";
import {
  loadRingCentralRouteSnapshot,
  resolveRingCentralInboundRoute,
} from "../operationsRegistry";
import type { DirectoryLookup } from "./directory";
import {
  aliasesFor,
  fromCallLogRecord,
  fromWebhookParties,
  identityFromCallLogRecord,
  identityFromWebhookEvents,
  mergeProjections,
  settleStoredProjection,
  type CallLogRecordInput,
} from "./interactionProjection";
import { reverseDigits, toNationalTenDigit } from "./phone";
import { addObservedSearchTerm } from "./searchTerms";
import type {
  CallLogState,
  CaptureSource,
  InteractionIdentity,
  InteractionProjection,
  ProjectionOutcome,
  RouteResolver,
  WebhookPartyObservation,
} from "./types";

/**
 * Transactional persistence for one canonical Call Interaction observation.
 *
 * One Mongo transaction per observation carries: alias reservation (the
 * account-scoped unique identity fence), interaction insert or revision-CAS
 * update, merge-with-proof tombstones, Contact Number rollups, the CSI audit
 * invalidation row and durable downstream job intent. Either all of it
 * commits or none of it does. No provider or network call happens inside.
 *
 * Identical semantic input is detected before any write and returns
 * `noop: true` without a revision, audit row or job.
 */
export type ObservationInput =
  | { kind: "webhook"; events: WebhookPartyObservation[]; proof_ref: string }
  | {
      kind: "call_log";
      record: CallLogRecordInput;
      proof_ref: string;
      source?: CaptureSource;
    }
  | {
      /**
       * Settle a provisional row quiet past the horizon from its stored
       * projection (no provider record). A no-op for any other row.
       */
      kind: "settle_stored";
      identity: InteractionIdentity;
      proof_ref: string;
      source?: CaptureSource;
    };

export type PersistDependencies = {
  now: () => Date;
  directory: DirectoryLookup;
  resolveRoute?: RouteResolver;
  maxAttempts?: number;
  /**
   * Durable job / run id (24-hex) recorded as the audit actor `request_id` so
   * every audit row ties back to the work item that produced it. When absent
   * a fresh id is generated and flagged `request_id_generated` on the audit
   * row instead of masquerading as a job id.
   */
  request_id?: string | null;
  /**
   * Quiet minutes after which a Call Log record is final (CC-04); passed to
   * `fromCallLogRecord`. Default `DEFAULT_SETTLE_HORIZON_MINUTES` (240).
   */
  settleHorizonMinutes?: number;
};

export type ApplyResult = {
  interaction_id: string;
  contact_number_id: string | null;
  projection_revision: number;
  noop: boolean;
  created: boolean;
  newly_terminal: boolean;
  /** Provisional -> settled on this revision (CC-04). */
  newly_settled: boolean;
  /** The row's Call Log state after this observation (CC-04). */
  call_log_state: CallLogState | null;
  new_recording_ids: string[];
  fenced_party_events: number;
  stale_call_log: boolean;
  merged_interaction_ids: string[];
  jobs: string[];
  contact_number_created: boolean;
};

export class InteractionPersistenceError extends Error {
  constructor(
    readonly code:
      | "identity_missing"
      | "projection_failed"
      | "retry_exhausted"
      | "account_mismatch",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InteractionPersistenceError";
  }
}

const RETRYABLE = new Set(["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"]);

export async function defaultRouteResolver(): Promise<RouteResolver> {
  const snapshot = await loadRingCentralRouteSnapshot();
  return (companyE164, startedAt) =>
    companyE164
      ? resolveRingCentralInboundRoute(snapshot, companyE164, startedAt)?.route_id ?? null
      : null;
}

export async function applyInteractionObservation(
  accountId: string,
  input: ObservationInput,
  deps: PersistDependencies,
): Promise<ApplyResult> {
  const maxAttempts = deps.maxAttempts ?? 4;
  const resolveRoute = deps.resolveRoute ?? (await defaultRouteResolver());
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTransaction((session) =>
        applyOnce(accountId, input, { ...deps, resolveRoute }, session),
      );
    } catch (error) {
      lastError = error;
      if (isRetryable(error) && attempt < maxAttempts) {
        // Short jittered backoff so contending writers do not re-read the
        // same conflict in lockstep.
        await sleep(attempt * 5 + Math.floor(Math.random() * 20));
        continue;
      }
      if (error instanceof InteractionPersistenceError) throw error;
      if (isRetryable(error)) {
        throw new InteractionPersistenceError(
          "retry_exhausted",
          "Concurrent writers kept winning the interaction fence",
          error,
        );
      }
      throw error;
    }
  }
  throw new InteractionPersistenceError("retry_exhausted", "Unreachable", lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REQUEST_ID_PATTERN = /^[a-f\d]{24}$/i;

function isRetryable(error: unknown): boolean {
  if (duplicateKey(error)) return true;
  if (error instanceof CsiError && RETRYABLE.has(error.code)) return true;
  const label = (error as { errorLabels?: string[] } | null)?.errorLabels;
  return Array.isArray(label) && label.includes("TransientTransactionError");
}

type StoredInteraction = InteractionProjection & {
  _id: mongoose.Types.ObjectId;
  contact_number_id: mongoose.Types.ObjectId | null;
  projection_revision: number;
  merged_into_id: mongoose.Types.ObjectId | null;
  createdAt: Date;
};

async function applyOnce(
  accountId: string,
  input: ObservationInput,
  deps: PersistDependencies & { resolveRoute: RouteResolver },
  session: ClientSession,
): Promise<ApplyResult> {
  const now = deps.now();
  const identity =
    input.kind === "webhook"
      ? identityFromWebhookEvents(input.events)
      : input.kind === "settle_stored"
        ? input.identity
        : identityFromCallLogRecord(input.record);
  const aliases = aliasesFor(identity);
  if (!aliases.length) {
    throw new InteractionPersistenceError(
      "identity_missing",
      "Observation carries no provider session or Call Log identity",
    );
  }

  const Alias = getCallInteractionAliasModel();
  const Interaction = getCallInteractionModel();
  const aliasRows = await Alias.find({
    provider: "ringcentral",
    provider_account_id: accountId,
    $or: aliases.map((a) => ({ kind: a.kind, value: a.value })),
  })
    .session(session)
    .lean();
  const referenced = [...new Set(aliasRows.map((row) => String(row.interaction_id)))];
  const rows = referenced.length
    ? await resolveCanonicalRows(referenced, session)
    : [];

  // Same-session provider proof: this one record names every identity we found.
  const canonical = rows.length
    ? rows.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
    : null;
  // Retained identity tombstones deduplicate late provider replay without restoring content.
  if (canonical && "purged_at" in canonical && canonical.purged_at) return {
    interaction_id: String(canonical._id), contact_number_id: canonical.contact_number_id ? String(canonical.contact_number_id) : null,
    projection_revision: canonical.projection_revision, noop: true, created: false, newly_terminal: false,
    newly_settled: false, call_log_state: canonical.call_log_state ?? null, new_recording_ids: [], fenced_party_events: 0, stale_call_log: false, merged_interaction_ids: [], jobs: [], contact_number_created: false,
  };
  const others = rows.filter((row) => canonical && !row._id.equals(canonical._id));
  let existing: InteractionProjection | null = canonical ? toProjection(canonical) : null;
  for (const other of others) existing = mergeProjections(existing!, toProjection(other));

  let outcome: ProjectionOutcome;
  try {
    if (input.kind === "settle_stored" && !existing) {
      throw new TypeError("No stored interaction to settle");
    }
    outcome =
      input.kind === "webhook"
        ? fromWebhookParties(existing, input.events, deps.directory, accountId, {
            now,
            resolveRoute: deps.resolveRoute,
          })
        : input.kind === "settle_stored"
          ? settleStoredProjection(existing!, { now, settleHorizonMinutes: deps.settleHorizonMinutes })
          : fromCallLogRecord(existing, input.record, deps.directory, accountId, {
            now,
            resolveRoute: deps.resolveRoute,
            source: input.source,
            settleHorizonMinutes: deps.settleHorizonMinutes,
          });
  } catch (error) {
    throw new InteractionPersistenceError(
      "projection_failed",
      error instanceof Error ? error.message : "Projection failed",
      error,
    );
  }
  if (outcome.next.provider_account_id !== accountId) {
    throw new InteractionPersistenceError("account_mismatch", "Account changed during projection");
  }

  const knownAliases = new Set(aliasRows.map((row) => `${row.kind}:${row.value}`));
  const missingAliases = aliases.filter((a) => !knownAliases.has(`${a.kind}:${a.value}`));
  const interactionId = canonical?._id ?? new mongoose.Types.ObjectId();

  if (canonical && !outcome.changed && !others.length && !missingAliases.length) {
    return {
      interaction_id: String(canonical._id),
      contact_number_id: canonical.contact_number_id ? String(canonical.contact_number_id) : null,
      projection_revision: canonical.projection_revision,
      noop: true,
      created: false,
      newly_terminal: false,
      newly_settled: false,
      call_log_state: canonical.call_log_state ?? null,
      new_recording_ids: [],
      fenced_party_events: outcome.fenced_party_events,
      stale_call_log: outcome.stale_call_log,
      merged_interaction_ids: [],
      jobs: [],
      contact_number_created: false,
    };
  }

  const suppliedRequestId =
    deps.request_id && REQUEST_ID_PATTERN.test(deps.request_id) ? deps.request_id : null;
  const requestId = suppliedRequestId ?? String(new mongoose.Types.ObjectId());
  const context: CsiTransactionContext = {
    session,
    command_id: new mongoose.Types.ObjectId(),
    now,
    actor: csiWorkerActor(requestId),
  };
  // Every audit row carries the provider evidence that caused it and whether
  // the actor request id is a real job/run id or a generated placeholder.
  const provenance = {
    proof_ref: input.proof_ref,
    input_kind: input.kind,
    request_id_generated: suppliedRequestId === null,
  };

  // Contact Number first so the interaction can reference it.
  const number = await upsertContactNumber(
    outcome.next,
    canonical ? toProjection(canonical) : null,
    canonical?.contact_number_id ?? null,
    now,
    session,
  );
  for (const other of others) {
    if (other.contact_number_id) {
      await applyRollupDelta(other.contact_number_id, toProjection(other), null, now, session);
    }
  }

  const revision = canonical ? canonical.projection_revision + 1 : 1;
  const stored = {
    ...outcome.next,
    contact_number_id: number.id,
    last_observed_at: now,
  };
  if (canonical) {
    const result = await Interaction.updateOne(
      { _id: canonical._id, projection_revision: canonical.projection_revision },
      { $set: stored, $inc: { projection_revision: 1 } },
      { session, runValidators: true },
    );
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  } else {
    await Interaction.create(
      [
        {
          _id: interactionId,
          ...stored,
          merged_into_id: null,
          projection_revision: 1,
          first_observed_at: now,
        },
      ],
      { session },
    );
  }

  for (const other of others) {
    // Tombstone keeps `contact_number_id` for history, but its rollup
    // contribution was removed above. Any recount or rebuild must filter
    // `merged_into_id: null` or it will double count this row.
    const tombstone = await Interaction.updateOne(
      { _id: other._id, projection_revision: other.projection_revision, merged_into_id: null },
      { $set: { merged_into_id: interactionId }, $inc: { projection_revision: 1 } },
      { session },
    );
    if (tombstone.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    // Re-point aliases only. Each alias keeps the `proof_ref` that originally
    // proved it; the merge proof lives on the `interaction.merged` audit row.
    await Alias.updateMany(
      { interaction_id: other._id },
      { $set: { interaction_id: interactionId } },
      { session },
    );
    await appendCsiAudit(context, {
      subject_key: `interaction:${String(other._id)}`,
      event_kind: "interaction.merged",
      prior: summarize(toProjection(other), other.projection_revision, other.contact_number_id),
      current: { merged_into_id: String(interactionId), ...provenance },
      target_id: String(other._id),
      revision: other.projection_revision + 1,
      kind: "interaction",
    });
  }

  if (missingAliases.length) {
    await Alias.insertMany(
      missingAliases.map((alias) => ({
        provider: "ringcentral",
        provider_account_id: accountId,
        kind: alias.kind,
        value: alias.value,
        interaction_id: interactionId,
        proof_ref: input.proof_ref,
      })),
      { session },
    );
  }

  await appendCsiAudit(context, {
    subject_key: `interaction:${String(interactionId)}`,
    event_kind: canonical ? "interaction.updated" : "interaction.created",
    // The audit schema requires a JSON prior; creation records an explicit "no prior row".
    prior: canonical
      ? summarize(toProjection(canonical), canonical.projection_revision, canonical.contact_number_id)
      : { exists: false },
    current: {
      ...summarize(outcome.next, revision, number.id),
      ...provenance,
      // New identity evidence is a real change even when the projection body
      // is unchanged; name it so the row never reads as a phantom update.
      aliases_added: missingAliases.map((a) => `${a.kind}:${a.value}`),
      merged_interaction_ids: others.map((o) => String(o._id)),
    },
    target_id: String(interactionId),
    revision,
    kind: "interaction",
  });

  const captureSource = input.kind === "webhook" ? undefined : input.source;
  const jobs = await scheduleDownstream(
    outcome,
    existing,
    String(interactionId),
    number,
    revision,
    session,
    now,
    captureSource,
  );

  return {
    interaction_id: String(interactionId),
    contact_number_id: number.id ? String(number.id) : null,
    projection_revision: revision,
    noop: false,
    created: outcome.created,
    newly_terminal: outcome.newly_terminal,
    newly_settled: outcome.newly_settled,
    call_log_state: outcome.next.call_log_state,
    new_recording_ids: outcome.new_recording_ids,
    fenced_party_events: outcome.fenced_party_events,
    stale_call_log: outcome.stale_call_log,
    merged_interaction_ids: others.map((o) => String(o._id)),
    jobs,
    contact_number_created: number.created,
  };
}

async function resolveCanonicalRows(
  ids: string[],
  session: ClientSession,
): Promise<StoredInteraction[]> {
  const Interaction = getCallInteractionModel();
  const seen = new Set<string>();
  const out: StoredInteraction[] = [];
  let pending = ids;
  // Follow merge tombstones to their canonical row (bounded chain).
  for (let hop = 0; hop < 5 && pending.length; hop += 1) {
    const rows = (await Interaction.find({ _id: { $in: pending } })
      .session(session)
      .lean()) as unknown as StoredInteraction[];
    pending = [];
    for (const row of rows) {
      if (row.merged_into_id) {
        const target = String(row.merged_into_id);
        if (!seen.has(target)) pending.push(target);
        continue;
      }
      const id = String(row._id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(row);
      }
    }
  }
  return out;
}

type NumberRef = { id: mongoose.Types.ObjectId | null; created: boolean };

async function upsertContactNumber(
  next: InteractionProjection,
  prev: InteractionProjection | null,
  prevNumberId: mongoose.Types.ObjectId | null,
  now: Date,
  session: ClientSession,
): Promise<NumberRef> {
  const ContactNumber = getContactNumberModel();
  const e164 = next.external_e164;
  // A provisional row gets no Contact Number: the snapshot may still turn out to
  // be another direction, and the Number appears (counted once) when it settles.
  const eligible =
    e164 !== null &&
    next.external_endpoint_kind === "external" &&
    next.direction !== "Internal" &&
    next.call_log_state !== "provisional";
  if (!eligible) {
    if (prevNumberId && prev) await applyRollupDelta(prevNumberId, prev, null, now, session);
    return { id: null, created: false };
  }
  const existing = await ContactNumber.findOne({ e164 }).session(session);
  const externalName = next.parties.find((p) => p.role === "external")?.name_raw ?? null;
  if (!existing) {
    const created = await ContactNumber.create(
      [
        {
          revision: 1,
          e164,
          national_ten: toNationalTenDigit(e164),
          digits_reversed: reverseDigits(e164),
          country: "US",
          kind: "external",
          classification: "unknown",
          contact_eligibility: { state: "allowed" },
          provider_names: externalName ? [externalName] : [],
          search_terms: externalName ? [externalName.toLowerCase()] : [],
          first_observed_at: next.started_at,
          last_activity_at: next.started_at,
          rollups: rollupsFor(next),
        },
      ],
      { session },
    );
    const id = created[0]!._id;
    if (prevNumberId && prev && !prevNumberId.equals(id)) {
      await applyRollupDelta(prevNumberId, prev, null, now, session);
    }
    return { id, created: true };
  }
  if (prevNumberId && !prevNumberId.equals(existing._id) && prev) {
    await applyRollupDelta(prevNumberId, prev, null, now, session);
    await applyRollupDelta(existing._id, null, next, now, session, externalName);
  } else {
    await applyRollupDelta(existing._id, prevNumberId ? prev : null, next, now, session, externalName);
  }
  return { id: existing._id, created: false };
}

function rollupsFor(projection: InteractionProjection) {
  return {
    interactions_total: 1,
    inbound_total: projection.direction === "Inbound" ? 1 : 0,
    outbound_total: projection.direction === "Outbound" ? 1 : 0,
    human_conversations_total: 0,
    last_inbound_at: projection.direction === "Inbound" ? projection.started_at : null,
    last_outbound_at: projection.direction === "Outbound" ? projection.started_at : null,
    last_human_conversation_at: null,
    last_meaningful_contact_at: null,
    attached_lead_count: 0,
    candidate_lead_count: 0,
    open_outreach_count: 0,
    recordings_total: projection.recordings.length,
    // Owned by analysis apply and Outreach ensure (Number rollups Service doc); a new Number has neither yet.
    conversations_analyzed_total: 0,
    last_analyzed_at: null,
    outreach_records_total: 0,
  };
}

/** The rollup fields capture owns incrementally (data spec §8). */
export type CaptureRollups = {
  interactions_total: number;
  inbound_total: number;
  outbound_total: number;
  recordings_total: number;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
};

/**
 * Pure delta: removes `prev`'s contribution and adds `next`'s. A null `prev` is a new
 * canonical interaction on this Number; a null `next` is one leaving it (merged away,
 * re-pointed or no longer eligible). Counts never go below zero: a Number written before
 * `recordings_total` existed reads 0 until the rebuild sweep, and must not go negative
 * when an older interaction leaves it.
 */
export function captureRollupDelta(
  current: Partial<CaptureRollups> | null | undefined,
  prev: Pick<InteractionProjection, "direction" | "recordings"> | null,
  next: Pick<InteractionProjection, "direction" | "recordings" | "started_at"> | null,
): CaptureRollups {
  const count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const dir = (row: typeof prev, direction: string) => (row?.direction === direction ? 1 : 0);
  const out: CaptureRollups = {
    interactions_total: Math.max(0, count(current?.interactions_total) - (prev ? 1 : 0) + (next ? 1 : 0)),
    inbound_total: Math.max(0, count(current?.inbound_total) - dir(prev, "Inbound") + dir(next, "Inbound")),
    outbound_total: Math.max(0, count(current?.outbound_total) - dir(prev, "Outbound") + dir(next, "Outbound")),
    recordings_total: Math.max(0, count(current?.recordings_total) - (prev?.recordings.length ?? 0) + (next?.recordings.length ?? 0)),
    last_inbound_at: current?.last_inbound_at ?? null,
    last_outbound_at: current?.last_outbound_at ?? null,
  };
  if (next?.direction === "Inbound") out.last_inbound_at = laterOf(out.last_inbound_at, next.started_at);
  if (next?.direction === "Outbound") out.last_outbound_at = laterOf(out.last_outbound_at, next.started_at);
  return out;
}

/** Applies the difference between `prev` and `next` for one number under revision CAS. */
async function applyRollupDelta(
  numberId: mongoose.Types.ObjectId,
  prev: InteractionProjection | null,
  next: InteractionProjection | null,
  now: Date,
  session: ClientSession,
  providerName: string | null = null,
) {
  const ContactNumber = getContactNumberModel();
  const row = await ContactNumber.findById(numberId).session(session).lean();
  if (!row) {
    // Not a race: the referenced Contact Number row does not exist. Fail
    // without burning the retry budget on a conflict that cannot resolve.
    throw new InteractionPersistenceError(
      "projection_failed",
      "Interaction references a Contact Number row that does not exist",
    );
  }
  const rollups = captureRollupDelta(row.rollups, prev, next);
  const providerNames = [...row.provider_names];
  if (providerName && !providerNames.includes(providerName)) {
    providerNames.push(providerName);
    while (providerNames.length > 10) providerNames.shift();
  }
  // Bounded display cache (02 §17); the rebuild paths own the full term set,
  // so capture only ever adds and never evicts a lead-derived term (14 §6).
  const searchTerms = addObservedSearchTerm(row.search_terms, providerName);
  const result = await ContactNumber.updateOne(
    { _id: numberId, revision: row.revision },
    {
      // Dotted paths for the capture-owned rollups only, never the whole `rollups`
      // object. `conversations_analyzed_total`, `last_analyzed_at` and
      // `outreach_records_total` are `$inc`/`$max`-ed by analysis apply and
      // Outreach ensure without a revision bump, so replacing the object from
      // this read would be a read-modify-write of fields capture does not own.
      // Two guarantees keep those increments: (1) this write never names them;
      // (2) every rollup writer runs in a transaction, and a transaction that
      // writes this document after another write to it committed since its
      // snapshot aborts with a WriteConflict and is retried from a fresh read.
      // The revision CAS still fences the read-modify-write writers (capture,
      // rebuild) against each other. See "Number rollups" in the capture doc.
      $set: {
        "rollups.interactions_total": rollups.interactions_total,
        "rollups.inbound_total": rollups.inbound_total,
        "rollups.outbound_total": rollups.outbound_total,
        "rollups.recordings_total": rollups.recordings_total,
        "rollups.last_inbound_at": rollups.last_inbound_at,
        "rollups.last_outbound_at": rollups.last_outbound_at,
        provider_names: providerNames,
        search_terms: searchTerms,
        last_activity_at: laterOf(row.last_activity_at, next?.started_at ?? null) ?? row.last_activity_at,
        // Only ever lowered: a backfill that processes a later call first
        // must not pin a late date (LP-06, spec §14.2). The rebuild restores
        // the exact earliest canonical interaction when evidence moves away.
        first_observed_at: earlierOf(row.first_observed_at, next?.started_at ?? null) ?? row.first_observed_at,
      },
      $inc: { revision: 1 },
    },
    { session, runValidators: true },
  );
  if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
}

export function earlierOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

function laterOf(a: Date | null | undefined, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Durable downstream intent, in the same transaction as the projection.
 * Keys carry the interaction revision (operational work) or the recording id
 * (discovery), so replays dedupe and delayed recording evidence still
 * schedules discovery after the call became terminal.
 */
async function scheduleDownstream(
  outcome: ProjectionOutcome,
  existing: InteractionProjection | null,
  interactionId: string,
  number: NumberRef,
  revision: number,
  session: ClientSession,
  now: Date,
  captureSource?: CaptureSource,
): Promise<string[]> {
  // R2: a mid-call snapshot drives no downstream work until it settles (CC-04).
  if (outcome.next.call_log_state === "provisional") return [];
  if (captureSource === "backfill") {
    if (!number.id) return [];
    const key = `csi:backfill:attachment:number:${String(number.id)}:interaction:${interactionId}`;
    await enqueueCsiJob({ dedupe_key: key, stage: "attachment_refresh", subject_key: `number:${String(number.id)}`,
      input_revision: 1, input_refs: [interactionId], priority: -100 }, session, now);
    return [key];
  }
  const jobs: string[] = [];
  const next = outcome.next;
  const internal = next.direction === "Internal" || next.external_endpoint_kind === "company_did" || next.external_endpoint_kind === "extension";
  // The first settled revision of a provisional row is its first final
  // observation: downstream treats it like a creation (CC-04).
  const firstFinal = outcome.newly_terminal || outcome.newly_settled;
  const material =
    outcome.created ||
    firstFinal ||
    (existing?.provider_connected ?? false) !== next.provider_connected ||
    existing?.contact_type !== next.contact_type ||
    existing?.direction !== next.direction ||
    existing?.external_e164 !== next.external_e164 ||
    existing?.provider_result !== next.provider_result;

  if (number.id && material) {
    const key = `csi:outreach_ensure:interaction:${interactionId}:${revision}`;
    await enqueueCsiJob(
      {
        dedupe_key: key,
        stage: "outreach_ensure",
        subject_key: `number:${String(number.id)}`,
        input_revision: revision,
        input_refs: [interactionId],
      },
      session,
      now,
    );
    jobs.push(key);
  }
  if (number.created && number.id) {
    const key = `csi:attachment_refresh:number:${String(number.id)}:1`;
    await enqueueCsiJob(
      {
        dedupe_key: key,
        stage: "attachment_refresh",
        subject_key: `number:${String(number.id)}`,
        input_revision: 1,
        input_refs: [interactionId],
      },
      session,
      now,
    );
    jobs.push(key);
  }
  if (next.terminal && !internal) {
    const recordingIds = firstFinal
      ? next.recordings.map((r) => r.provider_recording_id)
      : outcome.new_recording_ids;
    for (const recordingId of recordingIds) {
      const key = `csi:recording_discovery:interaction:${interactionId}:recording:${recordingId}`;
      await enqueueCsiJob(
        {
          dedupe_key: key,
          stage: "recording_discovery",
          subject_key: `interaction:${interactionId}`,
          input_revision: 1,
          input_refs: [interactionId],
        },
        session,
        now,
      );
      jobs.push(key);
    }
    if (firstFinal && next.recordings.length === 0) {
      // Pending discovery: not proof that no recording will ever exist.
      const key = `csi:recording_discovery:interaction:${interactionId}:pending`;
      await enqueueCsiJob(
        {
          dedupe_key: key,
          stage: "recording_discovery",
          subject_key: `interaction:${interactionId}`,
          input_revision: 1,
          input_refs: [interactionId],
        },
        session,
        now,
      );
      jobs.push(key);
    }
  }
  return jobs;
}

function summarize(
  projection: InteractionProjection,
  revision: number,
  contactNumberId: mongoose.Types.ObjectId | null,
) {
  return {
    projection_revision: revision,
    contact_number_id: contactNumberId ? String(contactNumberId) : null,
    direction: projection.direction,
    external_e164: projection.external_e164,
    external_endpoint_kind: projection.external_endpoint_kind,
    terminal: projection.terminal,
    call_log_state: projection.call_log_state,
    provider_result: projection.provider_result,
    provider_connected: projection.provider_connected,
    contact_type: projection.contact_type,
    recordings: projection.recordings.length,
    started_at: projection.started_at.toISOString(),
    sources: projection.sources,
  };
}

/** Converts a stored row (lean) into the plain projection shape used by pure code. */
export function toProjection(row: StoredInteraction | Record<string, unknown>): InteractionProjection {
  const r = row as unknown as StoredInteraction;
  return {
    provider: "ringcentral",
    provider_account_id: r.provider_account_id,
    telephony_session_id: r.telephony_session_id ?? null,
    session_id: r.session_id ?? null,
    call_log_ids: [...(r.call_log_ids ?? [])],
    identity_basis: r.identity_basis,
    direction: r.direction,
    external_e164: r.external_e164 ?? null,
    external_endpoint_kind: r.external_endpoint_kind ?? null,
    company_e164: r.company_e164 ?? null,
    inbound_route_id: r.inbound_route_id ? String(r.inbound_route_id) : null,
    started_at: r.started_at,
    answered_at: r.answered_at ?? null,
    ended_at: r.ended_at ?? null,
    duration_seconds: r.duration_seconds ?? null,
    provider_result: r.provider_result ?? null,
    provider_connected: Boolean(r.provider_connected),
    contact_type: r.contact_type,
    contact_type_basis: r.contact_type_basis ?? null,
    parties: (r.parties ?? []).map((p) => ({
      party_id: p.party_id ?? null,
      last_webhook_sequence: p.last_webhook_sequence ?? null,
      last_event_at: p.last_event_at ?? null,
      role: p.role,
      direction: p.direction ?? null,
      extension_id: p.extension_id ?? null,
      extension_number: p.extension_number ?? null,
      phone_number_raw: p.phone_number_raw ?? null,
      e164: p.e164 ?? null,
      name_raw: p.name_raw ?? null,
      connected: Boolean(p.connected),
      answered_at: p.answered_at ?? null,
      terminal_at: p.terminal_at ?? null,
      terminal_status: p.terminal_status ?? null,
    })),
    legs: (r.legs ?? []).map((l) => ({
      call_log_id: l.call_log_id ?? null,
      leg_type: l.leg_type ?? null,
      direction: l.direction ?? null,
      result: l.result ?? null,
      start_time: l.start_time ?? null,
      duration_seconds: l.duration_seconds ?? null,
      extension_id: l.extension_id ?? null,
      transfer_target_session_id: l.transfer_target_session_id ?? null,
      recording_id: l.recording_id ?? null,
    })),
    legs_overflow_count: r.legs_overflow_count ?? 0,
    connected_user_extension_ids: [...(r.connected_user_extension_ids ?? [])],
    queue_fanout: Boolean(r.queue_fanout),
    transfer: Boolean(r.transfer),
    monitoring: Boolean(r.monitoring),
    recordings: (r.recordings ?? []).map((rec) => ({
      provider_recording_id: rec.provider_recording_id,
      recording_type: rec.recording_type ?? null,
      observed_at: rec.observed_at,
      lead_conversation_id: rec.lead_conversation_id ? String(rec.lead_conversation_id) : null,
    })),
    sources: [...(r.sources ?? [])] as CaptureSource[],
    provider_last_modified_at: r.provider_last_modified_at ?? null,
    terminal: Boolean(r.terminal),
    max_observed_webhook_sequence: r.max_observed_webhook_sequence ?? null,
    call_log_state: r.call_log_state ?? null,
  };
}
