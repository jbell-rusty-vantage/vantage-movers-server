import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGranotFormPatch,
  granotFormIdentityFields,
  planGranotFormWorkflow,
  selectGranotFormFallback,
} from "./formWorkflow";
import { granotApplyEnabled } from "./runWorkflow";

test("[AC-03] form identity vocabulary excludes lids while allowing Mongo id as a secondary lookup", () => {
  assert.deepEqual(granotFormIdentityFields, [
    "ref_no",
    "_id",
    "phone_number",
    "email",
    "name",
  ]);
  assert.equal(granotFormIdentityFields.includes("lid"), false);
  assert.equal(granotFormIdentityFields.includes("normalized_lid"), false);
});

test("[AC-03] form planning gives exact FormLead.ref_no priority over every fallback", async () => {
  let searched = false;
  let receivedRefNo = "";
  const lead = makeLead("lead-exact", {
    ref_no: "wordpress-stable-ref",
    quoted: false,
  });
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: "wordpress-stable-ref", prior: "0" })],
    {
      findExactRefMatches: async (refNo) => {
        receivedRefNo = refNo;
        return [lead as never];
      },
      search: async () => {
        searched = true;
        throw new Error("fallback must not run after an exact ref_no match");
      },
      resolveAgent: async () => undefined,
    },
  );
  assert.equal(receivedRefNo, "wordpress-stable-ref");
  assert.equal(searched, false);
  assert.equal(plan.actions[0]?.match_method, "ref_no_exact");
  assert.equal(plan.actions[0]?.lead_id, "lead-exact");
});

test("exact identity wins but surfaces a source-company mismatch warning", async () => {
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: "global-provider-ref", prior: "0" })],
    {
      findExactRefMatches: async () => [
        makeLead("lead-exact", {
          ref_no: "global-provider-ref",
          source_company: "top10_leads",
        }) as never,
      ],
      resolveAgent: async () => undefined,
    },
  );
  assert.equal(plan.actions[0]?.match_method, "ref_no_exact");
  assert.match(plan.actions[0]?.warnings?.[0] ?? "", /source_company/);
  assert.match(plan.actions[0]?.warnings?.[0] ?? "", /TBM Forms/);
});

test("duplicate exact FormLead.ref_no candidates are a conflict", async () => {
  let searched = false;
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: "duplicate-ref", prior: "5" })],
    {
      findExactRefMatches: async () => [
        makeLead("one") as never,
        makeLead("two") as never,
      ],
      search: async () => {
        searched = true;
        throw new Error("duplicate exact refs must not fall back");
      },
    },
  );
  assert.equal(searched, false);
  assert.equal(plan.actions[0]?.classification, "conflict");
  assert.equal(plan.actions[0]?.reason, "duplicate_exact_ref");
});

test("[AC-03] form planning falls back only after FormLead.ref_no has no match", async () => {
  const fallback = makeLead("lead-fallback", {
    source_company: "tbm_leads",
    quoted: true,
  });
  const plan = await planGranotFormWorkflow(
    [
      makeSource({
        ref_no: "missing-ref",
        prior: "5",
        phone: "555-0100",
        email: "lead@example.test",
      }),
    ],
    {
      findExactRefMatches: async () => [],
      search: async () =>
        ({
          status: "found",
          found: true,
          matches: [
            {
              lead: fallback,
              matched_fields: ["phone_number", "email"],
              confidence: "high",
              score: 75,
            },
          ],
        }) as never,
      resolveAgent: async () => undefined,
    },
  );
  assert.equal(plan.actions[0]?.match_method, "fallback");
  assert.equal(plan.actions[0]?.lead_id, "lead-fallback");
});

test("[AC-03] form planning resolves an ObjectId ref_no only after exact field lookup misses", async () => {
  const calls: string[] = [];
  const mongoId = "6a72c49b1009d5e86400d193";
  const lead = makeLead(mongoId, { ref_no: "provider-ref" });
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: mongoId, prior: "5" })],
    {
      findExactRefMatches: async () => {
        calls.push("ref_no_exact");
        return [];
      },
      findByMongoId: async (id) => {
        calls.push(`mongo_id:${id}`);
        return lead as never;
      },
      search: async () => {
        throw new Error("fallback must not run after a Mongo id match");
      },
      resolveAgent: async () => undefined,
    },
  );
  assert.deepEqual(calls, ["ref_no_exact", `mongo_id:${mongoId}`]);
  assert.equal(plan.actions[0]?.match_method, "mongo_id");
  assert.equal(plan.actions[0]?.lead_id, mongoId);
});

test("fallback ties resolve by source company then quoted prior", () => {
  const make = (id: string, source: string, quoted: boolean) => ({
    lead: {
      _id: id,
      source_company: source,
      quoted,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    },
    matched_fields: ["phone_number"],
    confidence: "medium",
    score: 35,
  });
  const selected = selectGranotFormFallback(
    [
      make("a", "best-relocation", false),
      make("b", "tbm_leads", true),
      make("c", "tbm_leads", false),
    ] as never,
    "TBM Forms",
    "5",
  );
  assert.equal(String(selected.lead?._id), "b");
});

test("fallback refuses a sole candidate from a different source company", async () => {
  const wrongSource = makeLead("wrong-source", {
    source_company: "top10_leads",
    quoted: false,
  });
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: "", prior: "0", phone: "555-0100" })],
    {
      search: async () =>
        ({
          status: "found",
          found: true,
          matches: [
            {
              lead: wrongSource,
              matched_fields: ["phone_number"],
              confidence: "medium",
              score: 35,
            },
          ],
        }) as never,
      resolveAgent: async () => undefined,
    },
  );
  assert.equal(plan.actions[0]?.classification, "no_match");
  assert.equal(plan.actions[0]?.reason, "No same-source FormLead matched phone, email, or name.");
});

test("fallback does not select a lead from name alone", async () => {
  let searched = false;
  const plan = await planGranotFormWorkflow(
    [makeSource({ ref_no: "", prior: "1", customer: "Jane Customer" })],
    {
      search: async () => {
        searched = true;
        throw new Error("weak name-only fallback must not query");
      },
    },
  );
  assert.equal(searched, false);
  assert.equal(plan.actions[0]?.classification, "no_match");
  assert.equal(plan.actions[0]?.reason, "Fallback matching requires phone or email.");
});

test("fallback scores only candidates that pass the source-company gate", () => {
  const make = (id: string, source: string, score: number) => ({
    lead: makeLead(id, { source_company: source }),
    matched_fields: ["phone_number"],
    confidence: "medium",
    score,
  });
  const selected = selectGranotFormFallback(
    [
      make("wrong-higher-score", "top10_leads", 75),
      make("same-source", "tbm_leads", 35),
    ] as never,
    "TBM Forms",
    "0",
  );
  assert.equal(String(selected.lead?._id), "same-source");
});

test("form patch has extension parity and fills only missing locations", async () => {
  const values: Record<string, unknown> = {
    quoted: false,
    cubic_feet: undefined,
    pickup_city: "Existing",
    pickup_zip: "",
    delivery_city: undefined,
    destination_zip: "99999",
    receiver_agent: undefined,
  };
  const lead = {
    ...values,
    _id: "lead",
    createdAt: new Date(),
    get(path: string) {
      return values[path];
    },
  };
  const patch = await buildGranotFormPatch(
    lead as never,
    {
      id: "row",
      rowIndex: 1,
      values: {
        prior: "5",
        est_cf: "1,250",
        from: "Miami, FL",
        from_zip: "33101",
        to: "Orlando, FL",
        to_zip: "32801",
        user: "DEV",
      },
    },
    async () =>
      ({
        id: "agent-id",
        name: "Dev Agent",
        active: true,
      }) as never,
  );
  assert.equal(patch.quoted, true);
  assert.equal(patch.cubic_feet, 1250);
  assert.equal(patch.pickup_city, undefined);
  assert.equal(patch.pickup_zip, "33101");
  assert.equal(patch.delivery_city, "Orlando");
  assert.equal(patch.destination_zip, undefined);
  assert.equal(patch.receiver_agent, "agent-id");
  assert.equal(patch.receiver_agent_source, "extension_crm_username_match");
});

test("apply deployment gate is explicit", () => {
  assert.equal(granotApplyEnabled("true"), true);
  assert.equal(granotApplyEnabled("TRUE"), true);
  assert.equal(granotApplyEnabled("1"), false);
  assert.equal(granotApplyEnabled(undefined), false);
});

test("form patch never overwrites an existing receiver", async () => {
  let resolverCalls = 0;
  const lead = {
    _id: "lead",
    createdAt: new Date(),
    receiver_agent: "existing-agent",
    pickup_city: "Miami",
    pickup_zip: "33101",
    delivery_city: "Orlando",
    destination_zip: "32801",
    get() {
      return undefined;
    },
  };
  const patch = await buildGranotFormPatch(
    lead as never,
    {
      id: "row",
      rowIndex: 1,
      values: { user: "OTHER" },
    },
    async () => {
      resolverCalls += 1;
      return undefined;
    },
  );
  assert.equal(patch.receiver_agent, undefined);
  assert.equal(resolverCalls, 0);
});

function makeLead(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    _id: id,
    ref_no: "ref",
    source_company: "tbm_leads",
    quoted: false,
    pickup_city: "Miami",
    pickup_zip: "33101",
    pickup_state: "FL",
    delivery_city: "Orlando",
    destination_zip: "32801",
    delivery_state: "FL",
    receiver_agent: "agent",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
  return {
    ...values,
    get(path: string) {
      return values[path];
    },
  };
}

function makeSource(values: Record<string, string>) {
  return {
    sourceLabel: "TBM Forms",
    contentHash: "hash",
    sectionSchemas: {
      bookedJobs: "table",
      followUpEstimates: "empty",
    },
    sections: {
      bookedJobs: [{ id: "booked:1", rowIndex: 1, values }],
      followUpEstimates: [],
    },
  } as never;
}
