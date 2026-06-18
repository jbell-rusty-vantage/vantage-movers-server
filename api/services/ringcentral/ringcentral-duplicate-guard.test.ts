import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRingCentralCallLeadDuplicate,
  RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS,
} from "./ringcentral-duplicate-guard";
import { toFloridaTimestamp } from "../../utils/easternTime";

const NOW = new Date("2026-06-03T18:00:00.000Z");
const STORED_NOW = toFloridaTimestamp(NOW);
const CALLER = "+12095551234";
const WINDOW_MS = RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type CapturedDuplicateLookup = {
  sourceCompany: string;
  normalizedPhone: string;
  from: Date;
  to: Date;
};

test("first call from a caller is unique", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-1",
      callTimestamp: NOW,
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
      callTimestamp: NOW,
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
      callTimestamp: NOW,
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
      callTimestamp: NOW,
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
      callTimestamp: NOW,
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

test("duplicate lookup uses the 90-day window around the call timestamp", async () => {
  const captured: CapturedDuplicateLookup[] = [];

  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-2",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async (params) => {
        captured.push(params);
        return [
          {
            _id: { toString: () => "lead-90-days" },
            phone_number: CALLER,
            ringcentral: { telephony_session_id: "session-1" },
          },
        ];
      },
    },
  );

  assert.equal(result.isDuplicate, true);
  assert.equal(result.windowDays, 90);
  assert.equal(captured.length, 1);
  const capturedLookup = captured[0]!;
  assert.equal(capturedLookup.sourceCompany, "top10_leads");
  assert.equal(capturedLookup.normalizedPhone, "2095551234");
  assert.equal(capturedLookup.from.toISOString(), new Date(STORED_NOW.getTime() - WINDOW_MS).toISOString());
  assert.equal(capturedLookup.to.toISOString(), new Date(STORED_NOW.getTime() + WINDOW_MS).toISOString());
});

test("same caller and source exactly 90 days apart is a duplicate", async () => {
  const boundaryLeadTimestamp = new Date(STORED_NOW.getTime() - WINDOW_MS);

  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-2",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async ({ from, to }) => {
        assert.equal(boundaryLeadTimestamp.getTime() >= from.getTime(), true);
        assert.equal(boundaryLeadTimestamp.getTime() <= to.getTime(), true);
        return [
          {
            _id: { toString: () => "lead-boundary" },
            phone_number: CALLER,
            ringcentral: { telephony_session_id: "session-1" },
          },
        ];
      },
    },
  );

  assert.equal(result.isDuplicate, true);
  assert.equal(result.existingLeadId, "lead-boundary");
});

test("same caller and source more than 90 days apart is unique", async () => {
  const olderLeadTimestamp = new Date(STORED_NOW.getTime() - WINDOW_MS - 1);

  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-2",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async ({ from, to }) => {
        assert.equal(olderLeadTimestamp.getTime() < from.getTime(), true);
        assert.equal(olderLeadTimestamp.getTime() <= to.getTime(), true);
        return [];
      },
    },
  );

  assert.equal(result.isDuplicate, false);
  assert.equal(result.reason, "unique");
});

test("different source is scoped out by the duplicate lookup", async () => {
  let capturedSourceCompany: string | null = null;

  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-2",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async ({ sourceCompany }) => {
        capturedSourceCompany = sourceCompany;
        return [];
      },
    },
  );

  assert.equal(capturedSourceCompany, "top10_leads");
  assert.equal(result.isDuplicate, false);
});
