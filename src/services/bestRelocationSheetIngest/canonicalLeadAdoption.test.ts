import assert from "node:assert/strict";
import test from "node:test";
import { BEST_RELOCATION_CUTOFF } from "./sheets";
import {
  applyCanonicalAdoptionPolicy,
  decideFormLeadAdoption,
  type CanonicalAdoptionStore,
  type CanonicalBookingDoc,
  type CanonicalLeadDoc,
} from "./canonicalLeadAdoption";
import type { BestRelocationApplicationPlan, BestRelocationPlanAction } from "./applicationPlan";

function formDoc(input: Partial<CanonicalLeadDoc> & { id: string }): CanonicalLeadDoc {
  return {
    name: "Alex Rivera",
    phone_number: "3055551212",
    normalized_phone_number: "3055551212",
    timestamp: new Date("2026-06-15T16:00:00.000Z"),
    ref_no: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    lid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...input,
  };
}

function memoryStore(input: {
  forms?: CanonicalLeadDoc[];
  calls?: CanonicalLeadDoc[];
  bookings?: CanonicalBookingDoc[];
  cancellations?: Array<{ id: string; booked_lead: string }>;
}): CanonicalAdoptionStore {
  const forms = input.forms ?? [];
  return {
    async findFormLeadsByIdentity(identities) {
      const keys = new Set(identities.map((value) => value.toLowerCase()));
      return forms.filter(
        (doc) =>
          (doc.ref_no && keys.has(doc.ref_no.toLowerCase())) ||
          (doc.lid && keys.has(doc.lid.toLowerCase())),
      );
    },
    async findFormLeadsByPhoneNameDate() {
      return forms;
    },
    async findCallLeadsByPhoneTimestamp() {
      return input.calls ?? [];
    },
    async findBookingsByJob() {
      return input.bookings ?? [];
    },
    async findCancellationsByBooking(bookingId) {
      return (input.cancellations ?? []).filter((row) => row.booked_lead === bookingId);
    },
  };
}

test("unique Tracking Reference adopts the existing Form Lead and does not create", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      ref_no: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      lid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Alex Rivera",
      phone_number: "305-555-1212",
      timestamp: "2026-06-15T16:00:00.000Z",
    },
    store: memoryStore({ forms: [formDoc({ id: "lead-1" })] }),
  });
  assert.deepEqual(decision, {
    classification: "adopt",
    method: "lid_or_ref",
    refs: [{ model: "FormLead", id: "lead-1" }],
  });
});

test("two Form Leads sharing a Tracking Reference become an ambiguous conflict", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      ref_no: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Alex Rivera",
      phone_number: "305-555-1212",
      timestamp: "2026-06-15T16:00:00.000Z",
    },
    store: memoryStore({
      forms: [
        formDoc({ id: "lead-1" }),
        formDoc({ id: "lead-2" }),
      ],
    }),
  });
  assert.equal(decision.classification, "conflict");
  if (decision.classification === "conflict") {
    assert.equal(decision.type, "ambiguous_lead_match");
    assert.equal(decision.refs?.length, 2);
  }
});

test("phone + name + same New York day adopts when Tracking Reference misses", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      ref_no: "sheet-only-uuid-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      lid: "sheet-only-uuid-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Alex Rivera",
      phone_number: "(305) 555-1212",
      timestamp: "2026-06-15T20:30:00.000Z",
    },
    store: memoryStore({
      forms: [
        formDoc({
          id: "granot-1",
          ref_no: "granot-other-uuid",
          lid: undefined,
        }),
      ],
    }),
  });
  assert.deepEqual(decision, {
    classification: "adopt",
    method: "phone_name_date",
    refs: [{ model: "FormLead", id: "granot-1" }],
  });
});

test("two phone + name + date Form Leads conflict instead of creating", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      name: "Alex Rivera",
      phone_number: "3055551212",
      timestamp: "2026-06-15T16:00:00.000Z",
    },
    store: memoryStore({
      forms: [
        formDoc({ id: "lead-1", ref_no: "one" }),
        formDoc({ id: "lead-2", ref_no: "two" }),
      ],
    }),
  });
  assert.equal(decision.classification, "conflict");
});

test("no identity and no phone-name-date match stays a create", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      ref_no: "new-sheet-uuid",
      name: "New Person",
      phone_number: "7865550000",
      timestamp: "2026-07-01T15:00:00.000Z",
    },
    store: memoryStore({ forms: [] }),
  });
  assert.deepEqual(decision, { classification: "create" });
});

test("pre-cutoff Form Leads are ignored by phone-name-date adoption", async () => {
  const decision = await decideFormLeadAdoption({
    payload: {
      name: "Alex Rivera",
      phone_number: "3055551212",
      timestamp: "2026-06-15T16:00:00.000Z",
    },
    store: memoryStore({
      forms: [
        formDoc({
          id: "old",
          timestamp: new Date("2026-04-29T04:00:00.000Z"),
        }),
      ],
    }),
  });
  assert.deepEqual(decision, { classification: "create" });
  assert.ok(new Date("2026-04-29T04:00:00.000Z").getTime() < BEST_RELOCATION_CUTOFF.getTime());
});

test("canonical adoption remaps remaining creates and leaves receipt outcomes alone", async () => {
  const formCreate = action({
    action_key: "create_form_lead:forms:lead:new",
    command: "create_form_lead",
    classification: "create",
    dataset_key: "forms",
    command_payload: {
      ref_no: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      lid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Alex Rivera",
      phone_number: "3055551212",
      timestamp: "2026-06-15T16:00:00.000Z",
    },
  });
  const alreadyAdopted = action({
    action_key: "create_form_lead:forms:lead:old",
    command: "adopt_existing",
    classification: "adoption",
    dataset_key: "forms",
    adopted_entity_refs: [{ model: "FormLead", id: "kept" }],
  });
  const bookingCreate = action({
    action_key: "create_booked_from_source:booked_deals:booking:P100",
    command: "create_booked_from_source",
    classification: "create",
    dataset_key: "booked_deals",
    command_payload: { job_no: "P100" },
    depends_on: [formCreate.action_key],
  });
  const plan = await applyCanonicalAdoptionPolicy({
    plan: planOf([alreadyAdopted, formCreate, bookingCreate]),
    store: memoryStore({
      forms: [formDoc({ id: "lead-1" })],
      bookings: [{ id: "book-1", normalized_job_no: "P100" }],
    }),
  });
  assert.equal(plan.actions[0].command, "adopt_existing");
  assert.equal(plan.actions[0].adopted_entity_refs?.[0]?.id, "kept");
  assert.equal(plan.actions[1].command, "adopt_existing");
  assert.equal(plan.actions[1].adopted_entity_refs?.[0]?.id, "lead-1");
  assert.equal(plan.actions[1].action_key, formCreate.action_key);
  assert.equal(plan.actions[2].command, "adopt_existing");
  assert.equal(plan.actions[2].adopted_entity_refs?.[0]?.id, "book-1");
  assert.equal(plan.actions[2].depends_on[0], formCreate.action_key);
  assert.equal(plan.counters.adoption, 3);
  assert.equal(plan.counters.create ?? 0, 0);
});

function action(
  input: Partial<BestRelocationPlanAction> &
    Pick<BestRelocationPlanAction, "action_key" | "command" | "classification" | "dataset_key">,
): BestRelocationPlanAction {
  return {
    stable_source_row_id: input.stable_source_row_id ?? input.action_key,
    content_hash: "a".repeat(64),
    schema_profile: `${input.dataset_key}:v2`,
    schema_version: 2,
    provenance: {
      workbook_id: "wb",
      workbook_title: "WB",
      tab: input.dataset_key === "booked_deals" ? "Booked Deals" : "Forms",
      sheet_row: 2,
      source_row_key: input.action_key,
      raw: {},
    },
    depends_on: [],
    ...input,
  };
}

function planOf(actions: BestRelocationPlanAction[]): BestRelocationApplicationPlan {
  return {
    adapter_key: "best_relocation",
    schema_version: 2,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF.toISOString(),
    timezone: "America/New_York",
    source_read_through: "2026-09-03T18:00:00.000Z",
    source_snapshot: {
      leads: { id: "leads", title: "Leads" },
      booked: { id: "booked", title: "Booked" },
    },
    calibration_version: "best-relocation-conservative-v2",
    actions,
    counters: {},
    warnings: [],
  };
}
