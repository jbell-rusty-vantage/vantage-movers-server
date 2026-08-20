import assert from "node:assert/strict";
import { test } from "node:test";
import { jobNumbersEquivalent } from "../bookings/bookingIdentity";
import {
  resolveLeadIdentity,
  type IdentityAgent,
  type IdentityBooking,
  type IdentityCallLead,
  type IdentityFormLead,
  type IdentityRecordLink,
  type LeadIdentityObservation,
  type LeadIdentityQueryLog,
  type LeadIdentityResult,
  type LeadIdentityStore,
} from "./identity";
import type { SourcePolicySnapshot } from "./sourcePolicy";

const COMPANY = "64c000000000000000000001";
const GRANULARITY = "64c000000000000000000002";
const FORM_ID = "64c0000000000000000000aa";
const CALL_ID = "64c0000000000000000000ca";
const BOOKING_ID = "64c0000000000000000000b1";
const LINK_ID = "64c0000000000000000000d1";

type Seed = {
  links?: IdentityRecordLink[];
  formLeads?: IdentityFormLead[];
  callLeads?: IdentityCallLead[];
  agents?: IdentityAgent[];
  bookings?: IdentityBooking[];
};

function formPolicy(): SourcePolicySnapshot {
  return {
    granot_crm_source_id: "64c000000000000000000010",
    lead_source_company_id: COMPANY,
    source_granularity_id: GRANULARITY,
    selected_route_key: "form_local",
    selected_lead_model: "FormLead",
    selected_move_type: "local",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
  };
}

function callPolicy(): SourcePolicySnapshot {
  return {
    ...formPolicy(),
    selected_route_key: "call_any",
    selected_lead_model: "CallLead",
    selected_move_type: "any",
  };
}

function observation(
  overrides: Partial<LeadIdentityObservation> = {},
): LeadIdentityObservation {
  return {
    identity: { ...overrides.identity },
    contact: { ...overrides.contact },
    agent_identity: { ...overrides.agent_identity },
    provider_context: overrides.provider_context ?? {},
  };
}

function createModuleStore(seed: Seed = {}): LeadIdentityStore & {
  queries: LeadIdentityQueryLog[];
  writes: string[];
} {
  const queries: LeadIdentityQueryLog[] = [];
  const writes: string[] = [];
  const forbidWrite = (name: string) => {
    writes.push(name);
    throw new Error(`Identity store write is forbidden: ${name}`);
  };
  return {
    queries,
    writes,
    async findActiveRecordLink(normalizedJobNo) {
      queries.push({
        kind: "active_record_link",
        scoped: true,
        filter: { normalized_job_no: normalizedJobNo },
      });
      return seed.links?.find((row) => jobNumbersEquivalent(row.normalized_job_no, normalizedJobNo)) ?? null;
    },
    async findFormLeadsByRefNo(refNo) {
      queries.push({ kind: "form_by_ref_no", scoped: false, filter: { ref_no: refNo } });
      return (seed.formLeads ?? []).filter((row) => row.ref_no === refNo);
    },
    async findFormLeadById(id) {
      queries.push({ kind: "form_by_id", scoped: false, filter: { id } });
      return (seed.formLeads ?? []).find((row) => row.id === id) ?? null;
    },
    async findFormLeadsByScopedContact(input) {
      queries.push({
        kind: "form_scoped_contact",
        scoped: true,
        filter: {
          lead_source_company_id: input.lead_source_company_id,
          source_granularity_id: input.source_granularity_id,
        },
      });
      return (seed.formLeads ?? []).filter((row) => {
        if (row.duplicate || row.bad_lead) return false;
        if (row.lead_source_company !== input.lead_source_company_id) return false;
        if (row.source_granularity_id !== input.source_granularity_id) return false;
        const phones = [
          row.normalized_phone_number,
          row.ingested_contact_snapshot?.normalized_phone_number,
          row.granot_contact_snapshot?.normalized_phone_number,
        ];
        const emails = [
          row.email,
          row.ingested_contact_snapshot?.email,
          row.granot_contact_snapshot?.email,
        ];
        return (
          input.phones.some((phone) => phones.includes(phone)) ||
          input.emails.some((email) => emails.includes(email))
        );
      });
    },
    async findCallLeadsByScopedJob(input) {
      queries.push({
        kind: "call_scoped_job",
        scoped: true,
        filter: {
          source_granularity_id: input.source_granularity_id,
          normalized_job_no: input.normalized_job_no,
        },
      });
      return (seed.callLeads ?? []).filter(
        (row) =>
          row.source_granularity_id === input.source_granularity_id &&
          jobNumbersEquivalent(row.normalized_job_no, input.normalized_job_no),
      );
    },
    async findCallLeadsByScopedPhone(input) {
      queries.push({
        kind: "call_scoped_phone",
        scoped: true,
        filter: { source_granularity_id: input.source_granularity_id },
      });
      return (seed.callLeads ?? []).filter((row) => {
        if (row.source_granularity_id !== input.source_granularity_id) return false;
        const phones = [
          row.normalized_phone_number,
          row.ingested_contact_snapshot?.normalized_phone_number,
        ];
        return input.phones.some((phone) => phones.includes(phone));
      });
    },
    async findCallLeadById(id) {
      return (seed.callLeads ?? []).find((row) => row.id === id) ?? null;
    },
    async findActiveAgentsByUsername(username) {
      queries.push({ kind: "active_agents", scoped: true, filter: { username } });
      return (seed.agents ?? []).filter(
        (row) =>
          row.active &&
          (row.granot_identity_username === username || row.granot_crm_username === username),
      );
    },
    async findBookingsByNormalizedJob(normalizedJobNo) {
      queries.push({
        kind: "bookings_by_job",
        scoped: true,
        filter: { normalized_job_no: normalizedJobNo },
      });
      return (seed.bookings ?? []).filter((row) =>
        jobNumbersEquivalent(row.normalized_job_no, normalizedJobNo),
      );
    },
    insert: () => forbidWrite("insert"),
    update: () => forbidWrite("update"),
    remove: () => forbidWrite("remove"),
  } as LeadIdentityStore & { queries: LeadIdentityQueryLog[]; writes: string[] };
}

function assertReadOnlyResult(result: LeadIdentityResult): void {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("555000"), false);
  assert.equal(serialized.includes("@example"), false);
  assert.equal(serialized.includes("SYNTH JOB"), false);
}

test("[AC-39] Booking without a Lead returns Booking Lead Reconciliation delegation only", async () => {
  const store = createModuleStore({
    bookings: [
      {
        id: BOOKING_ID,
        normalized_job_no: "SYNTH JOB 14C",
        is_referral_booking: false,
        is_leadless_booking: true,
      },
    ],
  });
  const before = store.writes.slice();
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14C" },
      }),
      policy: formPolicy(),
    },
    store,
  );
  assert.equal(result.booking_context?.booking?.id, BOOKING_ID);
  assert.equal(result.booking_context?.booking_lead_reconciliation_required, true);
  assert.equal(result.booking_context?.referral_leadless, false);
  assert.equal(result.booking_context?.owner_lead, undefined);
  assert.deepEqual(store.writes, before);
  assertReadOnlyResult(result);
});

test("[AC-04] module portion multiple current Bookings are an operational Job conflict", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14C" },
      }),
      policy: formPolicy(),
    },
    createModuleStore({
      bookings: [
        {
          id: BOOKING_ID,
          normalized_job_no: "SYNTH JOB 14C",
          is_referral_booking: false,
          is_leadless_booking: false,
          lead_ref: FORM_ID,
          lead_model: "FormLead",
        },
        {
          id: "64c0000000000000000000b2",
          normalized_job_no: "SYNTH JOB 14C",
          is_referral_booking: false,
          is_leadless_booking: false,
          lead_ref: FORM_ID,
          lead_model: "FormLead",
        },
      ],
      formLeads: [
        {
          id: FORM_ID,
          duplicate: false,
          lead_source_company: COMPANY,
          source_granularity_id: GRANULARITY,
        },
      ],
    }),
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.reason_code, "job_number_conflict");
});

test("[AC-07] module portion Record Link model mismatch is a hard conflict", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14C" },
      }),
      policy: formPolicy(),
    },
    createModuleStore({
      links: [
        {
          id: LINK_ID,
          normalized_job_no: "SYNTH JOB 14C",
          lead_ref: { model: "CallLead", id: CALL_ID },
          disputed: false,
        },
      ],
      callLeads: [
        {
          id: CALL_ID,
          duplicate: false,
          source_granularity_id: GRANULARITY,
          normalized_job_no: "SYNTH JOB 14C",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.reason_code, "record_link_conflict");
  assert.equal(result.target, undefined);
});

test("missing Record Link Lead is a hard conflict and not a contact fallback", async () => {
  const store = createModuleStore({
    links: [
      {
        id: LINK_ID,
        normalized_job_no: "SYNTH JOB 14C",
        lead_ref: { model: "FormLead", id: FORM_ID },
        source_scope: {
          lead_source_company: COMPANY,
          source_granularity_id: GRANULARITY,
        },
        disputed: false,
      },
    ],
    formLeads: [],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: {
          normalized_job_no: "SYNTH JOB 14C",
          normalized_form_ref: "synthetic-module-ref",
        },
        contact: { normalized_phone: "5550003333" },
      }),
      policy: formPolicy(),
    },
    store,
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.reason_code, "record_link_conflict");
  assert.equal(store.queries.some((query) => query.kind === "form_scoped_contact"), false);
});

test("[AC-07] module portion Call ladder never queries phone without Source Granularity", async () => {
  const store = createModuleStore({
    callLeads: [
      {
        id: CALL_ID,
        duplicate: false,
        source_granularity_id: GRANULARITY,
        normalized_phone_number: "5550003333",
      },
    ],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        contact: { normalized_phone: "5550003333" },
      }),
      policy: callPolicy(),
    },
    store,
  );
  assert.equal(result.target?.id, CALL_ID);
  assert.ok(
    store.queries
      .filter((query) => query.kind === "call_scoped_phone")
      .every((query) => query.scoped && query.filter.source_granularity_id === GRANULARITY),
  );
});

test("Booking owner that differs from a contact candidate is conflict evidence, not reassignment", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14C" },
        contact: { normalized_phone: "5550003333" },
      }),
      policy: formPolicy(),
    },
    createModuleStore({
      formLeads: [
        {
          id: FORM_ID,
          duplicate: false,
          lead_source_company: COMPANY,
          source_granularity_id: GRANULARITY,
          normalized_phone_number: "5550003333",
        },
        {
          id: "64c0000000000000000000ac",
          duplicate: false,
          lead_source_company: COMPANY,
          source_granularity_id: GRANULARITY,
        },
      ],
      bookings: [
        {
          id: BOOKING_ID,
          normalized_job_no: "SYNTH JOB 14C",
          lead_ref: "64c0000000000000000000ac",
          lead_model: "FormLead",
          is_referral_booking: false,
          is_leadless_booking: false,
        },
      ],
    }),
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.reason_code, "job_number_conflict");
  assert.equal(result.booking_context?.owner_lead?.id, "64c0000000000000000000ac");
  assert.equal(result.target, undefined);
});
