import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import { FormLead } from "../../models/FormLead";
import { browseFormLeadsQuerySchema } from "../../validation/v1.validation";
import { browseFormLeads } from "./formLeadBrowse.service";

type MutableModel = Record<string, unknown>;
type QueryCapture = {
  filter?: unknown;
  sort?: unknown;
  skip?: number;
  limit?: number;
  populated: string[];
};

const originalFind = FormLead.find as unknown;
const originalCount = FormLead.countDocuments as unknown;

afterEach(() => {
  (FormLead as unknown as MutableModel).find = originalFind;
  (FormLead as unknown as MutableModel).countDocuments = originalCount;
});

test("form lead browse q includes Granot snapshot name", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseFormLeads(browseFormLeadsQuerySchema.parse({ q: "granot-only-name" }));

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /granot-only-name/);
});

test("form lead browse name includes ingested and Granot name paths", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseFormLeads(browseFormLeadsQuerySchema.parse({ name: "Ada" }));

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /ingested_contact_snapshot\.name/);
  assert.match(filterPreview, /ingested_contact_snapshot\.first_name/);
  assert.match(filterPreview, /ingested_contact_snapshot\.last_name/);
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /granot_contact_snapshot\.first_name/);
  assert.match(filterPreview, /granot_contact_snapshot\.last_name/);
  assert.match(filterPreview, /Ada/);
});

test("form lead browse email includes ingested and Granot email paths", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseFormLeads(
    browseFormLeadsQuerySchema.parse({ email: "ada@example.com" }),
  );

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /ingested_contact_snapshot\.email/);
  assert.match(filterPreview, /granot_contact_snapshot\.email/);
  assert.match(filterPreview, /ada@example/);
});

test("form lead browse phone matches the typed string on live and snapshot paths", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseFormLeads(
    browseFormLeadsQuerySchema.parse({ phone_number: "555-1234" }),
  );

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /phone_number/);
  assert.match(filterPreview, /normalized_phone_number/);
  assert.match(filterPreview, /ingested_contact_snapshot\.phone_number/);
  assert.match(filterPreview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(filterPreview, /granot_contact_snapshot\.phone_number/);
  assert.match(filterPreview, /granot_contact_snapshot\.normalized_phone_number/);
  assert.match(filterPreview, /555-1234/);
  assert.doesNotMatch(filterPreview, /\\d\{0,2\}/);
});

test("form lead browse empty query finds all leads including duplicates", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, []);
  stubCount(0);

  await browseFormLeads(browseFormLeadsQuerySchema.parse({}));

  assert.deepEqual(capture.filter, {});
  const filterPreview = inspect(capture.filter, { depth: null });
  assert.doesNotMatch(filterPreview, /duplicate/);
});

test("form lead browse result card omits snapshot objects", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(capture, [
    {
      _id: "lead-1",
      name: "Form Name",
      email: "form@example.com",
      phone_number: "555-0000",
      ingested_contact_snapshot: { name: "Ingested Name" },
      granot_contact_snapshot: { name: "Granot Name" },
    },
  ]);
  stubCount(1);

  const result = await browseFormLeads(browseFormLeadsQuerySchema.parse({}));

  assert.equal(result.count, 1);
  assert.equal(result.results[0]._id, "lead-1");
  assert.equal(result.results[0].name, "Form Name");
  assert.equal(
    "ingested_contact_snapshot" in result.results[0],
    false,
  );
  assert.equal(
    "granot_contact_snapshot" in result.results[0],
    false,
  );
});

function stubFind(capture: QueryCapture, docs: Record<string, unknown>[]) {
  (FormLead as unknown as MutableModel).find = (filter: unknown) => {
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
  (FormLead as unknown as MutableModel).countDocuments = () => ({
    exec: async () => count,
  });
}
