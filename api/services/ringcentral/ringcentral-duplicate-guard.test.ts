import assert from "node:assert/strict";
import test from "node:test";
import { classifyRingCentralCallLeadDuplicate } from "./ringcentral-duplicate-guard";

const NOW = new Date("2026-06-03T18:00:00.000Z");
const CALLER = "+12095551234";

test("first call from a caller is unique", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-1",
      now: NOW,
    },
    { findRecentCallLeads: async () => [] },
  );

  assert.equal(result.isDuplicate, false);
  assert.equal(result.reason, "unique");
  assert.equal(result.existingLeadId, null);
});

test("a second call from the same caller + source within the window is a duplicate", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-2",
      now: NOW,
    },
    {
      findRecentCallLeads: async () => [
        {
          _id: { toString: () => "lead-1" },
          phone_number: CALLER,
          ringcentral: { telephony_session_id: "session-1" },
        },
      ],
    },
  );

  assert.equal(result.isDuplicate, true);
  assert.equal(result.reason, "same_source_phone_within_window");
  assert.equal(result.existingLeadId, "lead-1");
});

test("the same telephony session is not counted as its own duplicate", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-1",
      now: NOW,
    },
    {
      findRecentCallLeads: async () => [
        {
          _id: { toString: () => "lead-1" },
          phone_number: CALLER,
          ringcentral: { telephony_session_id: "session-1" },
        },
      ],
    },
  );

  assert.equal(result.isDuplicate, false);
  assert.equal(result.reason, "unique");
});

test("a call with no caller phone cannot be classified as a duplicate", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: null,
      now: NOW,
    },
    { findRecentCallLeads: async () => [] },
  );

  assert.equal(result.isDuplicate, false);
  assert.equal(result.reason, "no_caller_phone");
});

test("phone numbers in different formats still match as duplicates", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: "+12095551234",
      telephonySessionId: "session-2",
      now: NOW,
    },
    {
      findRecentCallLeads: async () => [
        {
          _id: { toString: () => "lead-2" },
          phone_number: "(209) 555-1234",
          ringcentral: { telephony_session_id: "session-1" },
        },
      ],
    },
  );

  assert.equal(result.isDuplicate, true);
});
