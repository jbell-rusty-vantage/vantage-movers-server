import assert from "node:assert/strict";
import { test } from "node:test";
import { applyValues, catalogAdditions, catalogSchema, policySchema, reviewSelection, saveSchema, validateImageBytes } from "./contract";
import { testimonialFilter } from "./store";

const catalog = catalogSchema.parse([
  { key: "home.hero", section: "Home", label: "Heading", locale: "en", kind: "text", defaultValue: "Original exact text" },
  { key: "home.image", section: "Home", label: "Image", locale: "shared", kind: "image", defaultValue: "/original.webp" },
  { key: "service.image", section: "Services", label: "Image", locale: "shared", kind: "image", defaultValue: "/service.webp" },
]);
test("catalog additions require explicit opt-in and preserve every existing descriptor and order", () => {
  const next = [...catalog, { ...catalog[0], key: "navigation.faq", defaultValue: "FAQ" }];
  assert.deepEqual(catalogAdditions(catalog, catalog), []);
  assert.throws(() => catalogAdditions(catalog, next), { code: "CMS_CATALOG_CONFLICT" });
  assert.deepEqual(catalogAdditions(catalog, next, true), [next.at(-1)]);
  assert.deepEqual(catalogAdditions(next, next, true), []);
  assert.throws(() => catalogAdditions(next, catalog, true), { code: "CMS_CATALOG_CONFLICT" });
  assert.throws(() => catalogAdditions(catalog, [{ ...catalog[0], defaultValue: "Changed" }, ...catalog.slice(1), next.at(-1)!], true), { code: "CMS_CATALOG_CONFLICT" });
  assert.throws(() => catalogAdditions(catalog, [catalog[1], catalog[0], ...catalog.slice(2), next.at(-1)!], true), { code: "CMS_CATALOG_CONFLICT" });
  assert.throws(() => catalogAdditions(catalog, [...catalog, catalog[0]], true), { code: "CMS_CATALOG_CONFLICT" });
});
test("content preserves exact whitespace, resets defaults, rejects unregistered and external image values", () => {
  assert.deepEqual(applyValues(catalog, {}, { "home.hero": "  Owner text\nwith a line  " }), { "home.hero": "  Owner text\nwith a line  " });
  assert.deepEqual(applyValues(catalog, { "home.hero": "Changed" }, { "home.hero": null }), {});
  assert.deepEqual(applyValues(catalog, { "home.hero": "Changed" }, { "home.hero": "Original exact text" }), {});
  assert.deepEqual(applyValues(catalog, {}, { "home.image": "/service.webp" }), { "home.image": "/service.webp" });
  for (const value of ["https://external.example/image.png", "javascript:alert(1)", "/api/site-content/media/not-an-id", "data:image/svg+xml,test"]) {
    assert.throws(() => applyValues(catalog, {}, { "home.image": value }));
  }
  assert.throws(() => applyValues(catalog, {}, { unknown: "x" }));
  assert.throws(() => saveSchema.parse({ expectedRevision: 0, values: JSON.parse('{"__proto__":"x"}') }));
  assert.throws(() => saveSchema.parse({ expectedRevision: 0, published: true }));
});
test("testimonial threshold is inclusive, explicit exclusions win, and unpublished reviews stay hidden", () => {
  const policy = policySchema.parse({ minimumRating: 4, excludedIds: ["000000000000000000000001"] });
  assert.equal(reviewSelection({ id: "x", rating: 4, published: true }, policy), "selected");
  assert.equal(reviewSelection({ id: "x", rating: 3, published: true }, policy), "below_minimum");
  assert.equal(reviewSelection({ id: policy.excludedIds[0], rating: 5, published: true }, policy), "excluded");
  assert.equal(reviewSelection({ id: "x", rating: 5, published: false }, policy), "unpublished");
  const filter = testimonialFilter(policy);
  assert.equal(filter.published, true);
  assert.deepEqual(filter.rating, { $gte: 4 });
  assert.equal(String(filter._id.$nin[0]), policy.excludedIds[0]);
  assert.throws(() => policySchema.parse({ minimumRating: 4.5, excludedIds: [] }));
});
test("uploads require matching raster signature and bounded bytes", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=", "base64");
  assert.doesNotThrow(() => validateImageBytes(png, "image/png"));
  assert.throws(() => validateImageBytes(png, "image/jpeg"));
  assert.throws(() => validateImageBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"));
  assert.throws(() => validateImageBytes(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"));
});

test("contact labels stay valid action targets and templates retain each dynamic placeholder", () => {
  const fields = catalogSchema.parse([
    { key: "phone", section: "Business", label: "phoneDisplay · (888) 477-9232", locale: "en", kind: "text", defaultValue: "(888) 477-9232", sourceFile: "lib/content.ts" },
    { key: "email", section: "Business", label: "email · support@example.com", locale: "en", kind: "text", defaultValue: "support@example.com", sourceFile: "lib/content.ts" },
    { key: "template", section: "Copy", label: "Copy", locale: "en", kind: "text", defaultValue: "{{0}} of {{1}}: {{0}}" },
    { key: "legal", section: "Copy", label: "Copy", locale: "en", kind: "text", defaultValue: ", or {{4}}." },
  ]);
  for (const phone of ["8885551234", "+1 (888) 555-1234", "888.555.1234"]) assert.equal(applyValues(fields, {}, { phone }).phone, phone);
  for (const phone of ["Call 8885551234", "+44 8885551234", "888555123", "8885551234\n", ""]) assert.throws(() => applyValues(fields, {}, { phone }));
  assert.equal(applyValues(fields, {}, { email: "owner+site@example.com" }).email, "owner+site@example.com");
  for (const email of ["invalid", "a@example.com?bcc=x", "a@example.com\r\nbcc:x", "a b@example.com", "a?bcc@example.com", "a#b@example.com"]) assert.throws(() => applyValues(fields, {}, { email }));
  assert.equal(applyValues(fields, {}, { template: "Total {{1}}; {{0}} twice: {{0}}" }).template, "Total {{1}}; {{0}} twice: {{0}}");
  for (const template of ["No tokens", "{{0}} of {{1}}", "{{0}} {{1}} {{2}}", "{{0}} {{1}} {{0}} {{2}}"]) assert.throws(() => applyValues(fields, {}, { template }));
  assert.equal(applyValues(fields, {}, { legal: "Contact {{4}} instead." }).legal, "Contact {{4}} instead.");
  assert.deepEqual(applyValues(fields, { phone: "8885551234" }, { phone: null }), {});
});
