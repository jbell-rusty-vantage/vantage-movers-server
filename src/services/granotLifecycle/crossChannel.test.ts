import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import {
  createBrowserExtensionOwnerInitiator,
} from "../durableWork/actors";
import type { SynchronizeLeadFromGranotInput } from "./synchronizeLeadFromGranot";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";
import type { LeadIdentityResult } from "./identity";
import type { SourcePolicyStore } from "./sourcePolicy";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const companyId = new mongoose.Types.ObjectId();
const granularityId = new mongoose.Types.ObjectId();


function reviewedStore(): SourcePolicyStore {
  return {
    async findByNormalizedLabel() {
      return [
        {
          id: String(companyId),
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: String(companyId),
          lifecycle_routes: [
            {
              route_key: "form_any",
              lead_model: "FormLead",
              move_type: "any",
              source_granularity_id: String(granularityId),
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
          normalized_granot_label: "synthetic forms",
        },
      ];
    },
    async findCompany() {
      return { id: String(companyId), active: true };
    },
    async findGranularity() {
      return {
        id: String(granularityId),
        source_company_id: String(companyId),
        active: true,
        channel: "form",
      };
    },
  };
}

function identity(): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "form_ref_no_exact",
    target: { model: "FormLead", id: "507f1f77bcf86cd799439011" },
    candidates: [],
  };
}

function observation(receiptId: mongoose.Types.ObjectId): GranotObservationDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    receipt_id: receiptId,
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    captured_at: capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: "567632",
      normalized_job_no: "567632",
      form_ref_raw: "synthetic-ref",
    },
    contact: {},
    move: {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
    priority: { raw: "1", canonical: "1", valid: true },
    booking_action: {},
    display_money: {},
    agent_identity: { user_raw: "MIKE", rep_raw: "SALES" },
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  } as unknown as GranotObservationDocument;
}

function memoryDeps(observationDoc: GranotObservationDocument): GranotLifecycleProcessorDeps & {
  decisions: SynchronizationDecisionDocument[];
} {
  const decisions: SynchronizationDecisionDocument[] = [];
  return {
    decisions,
    now: () => capturedAt,
    flags: GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    sourcePolicyStore: reviewedStore(),
    loadReceipt: async () => ({
      _id: observationDoc.receipt_id,
      observation_channel: "browser_extension",
      captured_at: capturedAt,
      processing: { match_attempt: 0 },
    }),
    upsertObservation: async () => observationDoc,
    loadActivation: async () => null,
    findDecision: async () => null,
    findActiveLink: async () => null,
    resolveIdentity: async () => identity(),
    loadLeadProjection: async () => ({
      model: "FormLead",
      id: "507f1f77bcf86cd799439011",
      job_no: "567632",
      quoted: true,
      granot_priority: "1",
      receiver_agent: undefined,
      last_accepted_granot_observation: undefined,
    }),
    persistDecisionOnly: async (decision) => {
      decisions.push(decision);
    },
    persistDecisionAndLink: async ({ decision }) => {
      decisions.push(decision);
    },
    withTransaction: async (fn) => fn({} as never),
  };
}

test("[AC-33] equivalent live webhook, extension, and automation desired states match", async () => {
  const calls: Array<{
    channel: string | null | undefined;
    origin: string;
    actor: string;
    desired: SynchronizeLeadFromGranotInput["desired_state"];
  }> = [];

  async function run(channel: "granot_webhook" | "browser_extension" | "granot_http_automation") {
    const obs = observation(new mongoose.Types.ObjectId());
    const deps = memoryDeps(obs);
    deps.flags = {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    };
    deps.loadActivation = async () => ({ activated_at: new Date("2026-08-17T14:00:00.000Z") });
    deps.loadLeadProjection = async () => ({
      model: "FormLead",
      id: "507f1f77bcf86cd799439011",
      ingestion_origin: "wordpress_form",
      job_no: "567632",
      normalized_job_no: "567632",
      quoted: false,
      granot_priority: "8",
      receiver_agent: undefined,
      last_accepted_granot_observation: undefined,
      domain_revision: 2,
    });
    deps.loadReceipt = async () => ({
      _id: obs.receipt_id,
      observation_channel: channel,
      captured_at: capturedAt,
      processing: { match_attempt: 0 },
    });
    deps.synchronizeLead = async (input) => {
      calls.push({
        channel: input.context.provenance.observation_channel,
        origin: input.context.initiator.origin ?? "",
        actor: input.context.actor.actor_id,
        desired: input.desired_state,
      });
      return { status: "applied", entity_refs: [input.lead_ref], warnings: [] };
    };
    const initiator =
      channel === "browser_extension"
        ? createBrowserExtensionOwnerInitiator({
            actor_id: "owner-1",
            actor_label: "Owner",
            request_id: String(obs.receipt_id),
          })
        : channel === "granot_http_automation"
          ? {
              actor_type: "admin" as const,
              actor_id: "admin-1",
              actor_label: "Admin",
              actor_role: "admin" as const,
              origin: "vantage_admin" as const,
              request_id: String(obs.receipt_id),
            }
          : undefined;
    return processGranotObservation({ receipt_id: String(obs.receipt_id), initiator }, deps);
  }

  const webhook = await run("granot_webhook");
  const extension = await run("browser_extension");
  const automation = await run("granot_http_automation");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0]?.desired.changed_paths, calls[1]?.desired.changed_paths);
  assert.deepEqual(calls[1]?.desired.changed_paths, calls[2]?.desired.changed_paths);
  assert.equal(calls[0]?.desired.set.granot_priority, "1");
  assert.equal(calls[0]?.desired.set.quoted, true);
  assert.equal(calls[0]?.channel, "granot_webhook");
  assert.equal(calls[1]?.channel, "browser_extension");
  assert.equal(calls[2]?.channel, "granot_http_automation");
  assert.equal(calls[0]?.origin, "granot_lifecycle");
  assert.equal(calls[1]?.origin, "browser_extension");
  assert.equal(calls[2]?.origin, "vantage_admin");
  assert.equal(new Set(calls.map((call) => call.actor)).size, 1);
  assert.equal(webhook.outcome, "applied");
  assert.equal(extension.outcome, "applied");
  assert.equal(automation.outcome, "applied");
});
