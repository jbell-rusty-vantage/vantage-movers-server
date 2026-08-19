import mongoose, { type ClientSession } from "mongoose";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { toObjectId } from "../../utils/objectId";
import { normalizeGranotCrmUsername } from "../operationsRegistry";
import type { SourcePolicySnapshot } from "./sourcePolicy";
import type {
  EntityRef,
  LeadModel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type SynchronizationMatchMethod =
  | "granot_record_link"
  | "form_ref_no_exact"
  | "form_mongo_id_compatibility"
  | "call_job_no_exact"
  | "booking_job_no_exact"
  | "source_scoped_contact";

export type LeadIdentityObservation = {
  identity: {
    normalized_job_no?: string;
    normalized_form_ref?: string;
  };
  contact: {
    normalized_phone?: string;
    normalized_email?: string;
  };
  agent_identity: {
    user_raw?: string;
    rep_raw?: string;
  };
  provider_context?: {
    type_raw?: unknown;
  };
};

export type LeadIdentityPolicyFailure = {
  outcome: SynchronizationOutcome;
  reason: SynchronizationReasonCode;
};

export type LeadIdentityInput = {
  observation: LeadIdentityObservation;
  policy: SourcePolicySnapshot;
  policy_failure?: LeadIdentityPolicyFailure;
};

export type LeadIdentityCandidate = {
  target: EntityRef;
  reason_codes: string[];
};

export type LeadIdentityAgentSuggestion = {
  target: { model: "Agent"; id: string };
  normalized_username: string;
};

export type LeadIdentityBookingContext = {
  booking?: { model: "BookedLead"; id: string };
  owner_lead?: EntityRef;
  booking_lead_reconciliation_required: boolean;
  referral_leadless: boolean;
  multiple_bookings?: boolean;
};

export type LeadIdentityResult = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  target?: EntityRef;
  candidates: LeadIdentityCandidate[];
  target_eligibility?: "full" | "priority_only";
  agent?: LeadIdentityAgentSuggestion;
  agent_assertion?: "empty" | "single" | "conflict";
  booking_context?: LeadIdentityBookingContext;
};

export type IdentityContactSnapshot = {
  normalized_phone_number?: string;
  email?: string;
};

export type IdentityFormLead = {
  id: string;
  ref_no?: string;
  duplicate: boolean;
  bad_lead?: string;
  lead_source_company?: string;
  source_granularity_id?: string;
  normalized_job_no?: string;
  normalized_phone_number?: string;
  email?: string;
  ingested_contact_snapshot?: IdentityContactSnapshot;
  granot_contact_snapshot?: IdentityContactSnapshot;
};

export type IdentityCallLead = {
  id: string;
  duplicate: boolean;
  source_granularity_id?: string;
  normalized_job_no?: string;
  normalized_phone_number?: string;
  ingested_contact_snapshot?: IdentityContactSnapshot;
};

export type IdentityRecordLink = {
  id: string;
  normalized_job_no: string;
  lead_ref?: { model: LeadModel; id: string };
  booking_ref?: string;
  source_scope?: {
    lead_source_company: string;
    source_granularity_id: string;
  };
  disputed: boolean;
};

export type IdentityBooking = {
  id: string;
  normalized_job_no: string;
  lead_ref?: string;
  lead_model?: LeadModel;
  is_referral_booking: boolean;
  is_leadless_booking: boolean;
};

export type IdentityAgent = {
  id: string;
  active: boolean;
  granot_identity_username?: string;
  granot_crm_username?: string;
};

export type LeadIdentityQueryLog = {
  kind:
    | "active_record_link"
    | "form_by_ref_no"
    | "form_by_id"
    | "form_scoped_contact"
    | "call_scoped_job"
    | "call_scoped_phone"
    | "active_agents"
    | "bookings_by_job";
  scoped: boolean;
  filter: Record<string, string | string[] | boolean | undefined>;
};

export type LeadIdentityStore = {
  findActiveRecordLink(normalizedJobNo: string): Promise<IdentityRecordLink | null>;
  findFormLeadsByRefNo(refNo: string): Promise<IdentityFormLead[]>;
  findFormLeadById(id: string): Promise<IdentityFormLead | null>;
  findFormLeadsByScopedContact(input: {
    lead_source_company_id: string;
    source_granularity_id: string;
    phones: string[];
    emails: string[];
  }): Promise<IdentityFormLead[]>;
  findCallLeadsByScopedJob(input: {
    source_granularity_id: string;
    normalized_job_no: string;
  }): Promise<IdentityCallLead[]>;
  findCallLeadsByScopedPhone(input: {
    source_granularity_id: string;
    phones: string[];
  }): Promise<IdentityCallLead[]>;
  findCallLeadById(id: string): Promise<IdentityCallLead | null>;
  findActiveAgentsByUsername(username: string): Promise<IdentityAgent[]>;
  findBookingsByNormalizedJob(normalizedJobNo: string): Promise<IdentityBooking[]>;
};

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

export function isMongoObjectIdHex(value: string): boolean {
  return OBJECT_ID_HEX.test(value);
}

export function createMongoLeadIdentityStore(session?: ClientSession): LeadIdentityStore {
  return {
    async findActiveRecordLink(normalizedJobNo) {
      const row = await getGranotRecordLinkModel()
        .findOne({
          provider: "granot",
          normalized_job_no: normalizedJobNo,
          state: "active",
        })
        .session(session ?? null)
        .lean()
        .exec();
      if (!row) return null;
      return {
        id: String(row._id),
        normalized_job_no: row.normalized_job_no,
        lead_ref: row.lead_ref
          ? { model: row.lead_ref.model, id: String(row.lead_ref.id) }
          : undefined,
        booking_ref: row.booking_ref ? String(row.booking_ref) : undefined,
        source_scope: row.source_scope
          ? {
              lead_source_company: String(row.source_scope.lead_source_company),
              source_granularity_id: String(row.source_scope.source_granularity_id),
            }
          : undefined,
        disputed: row.disputed === true,
      };
    },
    async findFormLeadsByRefNo(refNo) {
      const rows = await getFormLeadModel()
        .find({ ref_no: refNo })
        .session(session ?? null)
        .lean()
        .exec();
      return rows.map(toIdentityFormLead);
    },
    async findFormLeadById(id) {
      if (!isMongoObjectIdHex(id)) return null;
      const row = await getFormLeadModel()
        .findById(id)
        .session(session ?? null)
        .lean()
        .exec();
      return row ? toIdentityFormLead(row) : null;
    },
    async findFormLeadsByScopedContact(input) {
      const or: Record<string, unknown>[] = [];
      if (input.phones.length > 0) {
        or.push(
          { normalized_phone_number: { $in: input.phones } },
          { "ingested_contact_snapshot.normalized_phone_number": { $in: input.phones } },
          { "granot_contact_snapshot.normalized_phone_number": { $in: input.phones } },
        );
      }
      if (input.emails.length > 0) {
        or.push(
          { email: { $in: input.emails } },
          { "ingested_contact_snapshot.email": { $in: input.emails } },
          { "granot_contact_snapshot.email": { $in: input.emails } },
        );
      }
      if (or.length === 0) return [];
      const rows = await getFormLeadModel()
        .find({
          lead_source_company: toObjectId(input.lead_source_company_id),
          source_granularity_id: toObjectId(input.source_granularity_id),
          duplicate: { $ne: true },
          $or: or,
        })
        .session(session ?? null)
        .lean()
        .exec();
      return rows.map(toIdentityFormLead);
    },
    async findCallLeadsByScopedJob(input) {
      const rows = await getCallLeadModel()
        .find({
          source_granularity_id: toObjectId(input.source_granularity_id),
          normalized_job_no: input.normalized_job_no,
        })
        .session(session ?? null)
        .lean()
        .exec();
      return rows.map(toIdentityCallLead);
    },
    async findCallLeadsByScopedPhone(input) {
      if (input.phones.length === 0) return [];
      const rows = await getCallLeadModel()
        .find({
          source_granularity_id: toObjectId(input.source_granularity_id),
          $or: [
            { normalized_phone_number: { $in: input.phones } },
            {
              "ingested_contact_snapshot.normalized_phone_number": { $in: input.phones },
            },
          ],
        })
        .session(session ?? null)
        .lean()
        .exec();
      return rows.map(toIdentityCallLead);
    },
    async findCallLeadById(id) {
      if (!isMongoObjectIdHex(id)) return null;
      const row = await getCallLeadModel()
        .findById(id)
        .session(session ?? null)
        .lean()
        .exec();
      return row ? toIdentityCallLead(row) : null;
    },
    async findActiveAgentsByUsername(username) {
      const rows = await Agent.find({
        active: true,
        $or: [
          { "granot_identity.username": username },
          { granot_crm_username: username },
        ],
      })
        .session(session ?? null)
        .lean<
          Array<{
            _id: unknown;
            active?: boolean;
            granot_identity?: { username?: string };
            granot_crm_username?: string;
          }>
        >()
        .exec();
      return rows.map((row) => ({
        id: String(row._id),
        active: row.active === true,
        granot_identity_username: row.granot_identity?.username || undefined,
        granot_crm_username: row.granot_crm_username || undefined,
      }));
    },
    async findBookingsByNormalizedJob(normalizedJobNo) {
      const rows = await BookedLead.find({ normalized_job_no: normalizedJobNo })
        .session(session ?? null)
        .lean()
        .exec();
      return rows.map((row) => ({
        id: String(row._id),
        normalized_job_no: row.normalized_job_no ?? normalizedJobNo,
        lead_ref: row.lead_ref ? String(row.lead_ref) : undefined,
        lead_model: row.lead_model === "FormLead" || row.lead_model === "CallLead"
          ? row.lead_model
          : undefined,
        is_referral_booking: row.is_referral_booking === true,
        is_leadless_booking: row.is_leadless_booking === true,
      }));
    },
  };
}

export async function resolveLeadIdentity(
  input: LeadIdentityInput,
  store: LeadIdentityStore = createMongoLeadIdentityStore(),
): Promise<LeadIdentityResult> {
  void input.observation.provider_context;
  const agent = await resolveAgentAssertion(input.observation.agent_identity, store);
  const booking = await resolveBookingContext(input, store);

  if (input.policy_failure) {
    return finalize({
      outcome: input.policy_failure.outcome,
      reason_code: input.policy_failure.reason,
      candidates: [],
      agent,
      booking,
    });
  }

  if (input.policy.lifecycle_disposition === "deferred") {
    return finalize({
      outcome: "deferred",
      reason_code: "source_deferred",
      candidates: [],
      agent,
      booking: {
        ...booking,
        referral_leadless: false,
      },
    });
  }

  if (input.policy.lifecycle_disposition === "referral_booking") {
    return finalize({
      outcome: "unmatched",
      reason_code: "creation_policy_observation_only",
      candidates: [],
      agent,
      booking: {
        ...booking,
        referral_leadless: true,
      },
    });
  }

  if (input.policy.lifecycle_disposition !== "source_scoped_lead") {
    return finalize({
      outcome: "policy_blocked",
      reason_code: "source_unclassified",
      candidates: [],
      agent,
      booking,
    });
  }

  if (!input.policy.lead_source_company_id) {
    return finalize({
      outcome: "policy_blocked",
      reason_code: "target_source_company_inactive",
      candidates: [],
      agent,
      booking,
    });
  }
  if (!input.policy.source_granularity_id || !input.policy.selected_lead_model) {
    return finalize({
      outcome: "policy_blocked",
      reason_code: "missing_creation_route_data",
      candidates: [],
      agent,
      booking,
    });
  }

  const ladder =
    input.policy.selected_lead_model === "FormLead"
      ? await resolveFormLadder(input, store)
      : await resolveCallLadder(input, store);
  const withOwner = await applyOwnerScope(ladder, booking, input, store);

  return finalize({
    ...withOwner,
    agent,
    booking,
  });
}

async function applyOwnerScope(
  ladder: LadderResult,
  booking: LeadIdentityBookingContext,
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<LadderResult> {
  const owner = booking.owner_lead;
  if (!owner || booking.referral_leadless || ladder.outcome === "conflict") {
    return ladder;
  }
  if (owner.model === "FormLead") {
    const lead = await store.findFormLeadById(owner.id);
    if (!lead) {
      return {
        outcome: "ambiguous",
        reason_code: "record_link_conflict",
        candidates: [{ target: owner, reason_codes: ["record_link_conflict"] }],
      };
    }
    const scope = formScopeConflict(lead, input.policy);
    if (scope) return scope;
  }
  if (owner.model === "CallLead") {
    const lead = await store.findCallLeadById(owner.id);
    if (!lead) {
      return {
        outcome: "conflict",
        reason_code: "record_link_conflict",
        candidates: [{ target: owner, reason_codes: ["record_link_conflict"] }],
      };
    }
    const scope = callScopeConflict(lead, input.policy);
    if (scope) return scope;
  }
  return ladder;
}

function toIdentityFormLead(row: {
  _id: unknown;
  ref_no?: string | null;
  duplicate?: boolean | null;
  bad_lead?: string | null;
  lead_source_company?: unknown;
  source_granularity_id?: unknown;
  normalized_job_no?: string | null;
  normalized_phone_number?: string | null;
  email?: string | null;
  ingested_contact_snapshot?: {
    normalized_phone_number?: string | null;
    email?: string | null;
  } | null;
  granot_contact_snapshot?: {
    normalized_phone_number?: string | null;
    email?: string | null;
  } | null;
}): IdentityFormLead {
  return {
    id: String(row._id),
    ref_no: row.ref_no || undefined,
    duplicate: row.duplicate === true,
    bad_lead: row.bad_lead || undefined,
    lead_source_company: asId(row.lead_source_company),
    source_granularity_id: asId(row.source_granularity_id),
    normalized_job_no: row.normalized_job_no || undefined,
    normalized_phone_number: row.normalized_phone_number || undefined,
    email: row.email || undefined,
    ingested_contact_snapshot: toContactSnapshot(row.ingested_contact_snapshot),
    granot_contact_snapshot: toContactSnapshot(row.granot_contact_snapshot),
  };
}

function toIdentityCallLead(row: {
  _id: unknown;
  duplicate?: boolean | null;
  source_granularity_id?: unknown;
  normalized_job_no?: string | null;
  normalized_phone_number?: string | null;
  ingested_contact_snapshot?: {
    normalized_phone_number?: string | null;
    email?: string | null;
  } | null;
}): IdentityCallLead {
  return {
    id: String(row._id),
    duplicate: row.duplicate === true,
    source_granularity_id: asId(row.source_granularity_id),
    normalized_job_no: row.normalized_job_no || undefined,
    normalized_phone_number: row.normalized_phone_number || undefined,
    ingested_contact_snapshot: toContactSnapshot(row.ingested_contact_snapshot),
  };
}

function toContactSnapshot(
  value: { normalized_phone_number?: string | null; email?: string | null } | null | undefined,
): IdentityContactSnapshot | undefined {
  if (!value) return undefined;
  return {
    normalized_phone_number: value.normalized_phone_number || undefined,
    email: value.email || undefined,
  };
}

function asId(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

type LadderResult = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  target?: EntityRef;
  candidates: LeadIdentityCandidate[];
  target_eligibility?: "full" | "priority_only";
};

async function resolveFormLadder(
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<LadderResult> {
  const job = input.observation.identity.normalized_job_no;
  const formRef = input.observation.identity.normalized_form_ref;
  const companyId = input.policy.lead_source_company_id!;
  const granularityId = input.policy.source_granularity_id!;

  if (job) {
    const link = await store.findActiveRecordLink(job);
    if (link) {
      const fromLink = await evaluateFormLink(link, input, store);
      if (fromLink.stop) return fromLink.result;
    }
  }

  if (formRef) {
    const byRef = await evaluateFormExactLeads(
      await store.findFormLeadsByRefNo(formRef),
      input,
      "form_ref_no_exact",
    );
    if (byRef.stop) return byRef.result;

    if (isMongoObjectIdHex(formRef)) {
      const byId = await store.findFormLeadById(formRef);
      const compatibility = await evaluateFormExactLeads(
        byId ? [byId] : [],
        input,
        "form_mongo_id_compatibility",
      );
      if (compatibility.stop) return compatibility.result;
    }
  }

  return evaluateFormContact(input, store, companyId, granularityId);
}

async function evaluateFormLink(
  link: IdentityRecordLink,
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<{ stop: boolean; result: LadderResult }> {
  const scopeConflict = linkScopeConflict(link, input.policy);
  if (scopeConflict) return { stop: true, result: scopeConflict };

  if (!link.lead_ref) {
    return {
      stop: false,
      result: unmatchedPending(),
    };
  }

  if (link.lead_ref.model !== "FormLead") {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "record_link_conflict",
        candidates: [
          {
            target: { model: link.lead_ref.model, id: link.lead_ref.id },
            reason_codes: ["record_link_conflict"],
          },
        ],
      },
    };
  }

  const lead = await store.findFormLeadById(link.lead_ref.id);
  if (!lead) {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "record_link_conflict",
        candidates: [
          {
            target: { model: "FormLead", id: link.lead_ref.id },
            reason_codes: ["record_link_conflict"],
          },
        ],
      },
    };
  }

  return {
    stop: true,
    result: classifyFormExactLead(lead, input, "granot_record_link"),
  };
}

async function evaluateFormExactLeads(
  leads: IdentityFormLead[],
  input: LeadIdentityInput,
  method: SynchronizationMatchMethod,
): Promise<{ stop: boolean; result: LadderResult }> {
  if (leads.length === 0) {
    return { stop: false, result: unmatchedPending() };
  }

  const classified = leads.map((lead) => classifyFormExactLead(lead, input, method));
  const conflicts = classified.filter((row) => row.outcome === "conflict");
  if (conflicts.length > 0) {
    return { stop: true, result: mergeConflictResults(conflicts) };
  }

  const ineligible = classified.filter(
    (row) => row.reason_code === "duplicate_form_lead_ineligible",
  );
  const eligible = classified.filter(
    (row) => row.target && row.outcome === "linked",
  );
  const unique = dedupeLadderResults(eligible);
  if (unique.length > 1) {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "multiple_eligible_matches",
        candidates: unique.flatMap((row) => row.candidates),
      },
    };
  }
  if (unique.length === 1 && unique[0]) {
    return { stop: true, result: unique[0] };
  }
  if (ineligible.length > 0) {
    return {
      stop: true,
      result: {
        outcome: "unmatched",
        reason_code: "duplicate_form_lead_ineligible",
        candidates: ineligible.flatMap((row) => row.candidates),
      },
    };
  }
  return { stop: false, result: unmatchedPending() };
}

function classifyFormExactLead(
  lead: IdentityFormLead,
  input: LeadIdentityInput,
  method: SynchronizationMatchMethod,
): LadderResult {
  const ref = formRef(lead.id);
  if (lead.duplicate) {
    return {
      outcome: "unmatched",
      reason_code: "duplicate_form_lead_ineligible",
      candidates: [{ target: ref, reason_codes: ["duplicate_form_lead_ineligible"] }],
    };
  }
  const scope = formScopeConflict(lead, input.policy);
  if (scope) return scope;
  const job = jobConflict(lead.normalized_job_no, input.observation.identity.normalized_job_no, ref);
  if (job) return job;
  if (lead.bad_lead) {
    return {
      outcome: "linked",
      reason_code: "bad_form_lead_priority_only",
      match_method: method,
      target: ref,
      target_eligibility: "priority_only",
      candidates: [{ target: ref, reason_codes: ["bad_form_lead_priority_only"] }],
    };
  }
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: method,
    target: ref,
    target_eligibility: "full",
    candidates: [{ target: ref, reason_codes: [method] }],
  };
}

async function evaluateFormContact(
  input: LeadIdentityInput,
  store: LeadIdentityStore,
  companyId: string,
  granularityId: string,
): Promise<LadderResult> {
  const phones = uniquePresent([input.observation.contact.normalized_phone]);
  const emails = uniquePresent([input.observation.contact.normalized_email]);
  if (phones.length === 0 && emails.length === 0) {
    return noIdentityKeys(input)
      ? { outcome: "unmatched", reason_code: "pending_source_scoped_match", candidates: [] }
      : unmatchedPending();
  }

  const found = await store.findFormLeadsByScopedContact({
    lead_source_company_id: companyId,
    source_granularity_id: granularityId,
    phones,
    emails,
  });
  const eligible = found.filter((lead) => !lead.duplicate && !lead.bad_lead);
  const unique = dedupeFormLeads(eligible);
  if (unique.length === 0) {
    return unmatchedPending();
  }

  const conflicts = unique
    .map((lead) => {
      const ref = formRef(lead.id);
      return (
        formScopeConflict(lead, input.policy) ??
        jobConflict(lead.normalized_job_no, input.observation.identity.normalized_job_no, ref)
      );
    })
    .filter((row): row is LadderResult => row != null);
  if (conflicts.length > 0) {
    return mergeConflictResults(conflicts);
  }
  if (unique.length > 1) {
    return {
      outcome: "ambiguous",
      reason_code: "multiple_eligible_matches",
      candidates: unique.map((lead) => ({
        target: formRef(lead.id),
        reason_codes: ["multiple_eligible_matches"],
      })),
    };
  }
  const lead = unique[0]!;
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: "source_scoped_contact",
    target: formRef(lead.id),
    target_eligibility: "full",
    candidates: [{ target: formRef(lead.id), reason_codes: ["source_scoped_contact"] }],
  };
}

async function resolveCallLadder(
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<LadderResult> {
  const job = input.observation.identity.normalized_job_no;
  const granularityId = input.policy.source_granularity_id!;
  const phones = callPhones(input.observation);

  if (job) {
    const link = await store.findActiveRecordLink(job);
    if (link) {
      const fromLink = await evaluateCallLink(link, input, store);
      if (fromLink.stop) return fromLink.result;
    }
  }

  let jobMatch: LadderResult | undefined;
  if (job) {
    const byJob = await store.findCallLeadsByScopedJob({
      source_granularity_id: granularityId,
      normalized_job_no: job,
    });
    const classified = classifyCallLeads(byJob, input, "call_job_no_exact");
    if (classified.stop && classified.result.outcome !== "linked") {
      return classified.result;
    }
    jobMatch = classified.result.target ? classified.result : undefined;
  }

  let phoneMatch: LadderResult | undefined;
  if (phones.length > 0) {
    const byPhone = await store.findCallLeadsByScopedPhone({
      source_granularity_id: granularityId,
      phones,
    });
    const classified = classifyCallLeads(byPhone, input, "source_scoped_contact");
    if (classified.stop && classified.result.outcome !== "linked") {
      return classified.result;
    }
    phoneMatch = classified.result.target ? classified.result : undefined;
  }

  if (jobMatch?.target && phoneMatch?.target && jobMatch.target.id !== phoneMatch.target.id) {
    return {
      outcome: "conflict",
      reason_code: "job_number_conflict",
      candidates: [
        { target: jobMatch.target, reason_codes: ["call_job_no_exact"] },
        { target: phoneMatch.target, reason_codes: ["source_scoped_contact"] },
      ],
    };
  }
  if (jobMatch?.target) return jobMatch;
  if (phoneMatch?.target) return phoneMatch;
  if (job || phones.length > 0) return unmatchedPending();
  return {
    outcome: "unmatched",
    reason_code: "pending_source_scoped_match",
    candidates: [],
  };
}

async function evaluateCallLink(
  link: IdentityRecordLink,
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<{ stop: boolean; result: LadderResult }> {
  const scopeConflict = linkScopeConflict(link, input.policy);
  if (scopeConflict) return { stop: true, result: scopeConflict };
  if (!link.lead_ref) {
    return { stop: false, result: unmatchedPending() };
  }
  if (link.lead_ref.model !== "CallLead") {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "record_link_conflict",
        candidates: [
          {
            target: { model: link.lead_ref.model, id: link.lead_ref.id },
            reason_codes: ["record_link_conflict"],
          },
        ],
      },
    };
  }
  const lead = await store.findCallLeadById(link.lead_ref.id);
  if (!lead) {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "record_link_conflict",
        candidates: [
          {
            target: { model: "CallLead", id: link.lead_ref.id },
            reason_codes: ["record_link_conflict"],
          },
        ],
      },
    };
  }
  const classified = classifyCallLeads([lead], input, "granot_record_link");
  return { stop: true, result: classified.result };
}

function classifyCallLeads(
  leads: IdentityCallLead[],
  input: LeadIdentityInput,
  method: SynchronizationMatchMethod,
): { stop: boolean; result: LadderResult } {
  if (leads.length === 0) {
    return { stop: false, result: unmatchedPending() };
  }
  const unique = dedupeCallLeads(leads);
  const conflicts = unique
    .map((lead) => {
      const ref = callRef(lead.id);
      return (
        callScopeConflict(lead, input.policy) ??
        jobConflict(lead.normalized_job_no, input.observation.identity.normalized_job_no, ref)
      );
    })
    .filter((row): row is LadderResult => row != null);
  if (conflicts.length > 0) {
    return { stop: true, result: mergeConflictResults(conflicts) };
  }
  if (unique.length > 1) {
    return {
      stop: true,
      result: {
        outcome: "conflict",
        reason_code: "multiple_eligible_matches",
        candidates: unique.map((lead) => ({
          target: callRef(lead.id),
          reason_codes: ["multiple_eligible_matches"],
        })),
      },
    };
  }
  const lead = unique[0]!;
  return {
    stop: true,
    result: {
      outcome: "linked",
      reason_code: "record_link_confirmed",
      match_method: method,
      target: callRef(lead.id),
      target_eligibility: "full",
      candidates: [{ target: callRef(lead.id), reason_codes: [method] }],
    },
  };
}

async function resolveAgentAssertion(
  agentIdentity: LeadIdentityObservation["agent_identity"],
  store: LeadIdentityStore,
): Promise<{
  agent?: LeadIdentityAgentSuggestion;
  agent_assertion: "empty" | "single" | "conflict";
}> {
  const user = normalizeGranotCrmUsername(agentIdentity.user_raw);
  const rep = normalizeGranotCrmUsername(agentIdentity.rep_raw);
  if (!user && !rep) {
    return { agent_assertion: "empty" };
  }
  if (user && rep && user !== rep) {
    return { agent_assertion: "conflict" };
  }
  const username = user ?? rep;
  if (!username) {
    return { agent_assertion: "empty" };
  }
  const matches = await store.findActiveAgentsByUsername(username);
  const distinct = [...new Map(matches.map((row) => [row.id, row])).values()];
  if (distinct.length !== 1 || !distinct[0]) {
    return { agent_assertion: "single" };
  }
  return {
    agent_assertion: "single",
    agent: {
      target: { model: "Agent", id: distinct[0].id },
      normalized_username: username,
    },
  };
}

async function resolveBookingContext(
  input: LeadIdentityInput,
  store: LeadIdentityStore,
): Promise<LeadIdentityBookingContext> {
  const referralPolicy = input.policy.lifecycle_disposition === "referral_booking";
  const job = input.observation.identity.normalized_job_no;
  if (!job) {
    return {
      booking_lead_reconciliation_required: false,
      referral_leadless: referralPolicy,
    };
  }
  const bookings = await store.findBookingsByNormalizedJob(job);
  if (bookings.length > 1) {
    return {
      booking_lead_reconciliation_required: false,
      referral_leadless: referralPolicy,
      multiple_bookings: true,
    };
  }
  const booking = bookings[0];
  if (!booking) {
    return {
      booking_lead_reconciliation_required: false,
      referral_leadless: referralPolicy,
    };
  }
  const referral = referralPolicy || booking.is_referral_booking;
  const owner =
    booking.lead_ref && booking.lead_model
      ? { model: booking.lead_model, id: booking.lead_ref }
      : undefined;
  return {
    booking: { model: "BookedLead", id: booking.id },
    owner_lead: owner,
    booking_lead_reconciliation_required:
      !referral && !owner && (booking.is_leadless_booking || !booking.lead_ref),
    referral_leadless: referral,
  };
}

function finalize(input: {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  target?: EntityRef;
  candidates: LeadIdentityCandidate[];
  target_eligibility?: "full" | "priority_only";
  agent: {
    agent?: LeadIdentityAgentSuggestion;
    agent_assertion: "empty" | "single" | "conflict";
  };
  booking: LeadIdentityBookingContext;
}): LeadIdentityResult {
  const bookingConflict = applyBookingOwnerConflict(input);
  const suppressAgent =
    bookingConflict.target_eligibility === "priority_only" ||
    input.agent.agent_assertion === "conflict";
  return {
    outcome: bookingConflict.outcome,
    reason_code: bookingConflict.reason_code,
    match_method: bookingConflict.match_method,
    target: bookingConflict.target,
    candidates: bookingConflict.candidates,
    target_eligibility: bookingConflict.target_eligibility,
    agent: suppressAgent ? undefined : input.agent.agent,
    agent_assertion: input.agent.agent_assertion,
    booking_context: input.booking,
  };
}

function applyBookingOwnerConflict(input: {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  target?: EntityRef;
  candidates: LeadIdentityCandidate[];
  target_eligibility?: "full" | "priority_only";
  booking: LeadIdentityBookingContext;
}): LadderResult {
  if (input.booking.multiple_bookings) {
    return {
      outcome: "conflict",
      reason_code: "job_number_conflict",
      candidates: input.candidates,
    };
  }
  if (input.outcome === "conflict" || input.outcome === "ambiguous") {
    return input;
  }
  const owner = input.booking.owner_lead;
  if (input.booking.referral_leadless) {
    return {
      outcome: input.outcome,
      reason_code: input.reason_code,
      candidates: input.candidates,
    };
  }
  if (!owner) {
    return input;
  }
  if (input.target && input.target.id !== owner.id) {
    return {
      outcome: "conflict",
      reason_code: "job_number_conflict",
      candidates: uniqueCandidates([
        ...input.candidates,
        { target: owner, reason_codes: ["booking_job_no_exact"] },
        { target: input.target, reason_codes: input.match_method ? [input.match_method] : [] },
      ]),
    };
  }
  if (!input.target) {
    return {
      outcome: "linked",
      reason_code: "record_link_confirmed",
      match_method: "booking_job_no_exact",
      target: owner,
      target_eligibility: "full",
      candidates: [{ target: owner, reason_codes: ["booking_job_no_exact"] }],
    };
  }
  return input;
}

function linkScopeConflict(
  link: IdentityRecordLink,
  policy: SourcePolicySnapshot,
): LadderResult | undefined {
  if (!link.source_scope) return undefined;
  if (
    (policy.lead_source_company_id &&
      link.source_scope.lead_source_company !== policy.lead_source_company_id) ||
    (policy.source_granularity_id &&
      link.source_scope.source_granularity_id !== policy.source_granularity_id)
  ) {
    return {
      outcome: "conflict",
      reason_code: "source_scope_conflict",
      candidates: [],
    };
  }
  return undefined;
}

function formScopeConflict(
  lead: IdentityFormLead,
  policy: SourcePolicySnapshot,
): LadderResult | undefined {
  if (!lead.lead_source_company || !lead.source_granularity_id) {
    return {
      outcome: "conflict",
      reason_code: "source_scope_conflict",
      candidates: [{ target: formRef(lead.id), reason_codes: ["source_scope_conflict"] }],
    };
  }
  if (
    lead.lead_source_company !== policy.lead_source_company_id ||
    lead.source_granularity_id !== policy.source_granularity_id
  ) {
    return {
      outcome: "conflict",
      reason_code: "source_scope_conflict",
      candidates: [{ target: formRef(lead.id), reason_codes: ["source_scope_conflict"] }],
    };
  }
  return undefined;
}

function callScopeConflict(
  lead: IdentityCallLead,
  policy: SourcePolicySnapshot,
): LadderResult | undefined {
  if (!lead.source_granularity_id) {
    return {
      outcome: "conflict",
      reason_code: "source_scope_conflict",
      candidates: [{ target: callRef(lead.id), reason_codes: ["source_scope_conflict"] }],
    };
  }
  if (lead.source_granularity_id !== policy.source_granularity_id) {
    return {
      outcome: "conflict",
      reason_code: "source_scope_conflict",
      candidates: [{ target: callRef(lead.id), reason_codes: ["source_scope_conflict"] }],
    };
  }
  return undefined;
}

function jobConflict(
  leadJob: string | undefined,
  observationJob: string | undefined,
  target: EntityRef,
): LadderResult | undefined {
  if (leadJob && observationJob && leadJob !== observationJob) {
    return {
      outcome: "conflict",
      reason_code: "job_number_conflict",
      candidates: [{ target, reason_codes: ["job_number_conflict"] }],
    };
  }
  return undefined;
}

function unmatchedPending(): LadderResult {
  return {
    outcome: "pending_match",
    reason_code: "pending_source_scoped_match",
    candidates: [],
  };
}

function noIdentityKeys(input: LeadIdentityInput): boolean {
  return (
    !input.observation.identity.normalized_job_no &&
    !input.observation.identity.normalized_form_ref &&
    !input.observation.contact.normalized_phone &&
    !input.observation.contact.normalized_email
  );
}

function callPhones(observation: LeadIdentityObservation): string[] {
  return uniquePresent([observation.contact.normalized_phone]);
}

function uniquePresent(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function formRef(id: string): EntityRef {
  return { model: "FormLead", id };
}

function callRef(id: string): EntityRef {
  return { model: "CallLead", id };
}

function dedupeFormLeads(leads: IdentityFormLead[]): IdentityFormLead[] {
  return [...new Map(leads.map((lead) => [lead.id, lead])).values()];
}

function dedupeCallLeads(leads: IdentityCallLead[]): IdentityCallLead[] {
  return [...new Map(leads.map((lead) => [lead.id, lead])).values()];
}

function dedupeLadderResults(rows: LadderResult[]): LadderResult[] {
  const seen = new Map<string, LadderResult>();
  for (const row of rows) {
    if (row.target && !seen.has(row.target.id)) {
      seen.set(row.target.id, row);
    }
  }
  return [...seen.values()];
}

function mergeConflictResults(rows: LadderResult[]): LadderResult {
  return {
    outcome: "conflict",
    reason_code: rows[0]?.reason_code ?? "source_scope_conflict",
    candidates: uniqueCandidates(rows.flatMap((row) => row.candidates)),
  };
}

function uniqueCandidates(rows: LeadIdentityCandidate[]): LeadIdentityCandidate[] {
  const seen = new Map<string, LeadIdentityCandidate>();
  for (const row of rows) {
    const key = `${row.target.model}:${row.target.id}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, row);
      continue;
    }
    seen.set(key, {
      target: row.target,
      reason_codes: [...new Set([...existing.reason_codes, ...row.reason_codes])],
    });
  }
  return [...seen.values()];
}
