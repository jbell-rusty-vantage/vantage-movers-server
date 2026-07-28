import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { CallLead } from "../../models/CallLead";
import {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
} from "./callLeadEnrichment.service";

type FindChain = {
  sort: () => FindChain;
  limit: () => FindChain;
  exec: () => Promise<unknown[]>;
};

type StubbedModel = {
  find?: unknown;
};

const originalCallLeadFind = CallLead.find as unknown;

afterEach(() => {
  (CallLead as unknown as StubbedModel).find = originalCallLeadFind;
});

test("call lead enrichment prefers source-compatible phone matches", async () => {
  const tbmLeadId = new mongoose.Types.ObjectId();
  const mainSiteLeadId = new mongoose.Types.ObjectId();
  stubCallLeadFind(() => [
    CallLead.hydrate({
      _id: mainSiteLeadId,
      source_company: "main_site",
      source_granularity_key: "main_site_call",
      crm_source_label_snapshot: "Main Site Inbounds",
      phone_number: "+18314281319",
      normalized_phone_number: "8314281319",
      timestamp: new Date("2026-07-28T02:00:30.402Z"),
      createdAt: new Date("2026-07-28T02:00:30.402Z"),
    }),
    CallLead.hydrate({
      _id: tbmLeadId,
      source_company: "tbm_leads",
      source_granularity_key: "tbm_leads_call",
      crm_source_label_snapshot: "10best Inbounds",
      phone_number: "+18314281319",
      normalized_phone_number: "8314281319",
      timestamp: new Date("2026-07-28T00:00:29.847Z"),
      createdAt: new Date("2026-07-28T00:00:29.847Z"),
    }),
  ]);

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-1",
        job_no: "P5561092",
        source: "10best Inbounds",
        phone: "8314281319",
        customer: "Omar Solis",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.equal(result.call_lead_id, tbmLeadId.toString());
  assert.equal(result.match_method, "phone_only");
  assert.ok(result.changes.includes("job_no"));
  assert.ok(!result.changes.includes("source_company"));
  assert.match(
    result.warnings.join(" "),
    /selected newest eligible lead with matching source 10best Inbounds/i,
  );
});

test("call lead enrichment blocks sync when phone matches only across assigned source companies", async () => {
  stubCallLeadFind(() => [
    CallLead.hydrate({
      _id: new mongoose.Types.ObjectId(),
      source_company: "main_site",
      source_granularity_key: "main_site_call",
      crm_source_label_snapshot: "Main Site Inbounds",
      phone_number: "+18314281319",
      normalized_phone_number: "8314281319",
      timestamp: new Date("2026-07-28T02:00:30.402Z"),
    }),
  ]);

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-2",
        job_no: "P5561092",
        source: "10best Inbounds",
        phone: "8314281319",
      },
    ],
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.call_lead_id, undefined);
  assert.match(result.message, /CRM row source maps to 10best Inbounds/i);
  assert.deepEqual(result.changes, []);
});

test("syncCallLeadEnrichment does not write when source match is conflict", async () => {
  stubCallLeadFind(() => [
    CallLead.hydrate({
      _id: new mongoose.Types.ObjectId(),
      source_company: "main_site",
      source_granularity_key: "main_site_call",
      crm_source_label_snapshot: "Main Site Inbounds",
      phone_number: "+18314281319",
      normalized_phone_number: "8314281319",
      timestamp: new Date("2026-07-28T02:00:30.402Z"),
    }),
  ]);

  const [result] = await syncCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-sync-conflict",
        job_no: "P5561092",
        source: "10best Inbounds",
        phone: "8314281319",
      },
    ],
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.call_lead_id, undefined);
  assert.deepEqual(result.changes, []);
  assert.match(result.message, /CRM row source maps to 10best Inbounds/i);
});

test("call lead enrichment can claim an unassigned phone-matched call lead source", async () => {
  stubCallLeadFind(() => [
    CallLead.hydrate({
      _id: new mongoose.Types.ObjectId(),
      source_company: "not_provided",
      phone_number: "5551112222",
      normalized_phone_number: "5551112222",
      timestamp: new Date("2026-05-20T12:00:00Z"),
    }),
  ]);

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-3",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.ok(result.changes.includes("source_company"));
  assert.match(
    result.warnings.join(" "),
    /Claiming unassigned call lead source as Main Site Inbounds/,
  );
});

function stubCallLeadFind(
  resolver: (query: Record<string, unknown>) => unknown[],
) {
  (CallLead as unknown as { find: (query: Record<string, unknown>) => FindChain }).find = ((
    query: Record<string, unknown>,
  ) => {
    const chain: FindChain = {
      sort: () => chain,
      limit: () => chain,
      exec: async () => resolver(query),
    };
    return chain;
  });
}
