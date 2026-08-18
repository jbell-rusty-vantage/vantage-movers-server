import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRingCentralCallLeadDuplicate as classifyRingCentralCallLeadDuplicateStrict,
  RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS,
  type RingCentralDuplicateDeps,
  type RingCentralDuplicateInput,
} from "./ringcentral-duplicate-guard";
import { toFloridaTimestamp } from "../../utils/easternTime";

const NOW = new Date("2026-06-03T18:00:00.000Z");
const STORED_NOW = toFloridaTimestamp(NOW);
const CALLER = "+12095551234";
const WINDOW_MS = RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SOURCE_GRANULARITY_ID = "507f1f77bcf86cd799439011";

function classifyRingCentralCallLeadDuplicate(
  input: Omit<RingCentralDuplicateInput, "sourceGranularityId">,
  deps: RingCentralDuplicateDeps,
) {
  return classifyRingCentralCallLeadDuplicateStrict(
    { ...input, sourceGranularityId: SOURCE_GRANULARITY_ID },
    deps,
  );
}

type CapturedDuplicateLookup = {
  sourceCompany: string;
  sourceGranularityId: unknown;
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

test("[AC-15] the same call-log identity is not counted as its own duplicate", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      callTimestamp: NOW,
      telephonySessionId: null,
      sessionId: "session-current",
      callLogId: "call-log-current",
    },
    {
      findRecentCallLeads: async () => [
        {
          _id: { toString: () => "lead-current" },
          phone_number: CALLER,
          ringcentral: {
            session_id: "session-current",
            call_log_id: "call-log-current",
          },
        },
      ],
    },
  );
  assert.equal(result.isDuplicate, false);
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

test("duplicate lookup uses the earlier-only 90-day window", async () => {
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
  assert.equal(capturedLookup.sourceGranularityId, SOURCE_GRANULARITY_ID);
  assert.equal(capturedLookup.normalizedPhone, "2095551234");
  assert.equal(capturedLookup.from.toISOString(), new Date(STORED_NOW.getTime() - WINDOW_MS).toISOString());
  assert.equal(capturedLookup.to.toISOString(), STORED_NOW.toISOString());
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

test("[AC-15] adopted Lead id is excluded from duplicate classification", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-adopted",
      callLeadIdToExclude: "lead-adopted",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async ({ callLeadIdToExclude }) => {
        assert.equal(callLeadIdToExclude, "lead-adopted");
        return [
          {
            _id: { toString: () => "lead-adopted" },
            phone_number: CALLER,
          },
        ];
      },
    },
  );
  assert.equal(result.isDuplicate, false);
  assert.equal(result.reason, "unique");
});

test("[AC-15][AC-16] unresolved Granot candidates do not create false duplicates", async () => {
  for (const state of ["pending", "conflict"] as const) {
    const result = await classifyRingCentralCallLeadDuplicate(
      {
        sourceCompany: "top10_leads",
        callerPhoneNumber: CALLER,
        telephonySessionId: "session-current",
        callTimestamp: NOW,
      },
      {
        findRecentCallLeads: async () => [
          {
            _id: { toString: () => `lead-${state}` },
            phone_number: CALLER,
            ingestion_origin: "granot_lead_created",
            ringcentral_convergence: { state },
          },
        ],
      },
    );
    assert.equal(result.isDuplicate, false);
  }
});

test("[AC-15] adopted Granot candidate from another physical call remains eligible", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-current",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async () => [
        {
          _id: { toString: () => "lead-prior-adopted" },
          phone_number: CALLER,
          ingestion_origin: "granot_lead_created",
          ringcentral_convergence: { state: "adopted" },
          ringcentral: { telephony_session_id: "session-prior" },
        },
      ],
    },
  );
  assert.equal(result.isDuplicate, true);
  assert.equal(result.existingLeadId, "lead-prior-adopted");
});

test("[AC-15] future Leads are outside the earlier-only duplicate window", async () => {
  const result = await classifyRingCentralCallLeadDuplicate(
    {
      sourceCompany: "top10_leads",
      callerPhoneNumber: CALLER,
      telephonySessionId: "session-current",
      callTimestamp: NOW,
    },
    {
      findRecentCallLeads: async ({ to }) => {
        assert.equal(to.toISOString(), STORED_NOW.toISOString());
        return [];
      },
    },
  );
  assert.equal(result.isDuplicate, false);
});
