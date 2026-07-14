import mongoose from "mongoose";
import { Testimonial } from "../../models/Testimonial";
import type { AdminTestimonialsQuery, ListTestimonialsQuery } from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";

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

export type AdminTestimonialItem = TestimonialListItem & {
  source_company: string;
  customer: {
    id: string;
    full_name: string;
    phone_number: string;
    email: string;
  } | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type AdminTestimonialsResult = {
  items: AdminTestimonialItem[];
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

export async function listAdminTestimonials(
  query: AdminTestimonialsQuery,
): Promise<AdminTestimonialsResult> {
  const filter = buildAdminTestimonialFilter(query);
  const skip = (query.page - 1) * query.limit;
  const sortDirection = query.direction === "asc" ? 1 : -1;

  const [docs, total] = await Promise.all([
    Testimonial.find(filter)
      .populate("customer", "full_name phone_number email")
      .sort({ review_date: sortDirection, createdAt: sortDirection })
      .skip(skip)
      .limit(query.limit)
      .lean()
      .exec(),
    Testimonial.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(toAdminTestimonialItem),
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: skip + docs.length < total,
  };
}

export async function getAdminTestimonial(id: string): Promise<AdminTestimonialItem> {
  const doc = await Testimonial.findById(id)
    .populate("customer", "full_name phone_number email")
    .lean()
    .exec();
  if (!doc) {
    throw new V1ServiceError("Testimonial not found", 404);
  }
  return toAdminTestimonialItem(doc as Record<string, unknown>);
}

export async function listAdminTestimonialReviewerNames(): Promise<string[]> {
  const names = await Testimonial.distinct("reviewer_name", {
    reviewer_name: { $nin: [null, ""] },
  }).exec();
  return names
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
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

export function buildAdminTestimonialFilter(query: AdminTestimonialsQuery): Record<string, unknown> {
  const filter = buildTestimonialFilter(query);

  if (query.q !== undefined) {
    const regex = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ reviewer_name: regex }, { normalized_reviewer_name: regex }];
  }
  if (query.reviewer_name !== undefined) {
    filter.reviewer_name = query.reviewer_name;
  }
  if (query.rating !== undefined) {
    filter.rating = query.rating;
  }
  if (query.customer !== undefined) {
    filter.customer = mongoose.Types.ObjectId.createFromHexString(query.customer);
  }
  if (query.from !== undefined || query.to !== undefined) {
    filter.review_date = {
      ...(query.from !== undefined ? { $gte: query.from } : {}),
      ...(query.to !== undefined ? { $lte: query.to } : {}),
    };
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

function toAdminTestimonialItem(doc: Record<string, unknown>): AdminTestimonialItem {
  return {
    ...toTestimonialListItem(doc),
    source_company: String(doc.source_company ?? ""),
    customer: toCustomerSummary(doc.customer),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(String(doc.createdAt)) : null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(String(doc.updatedAt)) : null,
  };
}

function toCustomerSummary(value: unknown): AdminTestimonialItem["customer"] {
  if (!value) {
    return null;
  }
  if (value instanceof mongoose.Types.ObjectId || typeof value === "string") {
    return {
      id: String(value),
      full_name: "",
      phone_number: "",
      email: "",
    };
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      id: String(record._id ?? record.id ?? ""),
      full_name: String(record.full_name ?? ""),
      phone_number: String(record.phone_number ?? ""),
      email: String(record.email ?? ""),
    };
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
