import assert from "node:assert/strict";
import { test } from "node:test";
import { CallLead } from "./CallLead";

function callLeadAttrs(overrides: Record<string, unknown> = {}) {
  return {
    phone_number: "5550100101",
    ...overrides,
  };
}

test("CallLead retains an optional Granot move date without inventing one for undated calls", () => {
  const move = new Date("2026-11-01T00:00:00.000Z");
  const dated = new CallLead(callLeadAttrs({ move_date: move }));
  assert.deepEqual(dated.get("move_date"), move);
  assert.equal(new CallLead(callLeadAttrs()).get("move_date"), undefined);
});

test("[AC-12] Call quoted and ingested snapshot/origin are immutable after insert", async () => {
  const now = new Date("2026-08-17T16:00:00.000Z");
  const lead = new CallLead(
    callLeadAttrs({
      ingestion_origin: "ringcentral",
      ingested_contact_snapshot: {
        phone_number: "5550100101",
        captured_at: now,
        evidence_status: "captured_at_ingestion",
      },
    }),
  );
  await lead.validate();
  assert.equal(lead.quoted, false);
  lead.isNew = false;
  lead.ingestion_origin = "vantage_admin";
  await assert.rejects(() => lead.validate(), /ingestion_origin is immutable/);
});

test("[AC-14] RingCentral original caller evidence is required and immutable", async () => {
  const now = new Date("2026-08-18T16:00:00.000Z");
  const lead = new CallLead(
    callLeadAttrs({
      ingestion_origin: "granot_lead_created",
      ringcentral: {
        ingestion_source: "webhook",
        original_caller: {
          phone_number: "5550002001",
          normalized_phone_number: "5550002001",
          captured_at: now,
        },
      },
    }),
  );
  await lead.validate();
  assert.equal(
    lead.ringcentral?.original_caller?.normalized_phone_number,
    "5550002001",
  );
  const path = CallLead.schema.path("ringcentral.original_caller") as {
    options?: { immutable?: boolean };
  };
  assert.equal(path.options?.immutable, true);
  await assert.rejects(
    () =>
      new CallLead(
        callLeadAttrs({
          ringcentral: {
            ingestion_source: "webhook",
            original_caller: {
              phone_number: "5550002001",
              captured_at: now,
            },
          },
        }),
      ).validate(),
    /normalized_phone_number/,
  );
});
