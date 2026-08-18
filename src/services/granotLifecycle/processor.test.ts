import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  getGranotRecordLinkModel,
  type GranotRecordLinkDocument,
} from "../../models/GranotRecordLink";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionDocument,
} from "../../models/SynchronizationDecision";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { DecisionIntegrityError, ProcessingDisabledError } from "./errors";
import {
  getGranotLifecycleDecisionsTotal,
  resetGranotLifecycleMetrics,
} from "./metrics";
import type { LeadIdentityResult } from "./identity";
import type { LeadDesiredStateProjection } from "./leadDesiredState";
import { processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import type { SourcePolicyStore } from "./sourcePolicy";

const capturedAt = new Date("2026-08-17T15:00:00.000Z");
const decidedAt = new Date("2026-08-17T16:00:00.000Z");

function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function observation(
  overrides: Partial<GranotObservationDocument> = {},
): GranotObservationDocument {
  return {
    _id: objectId(),
    receipt_id: objectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "lead_created",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: "synthetic-job-100",
      normalized_job_no: "SYNTHETIC JOB 100",
    },
    contact: {},
    move: {},
    priority: { valid: true, canonical: "1" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  } as GranotObservationDocument;
}

function reviewedStore(): SourcePolicyStore {
  const companyId = String(objectId());
  const granularityId = String(objectId());
  const sourceId = String(objectId());
  return {
    async findByNormalizedLabel() {
      return [
        {
          id: sourceId,
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: companyId,
          lifecycle_routes: [
            {
              route_key: "call_any",
              lead_model: "CallLead",
              move_type: "any",
              source_granularity_id: granularityId,
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
          normalized_granot_label: "synthetic forms",
        },
      ];
    },
    async findCompany(id) {
      return { id, active: true };
    },
    async findGranularity(id) {
      return {
        id,
        source_company_id: companyId,
        active: true,
        channel: "call",
      };
    },
  };
}

function pendingIdentity(): LeadIdentityResult {
  return {
    outcome: "pending_match",
    reason_code: "pending_source_scoped_match",
    candidates: [],
  };
}

function memoryDeps(input: {
  observation: GranotObservationDocument;
  channel?: "granot_webhook" | "browser_extension";
  matchAttempt?: number;
  activation?: { activated_at: Date } | null;
  flags?: typeof GRANOT_LIFECYCLE_FLAG_DEFAULTS;
  store?: SourcePolicyStore;
  existingDecision?: SynchronizationDecisionDocument | null;
  existingLink?: GranotRecordLinkDocument | null;
  identity?: LeadIdentityResult;
  lead?: LeadDesiredStateProjection | null;
  winnerAdvanced?: boolean;
}): GranotLifecycleProcessorDeps & {
  decisions: SynchronizationDecisionDocument[];
  links: GranotRecordLinkDocument[];
  forbiddenEffects: string[];
  temporalAdvances: number;
  initiatorSeen: string[];
} {
  const decisions: SynchronizationDecisionDocument[] = [];
  const links: GranotRecordLinkDocument[] = [];
  const forbiddenEffects: string[] = [];
  const initiatorSeen: string[] = [];
  let activeLink = input.existingLink ?? null;
  const counters = { temporalAdvances: 0 };
  return {
    decisions,
    links,
    forbiddenEffects,
    get temporalAdvances() {
      return counters.temporalAdvances;
    },
    initiatorSeen,
    now: () => decidedAt,
    flags: input.flags ?? GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    sourcePolicyStore: input.store ?? reviewedStore(),
    loadReceipt: async () => ({
      _id: input.observation.receipt_id,
      observation_channel: input.channel ?? "granot_webhook",
      captured_at: capturedAt,
      processing: { match_attempt: input.matchAttempt ?? 0 },
    }),
    upsertObservation: async () => input.observation,
    loadActivation: async () => input.activation ?? null,
    findDecision: async () => input.existingDecision ?? null,
    findActiveLink: async () => activeLink,
    resolveIdentity: async () => input.identity ?? pendingIdentity(),
    loadLeadProjection: async () => input.lead ?? null,
    advanceTemporalWinner: async () => {
      counters.temporalAdvances += 1;
      return input.winnerAdvanced !== false;
    },
    persistDecisionOnly: async (decision) => {
      decisions.push(decision);
    },
    persistDecisionAndLink: async ({ decision, link, refresh }) => {
      decisions.push(decision);
      if (link) {
        links.push(link);
        activeLink = link;
      }
      if (refresh && activeLink) {
        activeLink = {
          ...activeLink,
          last_observation_id: refresh.last_observation_id,
          last_observed_at: refresh.last_observed_at,
          domain_revision: activeLink.domain_revision + 1,
        };
      }
      for (const effect of decision.effects) {
        if (
          effect.kind !== "record_link_established" &&
          effect.kind !== "record_link_confirmed"
        ) {
          forbiddenEffects.push(effect.kind);
        }
      }
    },
    withTransaction: async (fn) => fn({} as never),
  };
}

test("[AC-02] portion identical webhook evidence in two receipts creates two Decisions", async () => {
  resetGranotLifecycleMetrics();
  const first = observation();
  const second = observation({ receipt_id: objectId() });
  const a = memoryDeps({ observation: first });
  const b = memoryDeps({ observation: second });
  const firstResult = await processGranotObservation({ receipt_id: String(first.receipt_id) }, a);
  const secondResult = await processGranotObservation({ receipt_id: String(second.receipt_id) }, b);
  assert.notEqual(firstResult.decision_id, secondResult.decision_id);
  assert.notEqual(firstResult.observation_id, secondResult.observation_id);
  assert.equal(firstResult.outcome, "linked");
  assert.equal(a.decisions[0]?.attempt, 1);
  assert.equal(b.decisions[0]?.attempt, 1);
});

test("[AC-02] portion same observation/attempt replay returns one Decision", async () => {
  const row = observation();
  const first = memoryDeps({ observation: row });
  const created = await processGranotObservation({ receipt_id: String(row.receipt_id) }, first);
  const replay = memoryDeps({
    observation: row,
    existingDecision: first.decisions[0],
  });
  const again = await processGranotObservation({ receipt_id: String(row.receipt_id) }, replay);
  assert.equal(again.decision_id, created.decision_id);
  assert.equal(replay.decisions.length, 0);
});

test("[AC-02] portion a differing stored Decision is an integrity failure", async () => {
  const row = observation();
  const existing = {
    _id: objectId(),
    observation_id: row._id,
    attempt: 1,
    execution_mode: "live",
    outcome: "applied",
    reason_code: "lead_state_changed",
    candidates: [],
    evaluated_gates: [],
    effects: [],
    decided_at: decidedAt,
  } as SynchronizationDecisionDocument;
  await assert.rejects(
    () =>
      processGranotObservation(
        { receipt_id: String(row.receipt_id) },
        memoryDeps({ observation: row, existingDecision: existing }),
      ),
    DecisionIntegrityError,
  );
});

test("[AC-31] foundation pre-activation receipts stay historical and create no live effects", async () => {
  const row = observation();
  const deps = memoryDeps({ observation: row, activation: null });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.decisions[0]?.execution_mode, "historical_shadow");
  assert.equal(result.outcome, "linked");
  assert.equal(deps.decisions[0]?.effects[0]?.kind, "record_link_established");
  assert.deepEqual(deps.forbiddenEffects, []);
});

test("[AC-31] foundation live-shadow Decisions are not promoted and mutate no Record Link", async () => {
  const row = observation();
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: true },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.decisions[0]?.execution_mode, "live_shadow");
  assert.equal(result.outcome, "pending_match");
  assert.equal(deps.decisions[0]?.reason_code, "pending_source_scoped_match");
  assert.ok(deps.decisions[0]?.next_match_attempt_at);
  assert.equal(deps.links.length, 0);
  assert.deepEqual(deps.forbiddenEffects, []);
});

test("[AC-32] portion historical establishment, confirmation, and conflict keep one active link", async () => {
  const sharedStore = reviewedStore();
  const first = observation();
  const established = memoryDeps({ observation: first, store: sharedStore });
  await processGranotObservation({ receipt_id: String(first.receipt_id) }, established);
  assert.equal(established.links.length, 1);
  assert.equal(established.links[0]?.domain_revision, 0);
  assert.equal(established.links[0]?.lead_ref, undefined);

  const confirmObs = observation({ receipt_id: objectId() });
  const confirm = memoryDeps({
    observation: confirmObs,
    existingLink: established.links[0],
    store: sharedStore,
  });
  const confirmed = await processGranotObservation(
    { receipt_id: String(confirmObs.receipt_id) },
    confirm,
  );
  assert.equal(confirmed.outcome, "linked");
  assert.equal(confirm.decisions[0]?.reason_code, "record_link_confirmed");
  assert.equal(confirm.links.length, 0);

  const otherCompany = String(objectId());
  const otherGranularity = String(objectId());
  const conflictStore: SourcePolicyStore = {
    async findByNormalizedLabel() {
      return [
        {
          id: String(objectId()),
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: otherCompany,
          lifecycle_routes: [
            {
              route_key: "call_any",
              lead_model: "CallLead",
              move_type: "any",
              source_granularity_id: otherGranularity,
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
        },
      ];
    },
    async findCompany(id) {
      return { id, active: true };
    },
    async findGranularity(id) {
      return {
        id,
        source_company_id: otherCompany,
        active: true,
        channel: "call",
      };
    },
  };
  const conflictObs = observation({ receipt_id: objectId() });
  const conflict = memoryDeps({
    observation: conflictObs,
    existingLink: established.links[0],
    store: conflictStore,
  });
  const conflicted = await processGranotObservation(
    { receipt_id: String(conflictObs.receipt_id) },
    conflict,
  );
  assert.equal(conflicted.outcome, "conflict");
  assert.equal(conflict.decisions[0]?.reason_code, "record_link_conflict");
  assert.equal(conflict.decisions[0]?.effects.length, 0);
  assert.equal(established.links[0]?.disputed, false);
});

test("[AC-32] portion invalid, unsupported, and unclassified paths create no link or forbidden effects", async () => {
  const invalid = memoryDeps({
    observation: observation({
      normalization_result: "invalid",
      route_event_class: "priority_updated",
      issues: [{ code: "invalid_priority", severity: "error" }],
    }),
  });
  const invalidResult = await processGranotObservation(
    { receipt_id: String(objectId()) },
    invalid,
  );
  assert.equal(invalidResult.outcome, "invalid");
  assert.equal(invalid.decisions[0]?.reason_code, "invalid_priority_update");
  assert.equal(invalid.links.length, 0);

  const unsupported = memoryDeps({
    observation: observation({ normalization_result: "unsupported" }),
  });
  const unsupportedResult = await processGranotObservation(
    { receipt_id: String(objectId()) },
    unsupported,
  );
  assert.equal(unsupportedResult.outcome, "unsupported");
  assert.equal(unsupported.decisions[0]?.reason_code, "unsupported_booking_action");

  const unclassified = memoryDeps({
    observation: observation({ normalized_source_label: "unknown source" }),
    store: {
      async findByNormalizedLabel() {
        return [];
      },
      async findCompany() {
        return null;
      },
      async findGranularity() {
        return null;
      },
    },
  });
  const unclassifiedResult = await processGranotObservation(
    { receipt_id: String(objectId()) },
    unclassified,
  );
  assert.equal(unclassifiedResult.outcome, "policy_blocked");
  assert.equal(unclassified.decisions[0]?.reason_code, "source_unclassified");
  assert.equal(unclassified.links.length, 0);
});

test("processing disabled refuses unless a test supplies config", async () => {
  await assert.rejects(
    () =>
      processGranotObservation(
        { receipt_id: String(objectId()) },
        memoryDeps({
          observation: observation(),
          flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, processing_enabled: false },
        }),
      ),
    ProcessingDisabledError,
  );
});

test("[AC-31] foundation live configuration with no match stays pending and mutates no Lead", async () => {
  const row = observation();
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.decisions[0]?.execution_mode, "live");
  assert.equal(result.outcome, "pending_match");
  assert.equal(deps.decisions[0]?.reason_code, "pending_source_scoped_match");
  assert.equal(deps.links.length, 0);
});

test("[AC-32] portion replica-set Decision+link persist atomically and unique job races keep one active link", async (t) => {
  const session = await connectReplicaSetForTests();
  if (!session.ok) {
    t.skip(session.reason);
    return;
  }
  const Decision = getSynchronizationDecisionModel();
  const Link = getGranotRecordLinkModel();
  const observationId = objectId();
  const decisionId = objectId();
  const linkId = objectId();
  const job = `SYNTHETIC JOB ${Date.now().toString(36).toUpperCase()}`;
  try {
    await Decision.create({
      _id: decisionId,
      observation_id: observationId,
      attempt: 1,
      execution_mode: "historical_shadow",
      outcome: "linked",
      reason_code: "record_link_established",
      candidates: [],
      evaluated_gates: [],
      effects: [{ kind: "record_link_established", ref: { model: "GranotRecordLink", id: String(linkId) } }],
      decided_at: decidedAt,
    });
    await Link.create({
      _id: linkId,
      provider: "granot",
      normalized_job_no: job,
      job_no_snapshot: job,
      state: "active",
      disputed: false,
      established_by_decision_id: decisionId,
      established_at: decidedAt,
      last_observation_id: observationId,
      last_observed_at: decidedAt,
      domain_revision: 0,
    });
    await assert.rejects(
      () =>
        Link.create({
          provider: "granot",
          normalized_job_no: job,
          job_no_snapshot: job,
          state: "active",
          disputed: false,
          established_by_decision_id: objectId(),
          established_at: decidedAt,
          last_observation_id: objectId(),
          last_observed_at: decidedAt,
          domain_revision: 0,
        }),
      /duplicate|E11000/i,
    );
    assert.equal(await Link.countDocuments({ normalized_job_no: job, state: "active" }), 1);
    await assert.rejects(
      () =>
        Decision.create({
          observation_id: observationId,
          attempt: 1,
          execution_mode: "historical_shadow",
          outcome: "linked",
          reason_code: "record_link_confirmed",
          candidates: [],
          evaluated_gates: [],
          effects: [],
          decided_at: decidedAt,
        }),
      /duplicate|E11000/i,
    );
  } finally {
    await Decision.deleteMany({ observation_id: observationId });
    await Link.deleteMany({ normalized_job_no: job });
    await session.close();
  }
});

async function connectReplicaSetForTests(): Promise<
  { ok: true; close: () => Promise<void> } | { ok: false; reason: string }
> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    return {
      ok: false,
      reason: "Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.",
    };
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    return { ok: false, reason: "Replica-set proof requires TEST_MODE=true before process start." };
  }
  if (!process.env.MONGO_URI) {
    try {
      const { config } = await import("dotenv");
      config({ path: ".env" });
    } catch {
      return { ok: false, reason: "MONGO_URI is not set and .env could not be loaded." };
    }
  }
  if (!process.env.MONGO_URI) {
    return { ok: false, reason: "MONGO_URI is not set." };
  }
  try {
    await connectMongo();
    if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
      return { ok: false, reason: "Refusing replica-set proof against a non-test database." };
    }
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (!hello || hello.setName == null) {
      return { ok: false, reason: "Connected Mongo is not a replica set." };
    }
    return { ok: true, close: async () => undefined };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Mongo connection failed.",
    };
  }
}

function matchedFormIdentity(leadId: string): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "form_ref_no_exact",
    target: { model: "FormLead", id: leadId },
    target_eligibility: "full",
    candidates: [{ target: { model: "FormLead", id: leadId }, reason_codes: ["form_ref_no_exact"] }],
    agent_assertion: "empty",
  };
}

function currentLead(id: string, overrides: Partial<LeadDesiredStateProjection> = {}): LeadDesiredStateProjection {
  return {
    model: "FormLead",
    id,
    ingestion_origin: "wordpress_form",
    quoted: false,
    ...overrides,
  };
}

test("[AC-07] shadow matched Lead Created records one target and never claims a second Lead", async () => {
  const row = observation();
  const leadId = String(objectId());
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId),
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "policy_blocked");
  assert.equal(deps.decisions[0]?.reason_code, "shadow_effect_suppressed");
  assert.equal(deps.decisions[0]?.target?.id, leadId);
  assert.equal(deps.decisions[0]?.match_method, "form_ref_no_exact");
  assert.equal(deps.decisions[0]?.candidates[0]?.target.id, leadId);
  assert.equal(deps.links.length, 0);
  assert.equal(result.effects.length, 0);
});

test("[AC-08] foundation eligible create_if_missing stays suppressed with no reservation", async () => {
  const row = observation({
    contact: {
      first_name: "Ada",
      display_name: "Ada",
      normalized_phone: "5551234567",
    },
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
  });
  const createStore = reviewedStore();
  const original = createStore.findByNormalizedLabel;
  createStore.findByNormalizedLabel = async (label) => {
    const rows = await original(label);
    return rows.map((row) => ({ ...row, lead_created_policy: "create_if_missing" as const }));
  };
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    store: createStore,
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "policy_blocked");
  assert.equal(deps.decisions[0]?.reason_code, "shadow_effect_suppressed");
  assert.equal(deps.links.length, 0);
  assert.equal(result.effects.length, 0);
});

test("[AC-30] processor emits terminal unmatched at 24 hours", async () => {
  const row = observation();
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    matchAttempt: 8,
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: true,
    },
  });
  deps.now = () => new Date(capturedAt.getTime() + 24 * 60 * 60 * 1000);
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "unmatched");
  assert.equal(deps.decisions[0]?.reason_code, "match_window_expired");
  assert.equal(deps.decisions[0]?.next_match_attempt_at, undefined);
  assert.equal(deps.links.length, 0);
});

test("[AC-06] malformed Priority on Lead Created continues independent identity work", async () => {
  const row = observation({
    route_event_class: "lead_created",
    normalization_result: "valid_with_issues",
    issues: [{ code: "invalid_priority", severity: "error" }],
    priority: { valid: false },
  });
  const leadId = String(objectId());
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId, { granot_priority: "1", quoted: true }),
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.notEqual(result.outcome, "invalid");
  assert.equal(deps.decisions[0]?.target?.id, leadId);
  assert.equal(deps.links.length, 0);
});

test("[AC-32] shadow no-op already_current writes no Change, Sheet, or Record Link", async () => {
  const row = observation({ priority: { valid: true, canonical: "8" } });
  const leadId = String(objectId());
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId, {
      granot_priority: "8",
      quoted: false,
      normalized_job_no: "SYNTHETIC JOB 100",
      job_no: "synthetic-job-100",
    }),
  });
  const result = await processGranotObservation(
    {
      receipt_id: String(row.receipt_id),
      initiator: {
        actor_type: "system",
        actor_id: "granot-webhook",
        actor_label: "Granot Webhook",
        actor_role: "system",
        origin: "granot_lifecycle",
        request_id: String(row.receipt_id),
      },
    },
    deps,
  );
  assert.equal(result.outcome, "already_current");
  assert.equal(deps.decisions[0]?.reason_code, "desired_state_already_current");
  assert.equal(result.effects.length, 0);
  assert.equal(deps.links.length, 0);
  assert.equal(deps.temporalAdvances, 0);
  assert.ok(result.observation_id);
  assert.ok(result.decision_id);
});

test("[AC-32] live test posture advances metadata-only winner and does not emit Change", async () => {
  const row = observation({ priority: { valid: true, canonical: "8" } });
  const leadId = String(objectId());
  const older = String(objectId());
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId, {
      granot_priority: "8",
      quoted: false,
      normalized_job_no: "SYNTHETIC JOB 100",
      job_no: "synthetic-job-100",
      last_accepted_granot_observation: {
        observation_id: older,
        captured_at: new Date("2026-08-17T14:00:00.000Z"),
      },
    }),
    winnerAdvanced: true,
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "already_current");
  assert.equal(deps.temporalAdvances, 1);
  assert.equal(result.effects.length, 0);
  assert.equal(deps.decisions[0]?.effects.length, 0);
});

test("[AC-32] CAS loser re-evaluates as stale and never persists already_current", async () => {
  const row = observation({ priority: { valid: true, canonical: "8" } });
  const leadId = String(objectId());
  const newerWinner = {
    observation_id: String(objectId()),
    captured_at: new Date("2026-08-17T18:00:00.000Z"),
  };
  let loads = 0;
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    identity: matchedFormIdentity(leadId),
    winnerAdvanced: false,
  });
  deps.loadLeadProjection = async () => {
    loads += 1;
    return currentLead(leadId, {
      granot_priority: "8",
      quoted: false,
      normalized_job_no: "SYNTHETIC JOB 100",
      job_no: "synthetic-job-100",
      last_accepted_granot_observation:
        loads === 1
          ? {
              observation_id: String(objectId()),
              captured_at: new Date("2026-08-17T14:00:00.000Z"),
            }
          : newerWinner,
    });
  };
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "stale");
  assert.equal(deps.decisions[0]?.reason_code, "older_than_temporal_winner");
  assert.equal(deps.decisions[0]?.outcome, "stale");
});

test("gate snapshot uses real policy facts in stable eight-name order", async () => {
  const row = observation();
  const deps = memoryDeps({ observation: row });
  await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.deepEqual(
    deps.decisions[0]?.evaluated_gates.map((gate) => gate.gate),
    [
      "global_effect_flag",
      "post_activation_live_mode",
      "operational_enabled",
      "lifecycle_enabled",
      "disposition_permits_effect",
      "source_company_active",
      "source_granularity_active",
      "policy_permits_effect",
    ],
  );
  assert.equal(
    deps.decisions[0]?.evaluated_gates.find((gate) => gate.gate === "operational_enabled")?.allowed,
    true,
  );
});

test("[AC-35] portion Decision metrics use only bounded enum labels", async () => {
  resetGranotLifecycleMetrics();
  const row = observation();
  await processGranotObservation(
    { receipt_id: String(row.receipt_id) },
    memoryDeps({ observation: row }),
  );
  assert.equal(
    getGranotLifecycleDecisionsTotal({
      outcome: "linked",
      reason_code: "record_link_established",
      channel: "granot_webhook",
    }),
    1,
  );
});
