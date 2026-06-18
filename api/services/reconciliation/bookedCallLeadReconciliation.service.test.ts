import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { CallLead } from "../../models/CallLead";
import { BookedLead } from "../../models/BookedLead";
import { previewBookedCallLeadReconciliation } from "./bookedCallLeadReconciliation.service";

type FindChain = {
  sort: () => FindChain;
  limit: () => FindChain;
  exec: () => Promise<unknown[]>;
};

type StubbedModel = {
  findOne?: unknown;
  find?: unknown;
};

const originalBookedFindOne = BookedLead.findOne as unknown;
const originalCallLeadFind = CallLead.find as unknown;

afterEach(() => {
  (BookedLead as unknown as StubbedModel).findOne = originalBookedFindOne;
  (CallLead as unknown as StubbedModel).find = originalCallLeadFind;
});

test("booked reconciliation can preview phone/source matched unbooked call lead updates", async () => {
  stubBookedLeadMissing();
  stubCallLeadFind((query) => {
    if ("job_no" in query) {
      return [];
    }
    return [
      CallLead.hydrate({
        _id: new mongoose.Types.ObjectId(),
        source_company: "not_provided",
        phone_number: "(555) 111-2222",
        normalized_phone_number: "5551112222",
        timestamp: new Date("2026-05-20T12:00:00Z"),
      }),
    ];
  });

  const [result] = await previewBookedCallLeadReconciliation({
    rows: [
      {
        row_id: "booked-1",
        section: "bookedJobs",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
        customer: "Jane Customer",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.equal(result.booking_id, undefined);
  assert.ok(result.call_lead_id);
  assert.deepEqual(result.changes.sort(), [
    "lead.job_no",
    "lead.name",
    "lead.source_company",
  ]);
  assert.match(result.warnings.join(" "), /Claiming unassigned call lead source_company as main_site/);
});

test("booked reconciliation does not globally phone-match across assigned source companies", async () => {
  stubBookedLeadMissing();
  stubCallLeadFind((query) => {
    if ("job_no" in query) {
      return [];
    }
    return [
      CallLead.hydrate({
        _id: new mongoose.Types.ObjectId(),
        source_company: "top10_leads",
        phone_number: "5551112222",
        normalized_phone_number: "5551112222",
        timestamp: new Date("2026-05-20T12:00:00Z"),
      }),
    ];
  });

  const [result] = await previewBookedCallLeadReconciliation({
    rows: [
      {
        row_id: "booked-2",
        section: "bookedJobs",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
      },
    ],
  });

  assert.equal(result.status, "no_match");
  assert.match(result.message, /no candidate had source_company main_site/i);
});

test("booked reconciliation warns but allows idempotent sync when phone-matched lead has a different job_no", async () => {
  stubBookedLeadMissing();
  stubCallLeadFind((query) => {
    if ("job_no" in query) {
      return [];
    }
    return [
      CallLead.hydrate({
        _id: new mongoose.Types.ObjectId(),
        source_company: "main_site",
        phone_number: "5551112222",
        normalized_phone_number: "5551112222",
        job_no: "P999",
        timestamp: new Date("2026-05-20T12:00:00Z"),
      }),
    ];
  });

  const [result] = await previewBookedCallLeadReconciliation({
    rows: [
      {
        row_id: "booked-3",
        section: "bookedJobs",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
      },
    ],
  });

  assert.notEqual(result.status, "conflict");
  assert.equal(result.match_method, "phone_only");
  assert.equal(result.has_booking, false);
  assert.match(
    result.warnings.join(" "),
    /Existing call lead already has job_no P999/,
  );
  assert.ok(
    !result.changes.includes("lead.job_no"),
    "job_no should be left as-is during sync to avoid clobbering existing value",
  );
});

test("booked reconciliation prefers phone/source candidates without conflicting job_no", async () => {
  stubBookedLeadMissing();
  const safeLeadId = new mongoose.Types.ObjectId();
  stubCallLeadFind((query) => {
    if ("job_no" in query) {
      return [];
    }
    return [
      CallLead.hydrate({
        _id: new mongoose.Types.ObjectId(),
        source_company: "main_site",
        phone_number: "5551112222",
        normalized_phone_number: "5551112222",
        job_no: "P999",
        timestamp: new Date("2026-05-21T12:00:00Z"),
      }),
      CallLead.hydrate({
        _id: safeLeadId,
        source_company: "main_site",
        phone_number: "5551112222",
        normalized_phone_number: "5551112222",
        timestamp: new Date("2026-05-20T12:00:00Z"),
      }),
    ];
  });

  const [result] = await previewBookedCallLeadReconciliation({
    rows: [
      {
        row_id: "booked-4",
        section: "bookedJobs",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.equal(result.call_lead_id, safeLeadId.toString());
  assert.ok(result.changes.includes("lead.job_no"));
});

function stubBookedLeadMissing() {
  (BookedLead as unknown as { findOne: () => Promise<null> }).findOne = async () => null;
}

function stubCallLeadFind(resolve: (query: Record<string, unknown>) => unknown[]) {
  (CallLead as unknown as { find: (query: Record<string, unknown>) => FindChain }).find = ((
    query: Record<string, unknown>,
  ) => {
    const chain: FindChain = {
      sort: () => chain,
      limit: () => chain,
      exec: async () => resolve(query),
    };
    return chain;
  });
}
