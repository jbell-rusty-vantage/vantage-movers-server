import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { FormLead } from "../../models/FormLead";
import { searchFormLeads } from "./formLeadSearch.service";

type FindQuery = {
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

test("form lead search excludes duplicate quarantine leads", async () => {
  let findQuery: FindQuery | undefined;
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await searchFormLeads({ email: "customer@example.com" });

  assert.deepEqual(findQuery?.duplicate, { $ne: true });
});

function stubFormLeadFind(
  leads: Array<Record<string, unknown>>,
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
