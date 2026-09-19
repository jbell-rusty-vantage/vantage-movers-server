import assert from "node:assert/strict";
import test from "node:test";
import type { Db, Document } from "mongodb";
import { createMongoEvidenceLoader, JobTimelineEvidenceLimitError } from "./mongo-evidence-loader";
import { getRingCentralCollectionName } from "../ringcentral/ringcentral-config";

function fixture(model: "FormLead" | "CallLead"): Record<string, Document[]> {
  return {
    granot_observations: [{_id: "observation", receipt_id: "receipt", granot_crm_source_id: "source", identity: {normalized_job_no: "9001001"}, captured_at: "2026-09-01T00:00:00Z"}],
    granot_record_links: [{_id: "link", normalized_job_no: "9001001", state: "active", lead_ref: {model, id: "lead"}, source_scope: {source_granularity_id: "granularity"}}],
    booked_leads: [{_id: "booking", normalized_job_no: "9001001", lead_ref: "lead", lead_model: model}],
    cancelled_leads: [{_id: "cancellation", booked_lead: "booking", normalized_job_no_snapshot: "9001001"}],
    synchronization_decisions: [{_id: "decision", observation_id: "observation"}],
    granot_webhook_receipts: [{_id: "receipt"}],
    [model === "FormLead" ? "form_leads" : "call_leads"]: [{_id: "lead", source_granularity_id: "granularity"}],
    entity_changes: [{_id: "change", entity: {model, id: "lead"}}],
    lead_messages: [{_id: "message", lead_ref: {model, id: "lead"}}],
    sheet_sync_jobs: [{_id: "sheet", entity_id: "lead"}],
    granot_crm_sources: [{_id: "source", route: {source_granularity_id: "granularity"}}],
    lead_source_granularities: [{_id: "granularity"}],
    wordpress_form_submission_receipts: [{_id: "wordpress", lead_ref: {id: "lead"}}],
    [getRingCentralCollectionName("processedCalls")]: [{_id: "processed", callLeadId: "lead"}],
  };
}

function fakeDb(rows: Record<string, Document[]>) {
  const reads: Array<{collection: string; limit: number | null; timeout: number | null; fetched: number}> = [];
  const db = {collection(name: string) { return {
    findOne: async () => rows[name]?.[0] ?? null,
    find() {
      let limit: number | null = null; let timeout: number | null = null;
      const cursor = {
        project() { return cursor; },
        limit(value: number) { limit = value; return cursor; },
        maxTimeMS(value: number) { timeout = value; return cursor; },
        async toArray() { const result = (rows[name] ?? []).slice(0, limit ?? undefined); reads.push({collection: name, limit, timeout, fetched: result.length}); return result; },
      };
      return cursor;
    },
  }; }} as unknown as Db;
  return {db, reads};
}

test("bounded real timeline loader applies Mongo limit and timeout to every first-hop and downstream cursor", async () => {
  for (const model of ["FormLead", "CallLead"] as const) {
    const {db, reads} = fakeDb(fixture(model));
    const loader = createMongoEvidenceLoader({db, maxRowsPerQuery: 2});
    const rows = await loader.loadRows("9001001");
    await loader.loadCompanyGranularityIds("company");
    assert.equal(rows.leads?.[0]?.model, model);
    assert.ok(reads.length >= 20);
    for (const read of reads) { assert.equal(read.limit, 3, read.collection); assert.equal(read.timeout, 5000, read.collection); assert.ok(read.fetched <= 3); }
  }
});

test("bounded real loader rejects overflow at initial and later joins instead of publishing truncated evidence", async () => {
  for (const collection of ["granot_observations", "synchronization_decisions", "granot_webhook_receipts", "cancelled_leads", "entity_changes", "lead_messages", "wordpress_form_submission_receipts", "sheet_sync_jobs", "granot_crm_sources", "lead_source_granularities"]) {
    const data = fixture("FormLead"); data[collection] = Array.from({length: 30}, (_, index) => ({...data[collection]?.[0], _id: `overflow-${index}`}));
    const {db, reads} = fakeDb(data);
    await assert.rejects(() => createMongoEvidenceLoader({db, maxRowsPerQuery: 2}).loadRows("9001001"), error => error instanceof JobTimelineEvidenceLimitError && error.code === "EVIDENCE_LIMIT_REACHED", collection);
    assert.ok(reads.every(read => read.fetched <= 3));
  }
});

test("optional bound preserves existing unbounded Owner loader behavior and rejects nonsensical configuration", async () => {
  const {db, reads} = fakeDb(fixture("FormLead"));
  await createMongoEvidenceLoader({db}).loadRows("9001001");
  assert.ok(reads.every(read => read.limit === null && read.timeout === null));
  await assert.rejects(() => createMongoEvidenceLoader({db, maxRowsPerQuery: 0}).loadRows("9001001"), /EVIDENCE_LIMIT_REACHED/);
  const overflow = fakeDb({lead_source_granularities: [{_id: "a"}, {_id: "b"}]});
  await assert.rejects(() => createMongoEvidenceLoader({db: overflow.db, maxRowsPerQuery: 1}).loadCompanyGranularityIds("company"), /EVIDENCE_LIMIT_REACHED/);
});
