import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Testimonial } from "../../models/Testimonial";
import { listTestimonialsQuerySchema } from "../../validation/v1.validation";
import { buildTestimonialFilter, listTestimonials } from "./testimonial.service";

type MutableModel = Record<string, unknown>;

const originalFind = Testimonial.find as unknown;
const originalCountDocuments = Testimonial.countDocuments as unknown;

afterEach(() => {
  (Testimonial as unknown as MutableModel).find = originalFind;
  (Testimonial as unknown as MutableModel).countDocuments = originalCountDocuments;
});

test("listTestimonialsQuerySchema coerces pagination and boolean filters", () => {
  const parsed = listTestimonialsQuerySchema.parse({
    published: "true",
    featured: "false",
    page: "2",
    limit: "5",
    source: "BBB",
  });

  assert.equal(parsed.published, true);
  assert.equal(parsed.featured, false);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.source, "BBB");
});

test("buildTestimonialFilter applies only provided query flags", () => {
  assert.deepEqual(buildTestimonialFilter({ page: 1, limit: 20 }), {});
  assert.deepEqual(buildTestimonialFilter({ page: 1, limit: 20, published: true }), {
    published: true,
  });
  assert.deepEqual(
    buildTestimonialFilter({ page: 1, limit: 20, published: true, featured: true, source: "BBB" }),
    {
      source: "BBB",
      published: true,
      featured: true,
    },
  );
});

test("listTestimonials returns paginated landing-page items", async () => {
  const reviewDate = new Date("2026-05-07T00:00:00.000Z");
  const findCapture: { filter?: unknown; sort?: unknown; skip?: number; limit?: number } = {};
  const countCapture: { filter?: unknown } = {};

  (Testimonial as unknown as MutableModel).find = (filter: unknown) => {
    findCapture.filter = filter;
    return {
      sort(sort: unknown) {
        findCapture.sort = sort;
        return this;
      },
      skip(value: number) {
        findCapture.skip = value;
        return this;
      },
      limit(value: number) {
        findCapture.limit = value;
        return this;
      },
      lean() {
        return this;
      },
      exec: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          source: "BBB",
          reviewer_name: "Nila B",
          review_date: reviewDate,
          rating: 5,
          review_text: "Great move.",
          business_response: null,
          published: true,
          featured: false,
        },
      ],
    };
  };

  (Testimonial as unknown as MutableModel).countDocuments = (filter: unknown) => {
    countCapture.filter = filter;
    return {
      exec: async () => 16,
    };
  };

  const result = await listTestimonials({
    page: 2,
    limit: 5,
    published: true,
    featured: false,
  });

  assert.deepEqual(findCapture.filter, { published: true, featured: false });
  assert.deepEqual(findCapture.sort, { review_date: -1, createdAt: -1 });
  assert.equal(findCapture.skip, 5);
  assert.equal(findCapture.limit, 5);
  assert.deepEqual(countCapture.filter, { published: true, featured: false });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 5);
  assert.equal(result.total, 16);
  assert.equal(result.has_next_page, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.reviewer_name, "Nila B");
  assert.equal(result.items[0]?.published, true);
});
