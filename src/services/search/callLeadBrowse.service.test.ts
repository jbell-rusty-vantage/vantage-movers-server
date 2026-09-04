import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import { CallLead } from "../../models/CallLead";
import { browseCallLeadsQuerySchema } from "../../validation/v1.validation";
import { browseCallLeads } from "./callLeadBrowse.service";

type MutableModel = Record<string, unknown>;
type QueryCapture = {
  filter?: unknown;
  sort?: unknown;
  skip?: number;
  limit?: number;
  populated: string[];
};

const originalFind = CallLead.find as unknown;
const originalCount = CallLead.countDocuments as unknown;

afterEach(() => {
  (CallLead as unknown as MutableModel).find = originalFind;
  (CallLead as unknown as MutableModel).countDocuments = originalCount;
});

test("call lead browse q includes Granot snapshot name", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseCallLeads(browseCallLeadsQuerySchema.parse({ q: "granot-only-name" }));

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /ingested_contact_snapshot\.name/);
  assert.match(filterPreview, /granot-only-name/);
});

test("call lead browse phone matches the typed string on live and snapshot paths", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseCallLeads(
    browseCallLeadsQuerySchema.parse({ phone_number: "555-1234" }),
  );

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /phone_number/);
  assert.match(filterPreview, /normalized_phone_number/);
  assert.match(filterPreview, /ingested_contact_snapshot\.phone_number/);
  assert.match(filterPreview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(filterPreview, /granot_contact_snapshot\.phone_number/);
  assert.match(filterPreview, /granot_contact_snapshot\.normalized_phone_number/);
  assert.match(filterPreview, /555-1234/);
});

function stubFind(capture: QueryCapture, docs: Record<string, unknown>[]) {
  (CallLead as unknown as MutableModel).find = (filter: unknown) => {
    capture.filter = filter;
    return {
      sort(sort: unknown) {
        capture.sort = sort;
        return this;
      },
      skip(skip: number) {
        capture.skip = skip;
        return this;
      },
      limit(limit: number) {
        capture.limit = limit;
        return this;
      },
      populate(arg: string | { path: string }) {
        capture.populated.push(typeof arg === "string" ? arg : arg.path);
        return this;
      },
      lean() {
        return this;
      },
      exec: async () => docs,
    };
  };
}

function stubCount(count: number) {
  (CallLead as unknown as MutableModel).countDocuments = () => ({
    exec: async () => count,
  });
}
