import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_NUMBER_CREATED_VIA, resolveCreatedVia } from "../../models/ContactNumber";
import { csiOperatorActor } from "../salesIntelligence/auth";
import { EMPTY_DIRECTORY_LOOKUP } from "./directory";
import { SYNTHETIC_COMPANY_DID, syntheticDirectory } from "./fixtures";
import {
  createdViaForLead, ensureLeadContactNumber, LEAD_NUMBER_AUDIT_EVENT, leadNumberE164, leadNumberMintingEnabled, type LeadNumberStore,
} from "./leadContactNumber";

/** A memory store: what `ensureLeadContactNumber` would read and write in the job's transaction. */
function memoryStore(existing: string[] = [], directory = syntheticDirectory()) {
  const rows: Array<Record<string, unknown>> = [];
  const audits: Array<{ number_id: string; current: Record<string, string> }> = [];
  const store: LeadNumberStore = {
    findByE164: async (e164) => (existing.includes(e164) ? { _id: `existing-${e164}` } : rows.find((row) => row.e164 === e164) ? { _id: "dup" } : null),
    create: async (row) => {
      rows.push(row);
      return { _id: `created-${rows.length}` };
    },
    audit: async (input) => { audits.push(input); },
    directory: async () => directory,
  };
  return { store, rows, audits };
}

const withFormLeadNumbers = async <T>(value: string | undefined, work: () => Promise<T>): Promise<T> => {
  const before = process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS;
  if (value === undefined) delete process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS;
  else process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS = value;
  try {
    return await work();
  } finally {
    if (before === undefined) delete process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS;
    else process.env.SALES_INTELLIGENCE_FORM_LEAD_NUMBERS = before;
  }
};

test("a non-duplicate Lead's live phone is its Contact Number E.164; no move-date gate", () => {
  assert.deepEqual(leadNumberE164("FormLead", { normalized_phone_number: "2025550100" }), { e164: "+12025550100" });
  assert.deepEqual(leadNumberE164("FormLead", { normalized_phone_number: "(202) 555-0100", duplicate: false, bad_lead: null }), { e164: "+12025550100" });
  assert.deepEqual(leadNumberE164("CallLead", { normalized_phone_number: "2025550100", original_caller_phone: "2025550199" }), { e164: "+12025550100" },
    "a Call Lead's live phone wins over its original caller");
  assert.deepEqual(leadNumberE164("CallLead", { normalized_phone_number: null, original_caller_phone: "2025550199" }), { e164: "+12025550199" },
    "a Call Lead without a live phone uses the caller of its creating call");
  assert.deepEqual(leadNumberE164("FormLead", { normalized_phone_number: null, original_caller_phone: "2025550199" }), { skip: "no_phone" },
    "a Form Lead has no creating call");
});

test("duplicates, Bad Leads and unusable phones never mint a Contact Number", () => {
  for (const model of ["FormLead", "CallLead"] as const) {
    assert.deepEqual(leadNumberE164(model, { normalized_phone_number: "2025550100", duplicate: true }), { skip: "duplicate" });
    assert.deepEqual(leadNumberE164(model, { normalized_phone_number: "2025550100", bad_lead: "fake_info" }), { skip: "bad_lead" });
    assert.deepEqual(leadNumberE164(model, { normalized_phone_number: null }), { skip: "no_phone" });
    assert.deepEqual(leadNumberE164(model, { normalized_phone_number: "" }), { skip: "no_phone" });
    assert.deepEqual(leadNumberE164(model, { normalized_phone_number: "12" }), { skip: "no_phone" });
  }
});

test("created_via per model; a Call Lead's number is served as source `call` (admin enum unchanged)", () => {
  assert.equal(createdViaForLead("FormLead"), "form_lead");
  assert.equal(createdViaForLead("CallLead"), "call_lead");
  assert.ok((CONTACT_NUMBER_CREATED_VIA as readonly string[]).includes("call_lead"));
  assert.equal(resolveCreatedVia("call_lead"), "call");
  assert.equal(resolveCreatedVia("form_lead"), "form_lead");
  assert.equal(resolveCreatedVia(undefined), "call");
});

test("Call Leads always mint; Form Leads only behind FORM_LEAD_NUMBERS or force", async () => {
  await withFormLeadNumbers(undefined, async () => {
    assert.equal(leadNumberMintingEnabled("CallLead"), true);
    assert.equal(leadNumberMintingEnabled("FormLead"), false);
    assert.equal(leadNumberMintingEnabled("FormLead", true), true);
    const { store, rows } = memoryStore();
    assert.deepEqual(await ensureLeadContactNumber("FormLead", { _id: "f1", normalized_phone_number: "2025550100" }, null, "job-1", new Date(), { store }),
      { action: "skipped", reason: "disabled" });
    assert.equal(rows.length, 0);
  });
  await withFormLeadNumbers("true", async () => assert.equal(leadNumberMintingEnabled("FormLead"), true));
});

test("a Call Lead with no number mints one: capture's shape, zero calls, created_via call_lead, audited with its model", async () => {
  await withFormLeadNumbers(undefined, async () => {
    const { store, rows, audits } = memoryStore();
    const received = new Date("2026-08-01T15:00:00Z");
    const result = await ensureLeadContactNumber("CallLead", { _id: "c1", timestamp: received, normalized_phone_number: "2025550100" },
      null, "job-1", new Date("2026-10-06T12:00:00Z"), { store });
    assert.deepEqual(result, { action: "created", number_id: "created-1", e164: "+12025550100" });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.created_via, "call_lead");
    assert.equal(row.e164, "+12025550100");
    assert.equal(row.national_ten, "2025550100");
    assert.equal(row.digits_reversed, "00105552021");
    assert.equal(row.summary_version, 1);
    assert.equal(row.revision, 1);
    assert.deepEqual(row.provider_names, []);
    assert.equal(+(row.first_observed_at as Date), +received, "observed at the Lead's received time, not now");
    assert.equal(+(row.last_activity_at as Date), +received);
    assert.ok(!("calls" in row) && !("lead" in row), "the schema defaults give zero calls; the job links it next");
    assert.deepEqual(audits, [{ number_id: "created-1", current: { lead_model: "CallLead", lead_id: "c1", first_observed_at: received.toISOString() } }]);
    assert.equal(LEAD_NUMBER_AUDIT_EVENT, "contact_number_created_from_lead");
  });
});

test("an existing E.164 row is reused untouched; a company DID is skipped; force mints a Form Lead", async () => {
  const existing = memoryStore(["+12025550100"]);
  assert.deepEqual(await ensureLeadContactNumber("CallLead", { _id: "c1", normalized_phone_number: "2025550100" }, null, "job-1", new Date(), { store: existing.store }),
    { action: "reused", number_id: "existing-+12025550100", e164: "+12025550100" });
  assert.equal(existing.rows.length + existing.audits.length, 0, "a reused row is never written");

  const company = memoryStore();
  assert.deepEqual(await ensureLeadContactNumber("CallLead", { _id: "c2", normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2) }, null, "job-1", new Date(),
    { store: company.store }), { action: "skipped", reason: "company_number" });
  assert.equal(company.rows.length, 0);

  const noDirectory = memoryStore([], EMPTY_DIRECTORY_LOOKUP);
  assert.equal((await ensureLeadContactNumber("CallLead", { _id: "c3", normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2) }, null, "job-1", new Date(),
    { store: noDirectory.store })).action, "created", "no directory snapshot: nothing to compare against");

  await withFormLeadNumbers(undefined, async () => {
    const forced = memoryStore();
    const result = await ensureLeadContactNumber("FormLead", { _id: "f1", normalized_phone_number: "2025550111" }, null, "run", new Date(),
      { store: forced.store, force: true, actor: csiOperatorActor("mint-lead-numbers-test") });
    assert.equal(result.action, "created");
    assert.equal(forced.rows[0]!.created_via, "form_lead");
    assert.equal(forced.audits[0]!.current.lead_model, "FormLead");
  });
});

test("skipped Leads never touch the store", async () => {
  const { store, rows, audits } = memoryStore();
  for (const lead of [{ _id: "d", normalized_phone_number: "2025550100", duplicate: true }, { _id: "b", normalized_phone_number: "2025550100", bad_lead: "spam" },
    { _id: "n", normalized_phone_number: null }])
    assert.equal((await ensureLeadContactNumber("CallLead", lead, null, "job-1", new Date(), { store })).action, "skipped");
  assert.equal(rows.length + audits.length, 0);
  await assert.rejects(() => ensureLeadContactNumber("CallLead", { _id: "c", normalized_phone_number: "2025550100" }, null, "job-1"), /needs a session/);
});
