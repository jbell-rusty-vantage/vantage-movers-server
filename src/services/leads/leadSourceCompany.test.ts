import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLeadSourceAssignment } from "./leadSourceCompany";

test("lead source assignment persists owner-created registry sources", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await resolveLeadSourceAssignment(
    {
      value: "Owner Created",
      company_slug: "owner_created",
      granularity_key: "owner_created_form",
      channel: "form",
    },
    {
      resolver: async (input) => {
        calls.push(input);
        return {
          company_id: "66a93fd65dcb6f7a26d73001",
          company_slug: "owner_created",
          company_label_snapshot: "Owner Created",
          granularity_id: "66a93fd65dcb6f7a26d73002",
          granularity_key: "owner_created_form",
          granularity_label_snapshot: "Owner Created Forms",
          crm_label_snapshot: "Owner Created Forms",
          match_kind: "exact",
          registry_revision: 3,
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.company_slug, "owner_created");
  assert.equal(result.assignment.source_company, "owner_created");
  assert.equal(
    result.assignment.lead_source_company.toString(),
    "66a93fd65dcb6f7a26d73001",
  );
  assert.equal(
    result.assignment.source_granularity_id.toString(),
    "66a93fd65dcb6f7a26d73002",
  );
  assert.equal(result.assignment.crm_source_label_snapshot, "Owner Created Forms");
});

test("lead source assignment retries a valid fallback alias after exact lookup misses", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await resolveLeadSourceAssignment(
    { value: "legacy alias", channel: "form" },
    {
      resolver: async (input) => {
        calls.push(input);
        return {
          company_id: "66a93fd65dcb6f7a26d73001",
          company_slug: "owner_created",
          company_label_snapshot: "Owner Created",
          granularity_id: "66a93fd65dcb6f7a26d73002",
          granularity_key: "owner_created_form",
          granularity_label_snapshot: "Owner Created Forms",
          crm_label_snapshot: "Owner Created Forms",
          match_kind: "fallback",
          registry_revision: 3,
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.company_slug, "legacy alias");
  assert.equal(calls[0]?.crm_label, "legacy alias");
  assert.equal(calls[0]?.fallback_alias, "legacy alias");
  assert.equal(calls[0]?.allow_company_identifier_fallback, true);
  assert.equal(result.resolution.match_kind, "fallback");
});
