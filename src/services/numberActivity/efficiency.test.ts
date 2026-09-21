import assert from "node:assert/strict";
import test from "node:test";
import { CALL_INTERACTION_INDEXES } from "../../models/CallInteraction";
import { CONTACT_NUMBER_INDEXES } from "../../models/ContactNumber";
import { LEAD_CONVERSATION_INDEXES } from "../../models/LeadConversation";
import { SALES_INTELLIGENCE_JOB_INDEXES } from "../../models/salesIntelligence/infrastructure";
import {
  CALL_LEAD_ATTACHMENT_PHONE_PATHS,
  FORM_LEAD_ATTACHMENT_PHONE_PATHS,
  leadPhoneMatchClauses,
} from "../../models/leadContactPhoneIndexes";
import { numberLookupDigits } from "../salesIntelligence/attachment/refresh";
import { MAX_SEARCH_TERMS, addObservedSearchTerm, boundSearchTerms } from "./searchTerms";

/**
 * CSI-14 efficiency contracts. These are the invariants the recommendation
 * turns on, expressed where they can be checked without a replica set.
 */

const indexNames = (indexes: readonly { name: string }[]) => indexes.map((i) => i.name);
const keyOf = (indexes: readonly { name: string; key: object }[], name: string) =>
  indexes.find((i) => i.name === name)?.key;

// --- 14 §6: one cap, one owner for `search_terms` --------------------------

test("capture never evicts a lead-derived search term (14 §6)", () => {
  // The regression: the attachment and rebuild paths filled the set to fifty
  // from the attached Leads, then the next call on the number shifted it down
  // to twenty and dropped the oldest thirty -- typically the Job Numbers and
  // customer names that make the number findable at all.
  const leadTerms = Array.from({ length: MAX_SEARCH_TERMS }, (_, i) => `job-${1000 + i}`);
  const afterCall = addObservedSearchTerm(leadTerms, "Acme Relocation");

  assert.equal(afterCall.length, MAX_SEARCH_TERMS, "the set never grows past the shared cap");
  for (const term of leadTerms) {
    assert.ok(afterCall.includes(term), `capture must not evict the lead-derived term ${term}`);
  }
  assert.ok(
    !afterCall.includes("acme relocation"),
    "at the cap the provider name is deferred to the owning rebuild, not traded for a Job Number",
  );
});

test("capture adds an observed provider name below the cap, once, lowercased", () => {
  assert.deepEqual(addObservedSearchTerm([], "Acme Relocation"), ["acme relocation"]);
  assert.deepEqual(addObservedSearchTerm(["acme relocation"], "ACME Relocation"), ["acme relocation"], "idempotent");
  assert.deepEqual(addObservedSearchTerm(["a"], null), ["a"]);
  assert.deepEqual(addObservedSearchTerm(["a"], "   "), ["a"]);
});

test("the owning rebuild bounds, dedupes and lowercases the whole set", () => {
  assert.deepEqual(boundSearchTerms([" Smith ", "SMITH", "job-1"]), ["smith", "job-1"]);
  assert.equal(boundSearchTerms(Array.from({ length: 200 }, (_, i) => `t${i}`)).length, MAX_SEARCH_TERMS);
  assert.deepEqual(boundSearchTerms(["", "   "]), [], "blank terms are not searchable");
});

// --- 14 §3: the attachment scan is a keyed lookup, not a corpus walk -------

test("a number scan asks the phone index for its own join key (14 §3)", () => {
  assert.deepEqual(numberLookupDigits({ national_ten: "5550100200", e164: "+15550100200" }), ["5550100200"],
    "NANP numbers join on the ten-digit form the Lead collections store");
  assert.deepEqual(numberLookupDigits({ national_ten: null, e164: "+442071838750" }), ["442071838750"],
    "outside NANP the E.164 digit string is the stored form; attaching nothing would be worse");
  assert.deepEqual(numberLookupDigits({ national_ten: null, e164: null }), [],
    "no key means no scan, never an unfiltered walk of the corpus");
});

test("every contact path phoneEvidence reads is a lookup clause on both models", () => {
  const form = leadPhoneMatchClauses("FormLead", ["5550100200"]);
  assert.deepEqual(form, FORM_LEAD_ATTACHMENT_PHONE_PATHS.map((p) => ({ [p]: "5550100200" })));

  const call = leadPhoneMatchClauses("CallLead", ["5550100200"]);
  assert.equal(call.length, CALL_LEAD_ATTACHMENT_PHONE_PATHS.length);
  assert.ok(
    CALL_LEAD_ATTACHMENT_PHONE_PATHS.includes("ringcentral.original_caller.normalized_phone_number"),
    "the RingCentral original caller is a Call Lead contact path",
  );
  assert.deepEqual(leadPhoneMatchClauses("FormLead", []), [], "no digits means no clauses");
  assert.deepEqual(leadPhoneMatchClauses("FormLead", ["  "]), []);
});

// --- 14 §8/§9: filtered listings carry their sort in the index -------------

test("every selective number-search prefix carries the listing sort (14 §8)", () => {
  for (const name of [
    "contact_number_digits_activity",
    "contact_number_terms_activity",
    "contact_number_classification_activity_id",
    "contact_number_kind_activity",
  ]) {
    const key = keyOf(CONTACT_NUMBER_INDEXES, name) as Record<string, number> | undefined;
    assert.ok(key, `${name} is registered`);
    const tail = Object.entries(key!).slice(-2);
    assert.deepEqual(tail, [["last_activity_at", -1], ["_id", -1]], `${name} carries the keyset sort`);
  }
});

test("timeline sources read by number with the total order in the index (14 §9)", () => {
  assert.deepEqual(keyOf(CALL_INTERACTION_INDEXES, "call_interaction_number_started_id"), {
    contact_number_id: 1,
    started_at: -1,
    _id: -1,
  });
  assert.deepEqual(keyOf(LEAD_CONVERSATION_INDEXES, "lead_conversation_number_started"), {
    contact_number_id: 1,
    started_at: -1,
    _id: -1,
  });
});

test("the Coverage counters and the job claim are index-served (14 §1, §7)", () => {
  assert.ok(indexNames(CALL_INTERACTION_INDEXES).includes("call_interaction_discovery_state"));
  assert.ok(indexNames(LEAD_CONVERSATION_INDEXES).includes("lead_conversation_eligibility"));
  assert.ok(indexNames(LEAD_CONVERSATION_INDEXES).includes("lead_conversation_media_stored"));

  // The claim leads with the dataset and stage, then sorts
  // `priority desc, next_attempt_at asc, _id asc`.
  assert.deepEqual(keyOf(SALES_INTELLIGENCE_JOB_INDEXES, "csi_job_claim"), {
    deployment: 1,
    database: 1,
    stage: 1,
    status: 1,
    priority: -1,
    next_attempt_at: 1,
    _id: 1,
  });

  const ttl = SALES_INTELLIGENCE_JOB_INDEXES.find((i) => i.name === "csi_job_completed_ttl");
  assert.deepEqual(ttl?.key, { completed_at: 1 }, "TTL keys off a field only completion writes");
  assert.ok((ttl?.expireAfterSeconds ?? 0) > 0, "completed queue rows are not kept forever");
});
