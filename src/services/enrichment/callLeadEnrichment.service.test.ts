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

test("preview does not write live phone, name, or email", async () => {
  const leadId = new mongoose.Types.ObjectId();
  stubCallLeadFind((query) => {
    if (isJobQuery(query)) {
      return [
        CallLead.hydrate({
          _id: leadId,
          source_company: "main_site",
          source_granularity_key: "main_site_call",
          crm_source_label_snapshot: "Main Site Inbounds",
          job_no: "P123",
          name: "Called Name",
          email: "called@example.invalid",
          phone_number: "5551112222",
          normalized_phone_number: "5551112222",
          timestamp: new Date("2026-05-20T12:00:00Z"),
        }),
      ];
    }
    return [];
  });

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-live-contact",
        job_no: "P123",
        source: "Main Site Inbounds",
        phone: "555-000-9999",
        customer: "Granot Name",
        email: "granot@example.invalid",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.equal(result.call_lead_id, leadId.toString());
  assert.equal(result.match_method, "job_no_only");
  assert.ok(!result.changes.includes("phone_number"));
  assert.ok(!result.changes.includes("normalized_phone_number"));
  assert.ok(!result.changes.includes("name"));
  assert.ok(!result.changes.includes("email"));
});

test("conflicting stored Job Number is not overwritten", async () => {
  const leadId = new mongoose.Types.ObjectId();
  stubCallLeadFind((query) => {
    if (isJobQuery(query)) return [];
    return [
      CallLead.hydrate({
        _id: leadId,
        source_company: "main_site",
        source_granularity_key: "main_site_call",
        crm_source_label_snapshot: "Main Site Inbounds",
        job_no: "JOB-OLD",
        phone_number: "5551112222",
        normalized_phone_number: "5551112222",
        timestamp: new Date("2026-05-20T12:00:00Z"),
      }),
    ];
  });

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-job-conflict",
        job_no: "JOB-NEW",
        source: "Main Site Inbounds",
        phone: "555-111-2222",
      },
    ],
  });

  assert.equal(result.call_lead_id, leadId.toString());
  assert.ok(!result.changes.includes("job_no"));
  assert.match(result.warnings.join(" "), /already has job_no JOB-OLD/i);
});

test("row Job on Lead A plus Granot phone equal to Lead B ANI selects A", async () => {
  const leadAId = new mongoose.Types.ObjectId();
  const leadBId = new mongoose.Types.ObjectId();
  const leadA = CallLead.hydrate({
    _id: leadAId,
    source_company: "main_site",
    source_granularity_key: "main_site_call",
    crm_source_label_snapshot: "Main Site Inbounds",
    job_no: "JOB-A",
    phone_number: "5550001111",
    normalized_phone_number: "5550001111",
    timestamp: new Date("2026-05-21T12:00:00Z"),
  });
  const leadB = CallLead.hydrate({
    _id: leadBId,
    source_company: "main_site",
    source_granularity_key: "main_site_call",
    crm_source_label_snapshot: "Main Site Inbounds",
    phone_number: "5550002222",
    normalized_phone_number: "5550002222",
    timestamp: new Date("2026-05-20T12:00:00Z"),
  });

  stubCallLeadFind((query) => {
    if (isJobQuery(query)) return [leadA];
    if (isPhoneQuery(query)) return [leadB];
    return [];
  });

  const [result] = await previewCallLeadEnrichment({
    rows: [
      {
        row_id: "follow-steal",
        job_no: "JOB-A",
        source: "Main Site Inbounds",
        phone: "555-000-2222",
        customer: "Granot Card",
      },
    ],
  });

  assert.equal(result.status, "updateable");
  assert.equal(result.call_lead_id, leadAId.toString());
  assert.notEqual(result.call_lead_id, leadBId.toString());
  assert.equal(result.match_method, "job_no_only");
});

function isJobQuery(query: Record<string, unknown>): boolean {
  return "job_no" in query && !Array.isArray(query.$or);
}

function isPhoneQuery(query: Record<string, unknown>): boolean {
  return Array.isArray(query.$or);
}

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
