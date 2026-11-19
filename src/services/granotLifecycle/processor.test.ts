import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  type GranotRecordLinkDocument,
} from "../../models/GranotRecordLink";
import {
  type SynchronizationDecisionDocument,
} from "../../models/SynchronizationDecision";
import type { LeadIdentityResult } from "./identity";
import type { LeadDesiredStateProjection } from "./leadDesiredState";
import {
  createLeadFromGranotIdempotencyKey,
  createLeadFromGranotPayloadChecksum,
  type CreateLeadFromGranotInput,
} from "./createLeadFromGranot";
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

function liveCreationFlags(): typeof GRANOT_LIFECYCLE_FLAG_DEFAULTS {
  return {
    ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    shadow_mode: false,
    lead_writes_enabled: true,
    lead_creation_enabled: true,
  };
}

function formCreateStore(): SourcePolicyStore & {
  companyId: string;
  localGranularityId: string;
  longGranularityId: string;
  sourceId: string;
} {
  const companyId = String(objectId());
  const localGranularityId = String(objectId());
  const longGranularityId = String(objectId());
  const sourceId = String(objectId());
  return {
    companyId,
    localGranularityId,
    longGranularityId,
    sourceId,
    async findByNormalizedLabel() {
      return [
        {
          id: sourceId,
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "create_if_missing",
          lead_source_company: companyId,
          lifecycle_routes: [
            {
              route_key: "form_local",
              lead_model: "FormLead",
              move_type: "local",
              source_granularity_id: localGranularityId,
            },
            {
              route_key: "form_long",
              lead_model: "FormLead",
              move_type: "long_distance",
              source_granularity_id: longGranularityId,
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
        channel: "form",
        local: id === longGranularityId ? "long_distance" : "local",
      };
    },
  };
}

function callCreateStore(): SourcePolicyStore {
  const base = reviewedStore();
  return {
    ...base,
    async findByNormalizedLabel(label) {
      const rows = await base.findByNormalizedLabel(label);
      return rows.map((row) => ({
        ...row,
        lead_created_policy: "create_if_missing" as const,
      }));
    },
  };
}

function completeFormObservation(
  overrides: Partial<GranotObservationDocument> = {},
): GranotObservationDocument {
  return observation({
    contact: {
      first_name: "Ada",
      display_name: "Ada",
      phone_raw: "5551234567",
      normalized_phone: "5551234567",
    },
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
    ...overrides,
  });
}

function appliedCreateResult(
  model: "FormLead" | "CallLead" = "FormLead",
): Awaited<ReturnType<NonNullable<GranotLifecycleProcessorDeps["createLead"]>>> {
  return {
    status: "applied",
    entity_refs: [
      { model, id: String(objectId()) },
      { model: "GranotRecordLink", id: String(objectId()) },
    ],
    warnings: [],
  };
}

function assertNoPatchCreateCommand(input: CreateLeadFromGranotInput): void {
  assert.deepEqual(Object.keys(input).sort(), [
    "context",
    "lead_model",
    "observation_id",
    "source_scope",
  ]);
  assert.equal("data" in input, false);
  assert.equal("desired_state" in input, false);
  assert.deepEqual(Object.keys(input.source_scope).sort(), [
    "lead_source_company",
    "source_granularity_id",
  ]);
  assert.equal("ingestion_origin" in input, false);
  assert.equal("post_to_granot" in input, false);
  const record = input as CreateLeadFromGranotInput & Record<string, unknown>;
  assert.equal(record.patch, undefined);
  assert.equal(record.job_no, undefined);
  assert.equal(record.contact, undefined);
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
  synchronizeLead?: GranotLifecycleProcessorDeps["synchronizeLead"];
  createLead?: GranotLifecycleProcessorDeps["createLead"];
  reconcileBooking?: GranotLifecycleProcessorDeps["reconcileBooking"];
  reconcileRelease?: GranotLifecycleProcessorDeps["reconcileRelease"];
  reconcileDiscrepancy?: GranotLifecycleProcessorDeps["reconcileDiscrepancy"];
}): GranotLifecycleProcessorDeps & {
  decisions: SynchronizationDecisionDocument[];
  links: GranotRecordLinkDocument[];
  forbiddenEffects: string[];
  temporalAdvances: number;
  initiatorSeen: string[];
  synchronizeCalls: number;
  createLeadCalls: number;
  createLeadInputs: CreateLeadFromGranotInput[];
} {
  const decisions: SynchronizationDecisionDocument[] = [];
  const links: GranotRecordLinkDocument[] = [];
  const forbiddenEffects: string[] = [];
  const initiatorSeen: string[] = [];
  const synchronizeCalls = { count: 0 };
  const createLeadCalls = { count: 0 };
  const createLeadInputs: CreateLeadFromGranotInput[] = [];
  let activeLink = input.existingLink ?? null;
  const counters = { temporalAdvances: 0 };
  return {
    decisions,
    links,
    forbiddenEffects,
    get temporalAdvances() {
      return counters.temporalAdvances;
    },
    get synchronizeCalls() {
      return synchronizeCalls.count;
    },
    get createLeadCalls() {
      return createLeadCalls.count;
    },
    createLeadInputs,
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
    synchronizeLead: input.synchronizeLead
      ? async (payload) => {
          synchronizeCalls.count += 1;
          return input.synchronizeLead!(payload);
        }
      : undefined,
    createLead: input.createLead
      ? async (payload) => {
          createLeadCalls.count += 1;
          createLeadInputs.push(payload);
          return input.createLead!(payload);
        }
      : undefined,
    reconcileBooking: input.reconcileBooking,
    reconcileRelease: input.reconcileRelease,
    reconcileDiscrepancy: input.reconcileDiscrepancy,
    withTransaction: async (fn) => fn({} as never),
  };
}

test("[AC-18] Priority 5 with booking cases enabled still applies lead desired-state", async () => {
  const row = observation({
    kind: "lead_snapshot",
    route_event_class: "priority_updated",
    priority: { raw: "5", valid: true, canonical: "5" },
    booking_action: {},
  });
  const leadId = String(objectId());
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
      booking_cases_enabled: true,
    },
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId, {
      granot_priority: "8",
      quoted: false,
      normalized_job_no: "SYNTHETIC JOB 100",
      job_no: "synthetic-job-100",
    }),
    reconcileBooking: async () => {
      throw new Error("Priority 5 must not invoke Booking reconciliation");
    },
    synchronizeLead: async (input) => {
      assert.equal(input.lead_ref.id, leadId);
      assert.equal(input.desired_state.set.granot_priority, "5");
      return { status: "applied", entity_refs: [input.lead_ref], warnings: [] };
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.synchronizeCalls, 1);
  assert.equal(result.outcome, "applied");
  assert.ok(result.effects.every((effect) => effect.kind !== "booking_case_opened"));
});

test("[AC-18][AC-19] processor invokes Booking reconciliation only in live gate-enabled posture", async () => {
  const row = observation({
    kind: "booking_action_snapshot",
    route_event_class: "booking_status_changed",
    normalization_result: "valid_with_issues",
    priority: { raw: "bad", valid: false },
    booking_action: { raw: "Booked", normalized: "booked" },
  });
  let calls = 0;
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      booking_cases_enabled: true,
    },
    reconcileBooking: async (ids, prepared) => {
      calls += 1;
      assert.equal(ids.observation_id, String(row._id));
      assert.equal(prepared.execution_mode, "live");
      assert.equal(prepared.evaluated_gates.length, 8);
      assert.ok(prepared.evaluated_gates.every((gate) => gate.allowed));
      return {
        kind: "opened",
        case_ref: { model: "GranotBookingReconciliationCase", id: String(objectId()) },
        outcome: "linked",
        reason_code: "booking_case_opened",
      };
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(calls, 1);
  assert.equal(result.outcome, "linked");
  assert.equal(result.effects[0]?.kind, "booking_case_opened");

  const disabled = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false },
    reconcileBooking: async () => {
      throw new Error("disabled Booking gate must not invoke reconciliation");
    },
  });
  await processGranotObservation({ receipt_id: String(row.receipt_id) }, disabled);
});

test("[AC-25][AC-26][AC-27][AC-P5] processor invokes Booking reconciliation for live gate-enabled Release evidence", async () => {
  const row = observation({
    kind: "booking_action_snapshot",
    route_event_class: "booking_status_changed",
    normalization_result: "valid_with_issues",
    priority: { raw: "bad", valid: false },
    booking_action: { raw: "Release", normalized: "release" },
  });
  let bookingCalls = 0;
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      booking_cases_enabled: true,
    },
    reconcileBooking: async (ids, prepared) => {
      bookingCalls += 1;
      assert.equal(ids.observation_id, String(row._id));
      assert.equal(prepared.execution_mode, "live");
      assert.equal(prepared.evaluated_gates.length, 8);
      assert.ok(prepared.evaluated_gates.every((gate) => gate.allowed));
      return {
        kind: "opened",
        case_ref: { model: "GranotBookingReconciliationCase", id: String(objectId()) },
        outcome: "linked",
        reason_code: "booking_case_opened",
      };
    },
    reconcileRelease: async () => {
      throw new Error("Release owner path must not invoke reconcileRelease");
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(bookingCalls, 1);
  assert.equal(result.outcome, "linked");
  assert.equal(result.effects[0]?.kind, "booking_case_opened");
  assert.ok(
    result.effects.every((effect) =>
      effect.kind !== "release_case_opened" && effect.kind !== "release_case_refreshed",
    ),
  );

  const disabled = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false },
    reconcileBooking: async () => {
      throw new Error("disabled Booking gate must not invoke reconciliation");
    },
    reconcileRelease: async () => {
      throw new Error("Release owner path must not invoke reconcileRelease");
    },
  });
  await processGranotObservation({ receipt_id: String(row.receipt_id) }, disabled);
});

test("[AC-26][AC-27][AC-36][AC-R6] processor persists Release identity conflict through the discrepancy module", async () => {
  const row = observation({
    kind: "booking_action_snapshot",
    route_event_class: "booking_status_changed",
    booking_action: { raw: "Release", normalized: "release" },
  });
  let discrepancyCalls = 0;
  let bookingCalls = 0;
  const result = await processGranotObservation(
    { receipt_id: String(row.receipt_id) },
    memoryDeps({
      observation: row,
      activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
      flags: {
        ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
        shadow_mode: false,
        booking_cases_enabled: true,
      },
      reconcileBooking: async () => {
        bookingCalls += 1;
        return {
          kind: "booking_discrepancy_required",
          reason_code: "release_record_link_conflict",
        };
      },
      reconcileRelease: async () => {
        throw new Error("Release identity conflict must not invoke reconcileRelease");
      },
      reconcileDiscrepancy: async (request, prepared) => {
        discrepancyCalls += 1;
        assert.equal(request.discrepancy_kind, "release");
        assert.equal(request.reason_code, "release_record_link_conflict");
        assert.notEqual(request.reason_code, "release_without_vantage_booking");
        assert.equal(prepared.execution_mode, "live");
        return {
          kind: "opened",
          discrepancy_ref: {
            model: "GranotReleaseDiscrepancy",
            id: String(objectId()),
          },
          reason_code: "release_discrepancy_opened",
          revision: 1,
          evidence_revision: 1,
        };
      },
    }),
  );
  assert.equal(bookingCalls, 1);
  assert.equal(discrepancyCalls, 1);
  assert.equal(result.outcome, "conflict");
  assert.equal(result.effects[0]?.kind, "discrepancy_opened");
});

function exactLink(leadId: string): GranotRecordLinkDocument {
  return {
    _id: objectId(),
    provider: "granot",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no_snapshot: "synthetic-job-100",
    state: "active",
    lead_ref: { model: "FormLead", id: toObjectId(leadId) },
    disputed: false,
    established_by_decision_id: objectId(),
    established_at: decidedAt,
    last_observation_id: objectId(),
    last_observed_at: decidedAt,
    domain_revision: 0,
  } as GranotRecordLinkDocument;
}

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

test("[AC-31] foundation pre-activation receipts stay historical and create no live effects", async () => {
  const row = observation();
  const deps = memoryDeps({ observation: row, activation: null });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.decisions[0]?.execution_mode, "historical_shadow");
  assert.equal(result.outcome, "linked");
  assert.equal(deps.decisions[0]?.effects[0]?.kind, "record_link_established");
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

test("[AC-32] live applied Decision replays without a second command after the Lead is current", async () => {
  const row = observation({ priority: { valid: true, canonical: "1" } });
  const leadId = String(objectId());
  const existing = {
    _id: objectId(),
    observation_id: row._id,
    attempt: 1,
    execution_mode: "live",
    outcome: "applied",
    reason_code: "lead_state_changed",
    candidates: [],
    evaluated_gates: [],
    effects: [{ kind: "lead_updated", ref: { model: "FormLead", id: leadId }, changed_paths: ["granot_priority"] }],
    decided_at: decidedAt,
  } as SynchronizationDecisionDocument;
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    identity: matchedFormIdentity(leadId),
    existingLink: exactLink(leadId),
    existingDecision: existing,
    lead: currentLead(leadId, {
      granot_priority: "1",
      quoted: true,
      normalized_job_no: "SYNTHETIC JOB 100",
      job_no: "synthetic-job-100",
      last_accepted_granot_observation: {
        observation_id: String(row._id),
        captured_at: capturedAt,
      },
    }),
    synchronizeLead: async () => {
      throw new Error("stored applied Decision must replay without synchronizeLeadFromGranot");
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.decision_id, String(existing._id));
  assert.equal(result.outcome, "applied");
  assert.equal(deps.synchronizeCalls, 0);
});

test("[AC-32] inactive Source Company is policy_blocked and never invokes the command", async () => {
  const row = observation({ priority: { valid: true, canonical: "1" } });
  const leadId = String(objectId());
  const store = reviewedStore();
  store.findCompany = async (id) => ({ id, active: false });
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    store,
    identity: matchedFormIdentity(leadId),
    lead: currentLead(leadId, { granot_priority: "8", quoted: false }),
    synchronizeLead: async () => {
      throw new Error("policy_blocked must not enter synchronizeLeadFromGranot");
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(result.outcome, "policy_blocked");
  assert.equal(deps.decisions[0]?.reason_code, "target_source_company_inactive");
  assert.equal(deps.synchronizeCalls, 0);
});

test("[AC-08] live eligible no-match invokes createLeadFromGranot once with the exact no-patch command", async () => {
  const row = completeFormObservation();
  const store = formCreateStore();
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store,
    createLead: async () => appliedCreateResult("FormLead"),
    synchronizeLead: async () => {
      throw new Error("eligible no-match must not enter synchronizeLeadFromGranot");
    },
  });
  const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
  assert.equal(deps.createLeadCalls, 1);
  assert.equal(deps.synchronizeCalls, 0);
  const command = deps.createLeadInputs[0];
  assert.ok(command);
  assertNoPatchCreateCommand(command);
  assert.equal(command.observation_id, String(row._id));
  assert.equal(
    command.source_scope.lead_source_company,
    String(store.companyId),
  );
  assert.equal(
    command.source_scope.source_granularity_id,
    String(store.localGranularityId),
  );
  assert.equal(command.lead_model, "FormLead");
  assert.equal(
    command.context.idempotency_key,
    createLeadFromGranotIdempotencyKey(String(row._id)),
  );
  assert.equal(
    command.context.payload_checksum,
    createLeadFromGranotPayloadChecksum({
      observation: row,
      source_scope: {
        granot_crm_source_id: toObjectId(store.sourceId),
        lead_source_company: toObjectId(store.companyId),
        source_granularity_id: toObjectId(store.localGranularityId),
        disposition: "source_scoped_lead",
        policy_version: "granot-lifecycle-source-policy-v1",
      },
      lead_model: "FormLead",
    }),
  );
  assert.equal(command.context.actor.actor_id, "granot-lifecycle-processor");
  assert.equal(command.context.provenance.origin, "granot_lifecycle");
  assert.equal(command.context.provenance.observation_id, String(row._id));
  assert.equal(command.context.provenance.source_receipt_id, String(row.receipt_id));
  assert.ok(command.context.provenance.decision_id);
  assert.equal(result.outcome, "created");
  assert.ok(result.effects.some((effect) => effect.kind === "lead_created"));
});

function matchedCallIdentity(leadId: string): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "source_scoped_contact",
    target: { model: "CallLead", id: leadId },
    target_eligibility: "full",
    candidates: [
      {
        target: { model: "CallLead", id: leadId },
        reason_codes: ["source_scoped_contact"],
      },
    ],
    agent_assertion: "empty",
  };
}

function completeCallObservation(
  overrides: Partial<GranotObservationDocument> = {},
): GranotObservationDocument {
  return observation({
    source_label_raw: "Synthetic Calls",
    normalized_source_label: "synthetic calls",
    contact: {
      first_name: "Ada",
      display_name: "Ada",
      phone_raw: "5550002001",
      normalized_phone: "5550002001",
    },
    ...overrides,
  });
}

test("[AC-08] live Granot Job-only Call never creates; multiple candidates block matching", async () => {
  const row = observation();
  const created = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store: callCreateStore(),
    createLead: async (input) => {
      assert.equal(input.lead_model, "CallLead");
      return appliedCreateResult("CallLead");
    },
  });
  const result = await processGranotObservation(
    { receipt_id: String(row.receipt_id) },
    created,
  );
  assert.equal(created.createLeadCalls, 0);
  assert.equal(result.outcome, "pending_match");

  const conflicted = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store: callCreateStore(),
    identity: {
      outcome: "conflict",
      reason_code: "multiple_eligible_matches",
      candidates: [
        {
          target: { model: "CallLead", id: String(objectId()) },
          reason_codes: ["multiple_eligible_matches"],
        },
        {
          target: { model: "CallLead", id: String(objectId()) },
          reason_codes: ["multiple_eligible_matches"],
        },
      ],
    },
    createLead: async () => {
      throw new Error("multiple Call candidates must not invoke creation");
    },
  });
  const conflict = await processGranotObservation(
    { receipt_id: String(row.receipt_id) },
    conflicted,
  );
  assert.equal(conflicted.createLeadCalls, 0);
  assert.equal(conflict.outcome, "conflict");
  assert.equal(conflicted.decisions[0]?.reason_code, "multiple_eligible_matches");
});

test("RingCentral-origin Call Lead plus later Granot Call observation synchronizes and does not create", async () => {
  const leadId = String(objectId());
  for (const route_event_class of ["lead_created", "priority_updated"] as const) {
    const row = completeCallObservation({ route_event_class });
    const deps = memoryDeps({
      observation: row,
      activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
      flags: liveCreationFlags(),
      store: callCreateStore(),
      identity: matchedCallIdentity(leadId),
      lead: currentLead(leadId, {
        model: "CallLead",
        ingestion_origin: "ringcentral",
        granot_priority: "8",
        quoted: false,
        normalized_phone_number: "5550002001",
      }),
      createLead: async () => {
        throw new Error("matched RingCentral Call Lead must not invoke createLeadFromGranot");
      },
      synchronizeLead: async (input) => {
        assert.equal(input.lead_ref.id, leadId);
        assert.equal(input.lead_ref.model, "CallLead");
        return { status: "applied", entity_refs: [input.lead_ref], warnings: [] };
      },
    });
    const result = await processGranotObservation(
      { receipt_id: String(row.receipt_id) },
      deps,
    );
    assert.equal(deps.createLeadCalls, 0);
    assert.equal(deps.synchronizeCalls, 1);
    assert.equal(result.outcome, "applied");
    assert.equal(result.target?.id, leadId);
  }
});

test("Call Job versus phone pointing at two Leads is job_number_conflict and never creates", async () => {
  const row = completeCallObservation({
    route_event_class: "priority_updated",
    identity: {
      job_no_raw: "synthetic-job-100",
      normalized_job_no: "SYNTHETIC JOB 100",
    },
    contact: { normalized_phone: "5550002001" },
  });
  const deps = memoryDeps({
    observation: row,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store: callCreateStore(),
    identity: {
      outcome: "conflict",
      reason_code: "job_number_conflict",
      candidates: [
        {
          target: { model: "CallLead", id: String(objectId()) },
          reason_codes: ["call_job_no_exact"],
        },
        {
          target: { model: "CallLead", id: String(objectId()) },
          reason_codes: ["source_scoped_contact"],
        },
      ],
    },
    createLead: async () => {
      throw new Error("job_number_conflict must not invoke createLeadFromGranot");
    },
  });
  const result = await processGranotObservation(
    { receipt_id: String(row.receipt_id) },
    deps,
  );
  assert.equal(deps.createLeadCalls, 0);
  assert.equal(result.outcome, "conflict");
  assert.equal(deps.decisions[0]?.reason_code, "job_number_conflict");
});

test("[AC-09] live Form same states select Local; differing states select long-distance; invalid ZIP/state create no command", async () => {
  const store = formCreateStore();
  const localRow = completeFormObservation();
  const local = memoryDeps({
    observation: localRow,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store,
    createLead: async (input) => {
      assert.equal(input.lead_model, "FormLead");
      return appliedCreateResult("FormLead");
    },
  });
  await processGranotObservation({ receipt_id: String(localRow.receipt_id) }, local);
  assert.equal(local.createLeadCalls, 1);
  assert.equal(
    local.createLeadInputs[0]?.context.payload_checksum,
    createLeadFromGranotPayloadChecksum({
      observation: localRow,
      source_scope: {
        granot_crm_source_id: toObjectId(store.sourceId),
        lead_source_company: toObjectId(store.companyId),
        source_granularity_id: toObjectId(store.localGranularityId),
        disposition: "source_scoped_lead",
        policy_version: "granot-lifecycle-source-policy-v1",
      },
      lead_model: "FormLead",
    }),
  );

  const longRow = completeFormObservation({
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "CA", zip: "94105" },
    },
  });
  const longDistance = memoryDeps({
    observation: longRow,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store,
    createLead: async (input) => {
      assert.equal(input.lead_model, "FormLead");
      return appliedCreateResult("FormLead");
    },
  });
  await processGranotObservation({ receipt_id: String(longRow.receipt_id) }, longDistance);
  assert.equal(longDistance.createLeadCalls, 1);
  assert.equal(
    longDistance.createLeadInputs[0]?.context.payload_checksum,
    createLeadFromGranotPayloadChecksum({
      observation: longRow,
      source_scope: {
        granot_crm_source_id: toObjectId(store.sourceId),
        lead_source_company: toObjectId(store.companyId),
        source_granularity_id: toObjectId(store.longGranularityId),
        disposition: "source_scoped_lead",
        policy_version: "granot-lifecycle-source-policy-v1",
      },
      lead_model: "FormLead",
    }),
  );
  assert.notEqual(
    local.createLeadInputs[0]?.context.payload_checksum,
    longDistance.createLeadInputs[0]?.context.payload_checksum,
  );

  const invalidZip = completeFormObservation({
    move: {
      origin: { state: "NY", zip: "1000" },
      destination: { state: "NY", zip: "10002" },
    },
  });
  const zipBlocked = memoryDeps({
    observation: invalidZip,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store,
    createLead: async () => {
      throw new Error("invalid ZIP must not invoke createLeadFromGranot");
    },
  });
  const zipResult = await processGranotObservation(
    { receipt_id: String(invalidZip.receipt_id) },
    zipBlocked,
  );
  assert.equal(zipResult.outcome, "insufficient_creation_data");
  assert.equal(zipBlocked.decisions[0]?.reason_code, "missing_creation_route_data");
  assert.equal(zipBlocked.createLeadCalls, 0);

  const invalidState = completeFormObservation({
    move: {
      origin: { state: "XX", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
  });
  const stateBlocked = memoryDeps({
    observation: invalidState,
    activation: { activated_at: new Date("2026-08-17T14:00:00.000Z") },
    flags: liveCreationFlags(),
    store,
    createLead: async () => {
      throw new Error("invalid state must not invoke createLeadFromGranot");
    },
  });
  const stateResult = await processGranotObservation(
    { receipt_id: String(invalidState.receipt_id) },
    stateBlocked,
  );
  assert.equal(stateResult.outcome, "insufficient_creation_data");
  assert.equal(stateBlocked.decisions[0]?.reason_code, "missing_creation_route_data");
  assert.equal(stateBlocked.createLeadCalls, 0);
  assert.equal(stateBlocked.links.length, 0);
});

test("booking status evidence is processed independently of a companion Priority 5, including delayed delivery", async () => {
  for (const winnerAt of [null, new Date(+capturedAt - 1000), new Date(+capturedAt + 1000)]) {
    const row = observation({ kind: "booking_action_snapshot", route_event_class: "booking_status_changed", priority: { valid: false }, booking_action: { raw: "Booked", normalized: "booked" } });
    const leadId = String(objectId());
    let bookingCalls = 0;
    const deps = memoryDeps({
      observation: row,
      activation: { activated_at: new Date("2026-08-17T14:00:00Z") },
      flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false, lead_writes_enabled: true, booking_cases_enabled: true },
      identity: matchedFormIdentity(leadId),
      lead: currentLead(leadId, { granot_priority: winnerAt ? "5" : undefined, last_accepted_granot_observation: winnerAt ? { observation_id: String(objectId()), captured_at: winnerAt } : undefined }),
      reconcileBooking: async () => {
        bookingCalls++;
        return { kind: "opened", case_ref: { model: "GranotBookingReconciliationCase", id: String(objectId()) }, outcome: "linked", reason_code: "booking_case_opened" };
      },
      synchronizeLead: async () => { throw new Error("Booking evidence routes through its documented reconciliation branch."); },
      createLead: async () => { throw new Error("Booking evidence never creates a Lead."); },
    });
    const result = await processGranotObservation({ receipt_id: String(row.receipt_id) }, deps);
    assert.equal(bookingCalls, 1);
    assert.deepEqual(result.effects.map((e) => e.kind), ["booking_case_opened"]);
    assert.equal(deps.createLeadCalls, 0);
  }
});
