import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { Testimonial } from "../../models/Testimonial";
import { adminTestimonialsQuerySchema, listTestimonialsQuerySchema } from "../../validation/v1.validation";
import {
  buildAdminTestimonialFilter,
  buildTestimonialFilter,
  listAdminTestimonialReviewerNames,
  listAdminTestimonials,
  listTestimonials,
} from "./testimonial.service";

type MutableModel = Record<string, unknown>;

const originalFind = Testimonial.find as unknown;
const originalCountDocuments = Testimonial.countDocuments as unknown;
const originalDistinct = Testimonial.distinct as unknown;

afterEach(() => {
  (Testimonial as unknown as MutableModel).find = originalFind;
  (Testimonial as unknown as MutableModel).countDocuments = originalCountDocuments;
  (Testimonial as unknown as MutableModel).distinct = originalDistinct;
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

test("adminTestimonialsQuerySchema coerces admin filters and sort direction", () => {
  const customer = String(new mongoose.Types.ObjectId());
  const parsed = adminTestimonialsQuerySchema.parse({
    q: "Dana",
    reviewer_name: "Dana P",
    rating: "1",
    customer,
    from: "2026-07-01",
    to: "2026-07-09",
    direction: "asc",
    page: "3",
    limit: "25",
  });

  assert.equal(parsed.q, "Dana");
  assert.equal(parsed.reviewer_name, "Dana P");
  assert.equal(parsed.rating, 1);
  assert.equal(parsed.customer, customer);
  assert.equal(parsed.direction, "asc");
  assert.equal(parsed.page, 3);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.from?.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(parsed.to?.toISOString(), "2026-07-09T00:00:00.000Z");
});

test("buildAdminTestimonialFilter applies reviewer, rating, customer, and date filters", () => {
  const customer = new mongoose.Types.ObjectId();
  const from = new Date("2026-07-01T00:00:00.000Z");
  const to = new Date("2026-07-09T00:00:00.000Z");
  const filter = buildAdminTestimonialFilter({
    page: 1,
    limit: 50,
    sort: "review_date",
    direction: "desc",
    q: "Dana P",
    reviewer_name: "Dana P",
    rating: 1,
    customer: String(customer),
    from,
    to,
    published: true,
  });

  assert.deepEqual(filter.published, true);
  assert.deepEqual(filter.reviewer_name, "Dana P");
  assert.deepEqual(filter.rating, 1);
  assert.equal(String(filter.customer), String(customer));
  assert.deepEqual(filter.review_date, { $gte: from, $lte: to });
  assert.ok(Array.isArray(filter.$or));
  assert.match(String((filter.$or as Array<Record<string, RegExp>>)[0]?.reviewer_name), /Dana P/);
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

test("listAdminTestimonials returns admin fields and applies requested sort", async () => {
  const reviewDate = new Date("2026-07-04T00:00:00.000Z");
  const customerId = new mongoose.Types.ObjectId();
  const findCapture: { filter?: unknown; sort?: unknown; skip?: number; limit?: number; populate?: unknown } = {};

  (Testimonial as unknown as MutableModel).find = (filter: unknown) => {
    findCapture.filter = filter;
    return {
      populate(path: unknown, select: unknown) {
        findCapture.populate = { path, select };
        return this;
      },
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
          source_company: "Vantage Movers, LLC",
          reviewer_name: "Dana P",
          review_date: reviewDate,
          rating: 1,
          review_text: "Do not use.",
          business_response: null,
          published: true,
          featured: false,
          customer: {
            _id: customerId,
            full_name: "Dana P",
            phone_number: "555-1000",
            email: "dana@example.com",
          },
          createdAt: reviewDate,
          updatedAt: reviewDate,
        },
      ],
    };
  };

  (Testimonial as unknown as MutableModel).countDocuments = () => ({
    exec: async () => 1,
  });

  const result = await listAdminTestimonials({
    page: 1,
    limit: 50,
    sort: "review_date",
    direction: "asc",
    rating: 1,
  });

  assert.deepEqual(findCapture.filter, { rating: 1 });
  assert.deepEqual(findCapture.populate, { path: "customer", select: "full_name phone_number email" });
  assert.deepEqual(findCapture.sort, { review_date: 1, createdAt: 1 });
  assert.equal(findCapture.skip, 0);
  assert.equal(findCapture.limit, 50);
  assert.equal(result.items[0]?.source_company, "Vantage Movers, LLC");
  assert.equal(result.items[0]?.customer?.id, String(customerId));
});

test("listAdminTestimonialReviewerNames returns sorted unique non-empty names", async () => {
  (Testimonial as unknown as MutableModel).distinct = (field: unknown, filter: unknown) => ({
    exec: async () => {
      assert.equal(field, "reviewer_name");
      assert.deepEqual(filter, { reviewer_name: { $nin: [null, ""] } });
      return ["Robert C", "", "  Dana P  ", "Anne A"];
    },
  });

  assert.deepEqual(await listAdminTestimonialReviewerNames(), ["Anne A", "Dana P", "Robert C"]);
});
