import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { FormLead } from "../../models/FormLead";
import { isDuplicateFormLead } from "./duplicateLead.service";

type FindQuery = {
  source_company?: string;
  duplicate?: unknown;
  $or?: Array<Record<string, unknown>>;
};

type StubbedFormLeadModel = {
  find: (query: FindQuery) => unknown;
};

const originalFormLeadFind = FormLead.find as unknown;

afterEach(() => {
  (FormLead as unknown as StubbedFormLeadModel).find =
    originalFormLeadFind as StubbedFormLeadModel["find"];
});

test("form duplicate check matches existing lead by email within source company", async () => {
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
    "tbm_leads",
    "5553334444",
    " CUSTOMER@example.com ",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.source_company, "tbm_leads");
  assert.deepEqual(findQuery?.duplicate, { $ne: true });
  assert.equal(findQuery?.$or?.some((clause) => clause.email === "customer@example.com"), true);
});

test("form duplicate check matches existing lead by phone within source company", async () => {
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
    "main_site",
    "5619889998",
    "new@example.com",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.source_company, "main_site");
  assert.equal(
    findQuery?.$or?.some((clause) => clause.phone_number instanceof RegExp),
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

  assert.equal(await isDuplicateFormLead("top10_leads", null, "lead@example.com"), true);
});

test("form duplicate check ignores regex candidates that fail exact phone verification", async () => {
  stubFormLeadFind([
    {
      email: "",
      phone_number: "56198899980",
    },
  ]);

  const duplicate = await isDuplicateFormLead(
    "best_relocation_leads",
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

  assert.equal(await isDuplicateFormLead("not_provided", null, "   "), false);
  assert.equal(findCount, 0);
});

function stubFormLeadFind(
  leads: Array<{ email?: string; phone_number?: string }>,
  onFind?: (query: FindQuery) => void,
): void {
  (FormLead as unknown as StubbedFormLeadModel).find = (query: FindQuery) => {
    onFind?.(query);
    return {
      sort: () => ({
        limit: () => ({
          exec: async () => leads,
        }),
      }),
    };
  };
}
