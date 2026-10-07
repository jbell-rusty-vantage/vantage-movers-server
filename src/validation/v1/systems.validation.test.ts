import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstSystemsValidationMessage,
  systemsCapacityQuerySchema,
  systemsLocationsPatchSchema,
} from "./systems.validation";

const parse = (body: unknown) => systemsLocationsPatchSchema.safeParse(body);

test("a label, link and note edit on a known key is accepted", () => {
  const result = parse({
    revision: 3,
    locations: {
      partner_pages: { url: " https://partners.example.com ", paths: ["/top10", "/new-path"] },
      wordpress: { note: "", code_url: "" },
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data!.locations.partner_pages!.url, "https://partners.example.com");
  assert.equal(result.data!.locations.wordpress!.note, null);
  assert.equal(result.data!.locations.wordpress!.code_url, null);
});

test("every link must be https", () => {
  for (const url of ["http://vantagemoves.com", "vantagemoves.com", "javascript:alert(1)", "https://"]) {
    const result = parse({ revision: 1, locations: { main_site: { url } } });
    assert.equal(result.success, false, url);
    assert.match(firstSystemsValidationMessage(result.error!), /https:\/\//);
  }
  const host = parse({ revision: 1, locations: { server: { host_url: "http://vercel.com/x" } } });
  assert.equal(host.success, false);
  assert.equal(firstSystemsValidationMessage(host.error!), "server › host_url: Links must start with https://");
});

test("the key set is fixed", () => {
  const unknownKey = parse({ revision: 1, locations: { new_site: { url: "https://x.example.com" } } });
  assert.equal(unknownKey.success, false);
  assert.equal(firstSystemsValidationMessage(unknownKey.error!), "Only the listed locations can be changed.");
  // The Master Sheet rows are built from env ids and cannot be edited.
  assert.equal(parse({ revision: 1, locations: { master_leads: { label: "x" } } }).success, false);
  // Neither can a row's fixed fields.
  assert.equal(parse({ revision: 1, locations: { mcp: { action: "open" } } }).success, false);
});

test("labels are required and paths start with a slash", () => {
  assert.equal(parse({ revision: 1, locations: { dashboard: { label: "  " } } }).success, false);
  assert.equal(parse({ revision: 1, locations: { partner_pages: { paths: ["top10"] } } }).success, false);
  assert.equal(parse({ revision: 1, locations: { partner_pages: { paths: ["/a b"] } } }).success, false);
  assert.equal(parse({ locations: {} }).success, false);
});

test("refresh=1 asks the capacity read to skip its caches", () => {
  assert.deepEqual(systemsCapacityQuerySchema.parse({}), { refresh: false });
  assert.deepEqual(systemsCapacityQuerySchema.parse({ refresh: "1" }), { refresh: true });
  assert.equal(systemsCapacityQuerySchema.safeParse({ other: "x" }).success, false);
});
