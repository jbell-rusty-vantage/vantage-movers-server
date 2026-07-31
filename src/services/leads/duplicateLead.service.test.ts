import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { isDuplicateFormLead } from "./duplicateLead.service";

type FindQuery = {
  source_company?: string;
  duplicate?: unknown;
  $or?: Array<Record<string, unknown>>;
  $and?: Array<Record<string, unknown>>;
};

const originalUseDb = mongoose.connection.useDb;

afterEach(() => {
  mongoose.connection.useDb = originalUseDb;
});

test("form duplicate check matches an earlier lead by email within exact granularity", async () => {
  let findQuery: FindQuery | undefined;
  stubFormLeadFind(
    [
      {
        email: "customer@example.com",
        phone_number: "5551112222",
      },
    ],
    (query) => {
      findQuery = query;
    },
  );

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-1" },
    "5553334444",
    " CUSTOMER@example.com ",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.$and?.[0]?.source_granularity_id, "granularity-1");
  assert.deepEqual(findQuery?.$and?.[1]?.duplicate, { $ne: true });
  assert.equal(
    (findQuery?.$and?.[3]?.$or as Array<Record<string, unknown>> | undefined)?.some(
      (clause) => clause.email === "customer@example.com",
    ),
    true,
  );
});

test("form duplicate check matches existing lead by phone within exact granularity", async () => {
  let findQuery: FindQuery | undefined;
  stubFormLeadFind(
    [
      {
        email: "other@example.com",
        phone_number: "+1 (561) 988-9998",
      },
    ],
    (query) => {
      findQuery = query;
    },
  );

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "main_site", sourceGranularityId: "granularity-2" },
    "5619889998",
    "new@example.com",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.$and?.[0]?.source_granularity_id, "granularity-2");
  assert.equal(
    (findQuery?.$and?.[3]?.$or as Array<Record<string, unknown>> | undefined)?.some(
      (clause) => clause.phone_number instanceof RegExp,
    ),
    true,
  );
});

test("form duplicate check does not fall back from exact granularity to company", async () => {
  let findQuery: FindQuery | undefined;
  const leadSourceCompany = new mongoose.Types.ObjectId();
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await isDuplicateFormLead(
    {
      sourceCompany: "tbm_leads",
      leadSourceCompany,
      sourceGranularityId: "granularity-3",
    },
    "9542340460",
    "dringram91231@gmail.com",
  );

  const sourceFilter = findQuery?.$and?.[0];
  const identifierFilter = findQuery?.$and?.[3];
  assert.equal(sourceFilter?.source_granularity_id, "granularity-3");
  assert.ok(identifierFilter?.$or);
  assert.equal(
    (identifierFilter?.$or as Array<Record<string, unknown>>).some(
      (clause) => clause.email === "dringram91231@gmail.com",
    ),
    true,
  );
});

test("form duplicate check allows single identifier duplicate matches", async () => {
  stubFormLeadFind([
    {
      email: "lead@example.com",
      phone_number: "5551112222",
    },
  ]);

  assert.equal(
    await isDuplicateFormLead({ sourceCompany: "top10_leads", sourceGranularityId: "granularity-4" }, null, "lead@example.com"),
    true,
  );
});

test("form duplicate check ignores regex candidates that fail exact phone verification", async () => {
  stubFormLeadFind([
    {
      email: "",
      phone_number: "56198899980",
    },
  ]);

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "best_relocation_leads", sourceGranularityId: "granularity-5" },
    "5619889998",
    "   ",
  );

  assert.equal(duplicate, false);
});

test("form duplicate check skips lookup when no usable identifier exists", async () => {
  let findCount = 0;
  stubFormLeadFind([], () => {
    findCount += 1;
  });

  assert.equal(
    await isDuplicateFormLead({ sourceCompany: "not_provided", sourceGranularityId: "granularity-6" }, null, "   "),
    false,
  );
  assert.equal(findCount, 0);
});

function stubFormLeadFind(
  leads: Array<{ email?: string; phone_number?: string }>,
  onFind?: (query: FindQuery) => void,
): void {
  const formLeadModel = {
    find: (query: FindQuery) => {
      onFind?.(query);
      return {
        sort: () => ({ exec: async () => leads }),
      };
    },
  };

  mongoose.connection.useDb = (() => ({
    models: { FormLead: formLeadModel },
    model: () => formLeadModel,
  })) as unknown as typeof mongoose.connection.useDb;
}
