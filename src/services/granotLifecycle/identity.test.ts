import assert from "node:assert/strict";
import { test } from "node:test";
import { jobNumbersEquivalent } from "../bookings/bookingIdentity";
import {
  isMongoObjectIdHex,
  resolveLeadIdentity,
  type IdentityAgent,
  type IdentityBooking,
  type IdentityCallLead,
  type IdentityFormLead,
  type IdentityRecordLink,
  type LeadIdentityObservation,
  type LeadIdentityQueryLog,
  type LeadIdentityStore,
} from "./identity";
import type { SourcePolicySnapshot } from "./sourcePolicy";

const COMPANY = "64b000000000000000000001";
const GRANULARITY = "64b000000000000000000002";
const OTHER_GRANULARITY = "64b000000000000000000004";
const FORM_ID = "64b0000000000000000000aa";
const CALL_ID = "64b0000000000000000000ca";
const CALL_ID_B = "64b0000000000000000000cb";
const AGENT_ID = "64b0000000000000000000a1";
const LINK_ID = "64b0000000000000000000d1";

function formPolicy(overrides: Partial<SourcePolicySnapshot> = {}): SourcePolicySnapshot {
  return {
    granot_crm_source_id: "64b000000000000000000010",
    lead_source_company_id: COMPANY,
    source_granularity_id: GRANULARITY,
    selected_route_key: "form_local",
    selected_lead_model: "FormLead",
    selected_move_type: "local",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lifecycle_policy_version: "best-relocation-forms/v1",
    ...overrides,
  };
}

function callPolicy(overrides: Partial<SourcePolicySnapshot> = {}): SourcePolicySnapshot {
  return {
    ...formPolicy(),
    selected_route_key: "call_any",
    selected_lead_model: "CallLead",
    selected_move_type: "any",
    ...overrides,
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

function formLead(overrides: Partial<IdentityFormLead> = {}): IdentityFormLead {
  return {
    id: FORM_ID,
    ref_no: "synthetic-tracking-ref-14",
    duplicate: false,
    lead_source_company: COMPANY,
    source_granularity_id: GRANULARITY,
    ...overrides,
  };
}

function callLead(overrides: Partial<IdentityCallLead> = {}): IdentityCallLead {
  return {
    id: CALL_ID,
    duplicate: false,
    source_granularity_id: GRANULARITY,
    ...overrides,
  };
}

function createRecordingStore(seed: {
  links?: IdentityRecordLink[];
  formLeads?: IdentityFormLead[];
  callLeads?: IdentityCallLead[];
  agents?: IdentityAgent[];
  bookings?: IdentityBooking[];
} = {}): LeadIdentityStore & { queries: LeadIdentityQueryLog[] } {
  const queries: LeadIdentityQueryLog[] = [];
  return {
    queries,
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
      if (!input.lead_source_company_id || !input.source_granularity_id) {
        throw new Error("Form contact query must include Source Company and Source Granularity");
      }
      queries.push({
        kind: "form_scoped_contact",
        scoped: true,
        filter: {
          lead_source_company_id: input.lead_source_company_id,
          source_granularity_id: input.source_granularity_id,
          phones: input.phones,
          emails: input.emails,
        },
      });
      return (seed.formLeads ?? []).filter((row) => {
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
      if (!input.source_granularity_id) {
        throw new Error("Call Job query must include source_granularity_id");
      }
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
      if (!input.source_granularity_id) {
        throw new Error("Call phone query must include source_granularity_id");
      }
      queries.push({
        kind: "call_scoped_phone",
        scoped: true,
        filter: {
          source_granularity_id: input.source_granularity_id,
          phones: input.phones,
        },
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
  };
}

function assertNoPayloadLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("555000"), false);
  assert.equal(serialized.includes("@example"), false);
  assert.equal(serialized.includes("customer@"), false);
  assert.equal(serialized.includes("SYNTH JOB"), false);
  assert.equal(serialized.includes("not provided"), false);
}

test("[AC-09] identity portion missing or invalid route never queries a Lead", async () => {
  const store = createRecordingStore({
    formLeads: [formLead()],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_form_ref: "synthetic-tracking-ref-14" },
        contact: { normalized_phone: "5550001111" },
      }),
      policy: formPolicy({
        source_granularity_id: undefined,
        selected_lead_model: undefined,
        selected_route_key: undefined,
      }),
    },
    store,
  );
  assert.equal(result.outcome, "policy_blocked");
  assert.equal(result.reason_code, "missing_creation_route_data");
  assert.equal(result.target, undefined);
  assert.equal(
    store.queries.some((query) => query.kind.startsWith("form") || query.kind.startsWith("call")),
    false,
  );
  assertNoPayloadLeak(result);
});

test("[AC-03] valid 24-character ObjectId compatibility lookup remains a later rung", async () => {
  assert.equal(isMongoObjectIdHex(FORM_ID), true);
  assert.equal(isMongoObjectIdHex("not-an-object-id"), false);
  const store = createRecordingStore({
    formLeads: [formLead({ ref_no: "unrelated-ref", id: FORM_ID })],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_form_ref: FORM_ID },
      }),
      policy: formPolicy(),
    },
    store,
  );
  assert.equal(result.match_method, "form_mongo_id_compatibility");
  assert.equal(result.target?.id, FORM_ID);
});

test("[AC-04] Call Job outside resolved Source Granularity is never a global match", async () => {
  const store = createRecordingStore({
    callLeads: [callLead({ normalized_job_no: "SYNTH JOB 14A", source_granularity_id: OTHER_GRANULARITY })],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14A" },
      }),
      policy: callPolicy(),
    },
    store,
  );
  assert.equal(result.outcome, "pending_match");
  assert.equal(result.target, undefined);
  assert.ok(store.queries.some((query) => query.kind === "call_scoped_job" && query.scoped));
  assert.equal(
    store.queries.some(
      (query) => query.kind === "call_scoped_job" && query.filter.source_granularity_id !== GRANULARITY,
    ),
    false,
  );
});

test("[AC-07] identity portion returns one deterministic Form target and never queries globally", async () => {
  const store = createRecordingStore({
    formLeads: [
      formLead({
        normalized_phone_number: "5550001111",
        ingested_contact_snapshot: { normalized_phone_number: "5550002222" },
      }),
    ],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        contact: { normalized_phone: "5550001111" },
      }),
      policy: formPolicy(),
    },
    store,
  );
  assert.equal(result.outcome, "linked");
  assert.equal(result.match_method, "source_scoped_contact");
  assert.equal(result.target?.id, FORM_ID);
  assert.ok(store.queries.every((query) => query.kind !== "form_scoped_contact" || query.scoped));
});

test("job-only Record Link is evidence and the Form ladder continues", async () => {
  const store = createRecordingStore({
    links: [
      {
        id: LINK_ID,
        normalized_job_no: "SYNTH JOB 14A",
        disputed: false,
      },
    ],
    formLeads: [formLead()],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: {
          normalized_job_no: "SYNTH JOB 14A",
          normalized_form_ref: "synthetic-tracking-ref-14",
        },
      }),
      policy: formPolicy(),
    },
    store,
  );
  assert.equal(result.match_method, "form_ref_no_exact");
  assert.equal(result.target?.id, FORM_ID);
});

test("Bad Form Lead is priority_only from strong exact identity and excluded from contact matching", async () => {
  const exact = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_form_ref: "synthetic-tracking-ref-14" },
      }),
      policy: formPolicy(),
    },
    createRecordingStore({
      formLeads: [formLead({ bad_lead: "spam" })],
    }),
  );
  assert.equal(exact.outcome, "linked");
  assert.equal(exact.target_eligibility, "priority_only");
  assert.equal(exact.reason_code, "bad_form_lead_priority_only");
  assert.equal(exact.agent, undefined);

  const contactStore = createRecordingStore({
    formLeads: [formLead({ bad_lead: "spam", normalized_phone_number: "5550001111" })],
  });
  const contact = await resolveLeadIdentity(
    {
      observation: observation({
        contact: { normalized_phone: "5550001111" },
      }),
      policy: formPolicy(),
    },
    contactStore,
  );
  assert.equal(contact.outcome, "pending_match");
  assert.equal(contact.target, undefined);
});

test("conflicting nonempty Job Numbers are a hard conflict", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: {
          normalized_form_ref: "synthetic-tracking-ref-14",
          normalized_job_no: "SYNTH JOB 14A",
        },
      }),
      policy: formPolicy(),
    },
    createRecordingStore({
      formLeads: [formLead({ normalized_job_no: "SYNTH JOB 14B" })],
    }),
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.reason_code, "job_number_conflict");
});

test("Call unique Job wins when Observation phone matches a different Lead", async () => {
  const store = createRecordingStore({
    callLeads: [
      callLead({ normalized_job_no: "SYNTH JOB 14A" }),
      callLead({
        id: CALL_ID_B,
        normalized_phone_number: "5550001111",
      }),
    ],
  });
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        identity: { normalized_job_no: "SYNTH JOB 14A" },
        contact: { normalized_phone: "5550001111" },
      }),
      policy: callPolicy(),
    },
    store,
  );
  assert.equal(result.outcome, "linked");
  assert.equal(result.reason_code, "record_link_confirmed");
  assert.equal(result.match_method, "call_job_no_exact");
  assert.equal(result.target?.id, CALL_ID);
  assert.equal(
    result.candidates.some((candidate) => candidate.target.id === CALL_ID_B),
    false,
  );
  assert.equal(
    store.queries.some((query) => query.kind === "call_scoped_phone"),
    false,
  );
});

test("a duplicate-only Call phone hit cannot receive a new Job", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({ identity: { normalized_job_no: "SYNTH JOB 14A" }, contact: { normalized_phone: "5550001111" } }),
      policy: callPolicy(),
    },
    createRecordingStore({ callLeads: [callLead({ duplicate: true, normalized_phone_number: "5550001111" })] }),
  );
  assert.equal(result.outcome, "pending_match");
  assert.equal(result.target, undefined);
});

test("Call current and ingested phones dedupe to one Lead", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        contact: { normalized_phone: "5550002222" },
      }),
      policy: callPolicy(),
    },
    createRecordingStore({
      callLeads: [
        callLead({
          normalized_phone_number: "5550001111",
          ingested_contact_snapshot: { normalized_phone_number: "5550002222" },
        }),
      ],
    }),
  );
  assert.equal(result.match_method, "source_scoped_contact");
  assert.equal(result.candidates.length, 1);
});

test("[AC-13] more than one active Agent for one username returns no suggestion", async () => {
  const result = await resolveLeadIdentity(
    {
      observation: observation({
        agent_identity: { user_raw: "SYNTHAGENT" },
      }),
      policy: formPolicy(),
    },
    createRecordingStore({
      agents: [
        { id: AGENT_ID, active: true, granot_identity_username: "SYNTHAGENT" },
        {
          id: "64b0000000000000000000a2",
          active: true,
          granot_crm_username: "SYNTHAGENT",
        },
      ],
    }),
  );
  assert.equal(result.agent, undefined);
  assert.equal(result.agent_assertion, "single");
});
