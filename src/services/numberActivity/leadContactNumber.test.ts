import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_COMPANY_DID, syntheticDirectory } from "./fixtures";
import {
  ensureLeadContactNumber,
  leadNumberE164s,
  leadNumberMintingEnabled,
  leadPhoneE164,
  leadPhoneE164Candidates,
  leadPhonesOf,
  type LeadNumberStore,
} from "./leadContactNumber";
import { leadPhoneE164s, type LeadRow } from "./leadLink";

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

test("olr CW1: one phone rule: live, original caller (Call Leads), intake snapshot, Granot snapshot; as a set the link's own leadPhoneE164s", () => {
  const all = { normalized_phone_number: "2025550101", original_caller_phone: "2025550102", ingested_phone: "2025550103", granot_phone: "2025550104" };
  assert.deepEqual(leadPhoneE164Candidates("CallLead", all), ["+12025550101", "+12025550102", "+12025550103", "+12025550104"]);
  assert.deepEqual(leadPhoneE164Candidates("FormLead", all), ["+12025550101", "+12025550103", "+12025550104"]);
  assert.deepEqual(leadPhoneE164Candidates("FormLead", { ingested_phone: "2025550103", granot_phone: "(202) 555-0103" }), ["+12025550103"], "deduplicated");
  assert.deepEqual(leadNumberE164s("FormLead", { normalized_phone_number: null, granot_phone: "2025550104" }), { e164s: ["+12025550104"] },
    "a Lead whose only usable phone is a snapshot still gets a number (the diagnostic counts it as a phone)");
  assert.deepEqual(leadNumberE164s("CallLead", { normalized_phone_number: "12", ingested_phone: "" }), { skip: "no_phone" });
  assert.equal(leadPhoneE164("CallLead", { ingested_phone: "2025550103", granot_phone: "2025550104" }), "+12025550103");
  assert.equal(leadPhoneE164("FormLead", {}), null);
  const rows: LeadRow[] = [
    { _id: "a", normalized_phone_number: "2025550101", ingested_contact_snapshot: { normalized_phone_number: "2025550103" },
      granot_contact_snapshot: { normalized_phone_number: "2025550104" }, ringcentral: { original_caller: { normalized_phone_number: "2025550102" } } },
    { _id: "b", granot_contact_snapshot: { normalized_phone_number: "2025550104" } },
    { _id: "c", normalized_phone_number: "12", ingested_contact_snapshot: { normalized_phone_number: "2025550103" } },
    { _id: "d" },
  ];
  for (const row of rows)
    assert.deepEqual([...leadPhoneE164Candidates("CallLead", leadPhonesOf(row))].sort(), [...leadPhoneE164s(row)].sort(), `row ${String(row._id)}: mint and link agree`);
});

test("duplicates, Bad Leads and unusable phones never mint a Contact Number", () => {
  for (const model of ["FormLead", "CallLead"] as const) {
    assert.deepEqual(leadNumberE164s(model, { normalized_phone_number: "2025550100", duplicate: true }), { skip: "duplicate" });
    assert.deepEqual(leadNumberE164s(model, { normalized_phone_number: "2025550100", bad_lead: "fake_info" }), { skip: "bad_lead" });
    assert.deepEqual(leadNumberE164s(model, { normalized_phone_number: null }), { skip: "no_phone" });
    assert.deepEqual(leadNumberE164s(model, { normalized_phone_number: "" }), { skip: "no_phone" });
    assert.deepEqual(leadNumberE164s(model, { normalized_phone_number: "12" }), { skip: "no_phone" });
  }
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

test("olr CW1: the mint numbers a snapshot-only Lead, keeps the live phone first, and passes over a DID to the next phone", async () => {
  const snapshotOnly = memoryStore();
  assert.deepEqual(await ensureLeadContactNumber("CallLead", { _id: "s1", normalized_phone_number: null, granot_phone: "2025550104" }, null, "job-1", new Date(),
    { store: snapshotOnly.store }), { action: "created", number_id: "created-1", e164: "+12025550104" });

  const snapshotNumbered = memoryStore(["+12025550103"]);
  assert.deepEqual(await ensureLeadContactNumber("CallLead", { _id: "s2", normalized_phone_number: "2025550101", ingested_phone: "2025550103" }, null, "job-1",
    new Date(), { store: snapshotNumbered.store }), { action: "created", number_id: "created-1", e164: "+12025550101" }, "the live phone still gets its number");

  const liveIsDid = memoryStore(["+12025550103"]);
  assert.deepEqual(await ensureLeadContactNumber("CallLead", { _id: "s3", normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2), ingested_phone: "2025550103" },
    null, "job-1", new Date(), { store: liveIsDid.store }), { action: "reused", number_id: "existing-+12025550103", e164: "+12025550103" });
  assert.equal(liveIsDid.rows.length, 0);
});
