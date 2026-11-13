import assert from "node:assert/strict";
import { test } from "node:test";
import { applyValues, catalogSchema, policySchema, reviewSelection, saveSchema, validateImageBytes } from "./contract";
import { testimonialFilter } from "./store";

const catalog = catalogSchema.parse([
  { key: "home.hero", section: "Home", label: "Heading", locale: "en", kind: "text", defaultValue: "Original exact text" },
  { key: "home.image", section: "Home", label: "Image", locale: "shared", kind: "image", defaultValue: "/original.webp" },
  { key: "service.image", section: "Services", label: "Image", locale: "shared", kind: "image", defaultValue: "/service.webp" },
]);
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
