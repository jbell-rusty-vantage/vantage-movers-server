import { Testimonial } from "../../models/Testimonial";
import type { ListTestimonialsQuery } from "../../validation/v1.validation";

export type TestimonialListItem = {
  id: string;
  source: string;
  reviewer_name: string;
  review_date: Date;
  rating: number;
  review_text: string;
  business_response: {
    responded_at: Date;
    text: string;
  } | null;
  published: boolean;
  featured: boolean;
};

export type ListTestimonialsResult = {
  items: TestimonialListItem[];
  page: number;
  limit: number;
  total: number;
  has_next_page: boolean;
};

export async function listTestimonials(
  query: ListTestimonialsQuery,
): Promise<ListTestimonialsResult> {
  const filter = buildTestimonialFilter(query);
  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    Testimonial.find(filter)
      .sort({ review_date: -1, createdAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean()
      .exec(),
    Testimonial.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(toTestimonialListItem),
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: skip + docs.length < total,
  };
}

export function buildTestimonialFilter(query: ListTestimonialsQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (query.source !== undefined) {
    filter.source = query.source;
  }
  if (query.published !== undefined) {
    filter.published = query.published;
  }
  if (query.featured !== undefined) {
    filter.featured = query.featured;
  }

  return filter;
}

function toTestimonialListItem(doc: Record<string, unknown>): TestimonialListItem {
  const businessResponse = doc.business_response;
  return {
    id: String(doc._id ?? ""),
    source: String(doc.source ?? ""),
    reviewer_name: String(doc.reviewer_name ?? ""),
    review_date: doc.review_date instanceof Date ? doc.review_date : new Date(String(doc.review_date)),
    rating: Number(doc.rating ?? 0),
    review_text: String(doc.review_text ?? ""),
    business_response:
      businessResponse &&
      typeof businessResponse === "object" &&
      businessResponse !== null &&
      "responded_at" in businessResponse &&
      "text" in businessResponse
        ? {
            responded_at:
              businessResponse.responded_at instanceof Date
                ? businessResponse.responded_at
                : new Date(String(businessResponse.responded_at)),
            text: String(businessResponse.text ?? ""),
          }
        : null,
    published: doc.published === true,
    featured: doc.featured === true,
  };
}
