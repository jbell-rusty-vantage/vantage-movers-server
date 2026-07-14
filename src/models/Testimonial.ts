import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { TESTIMONIAL_SOURCES } from "../config/domain";

const BusinessResponseSchema = new Schema(
  {
    responded_at: { type: Date, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const TestimonialSchema = new Schema(
  {
    source: {
      type: String,
      enum: TESTIMONIAL_SOURCES,
      required: true,
      default: "BBB",
      index: true,
    },
    source_company: { type: String, trim: true },

    reviewer_name: { type: String, required: true, trim: true },
    normalized_reviewer_name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    review_date: { type: Date, required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review_text: { type: String, required: true, trim: true },

    business_response: { type: BusinessResponseSchema, default: null },

    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
      default: null,
    },

    content_fingerprint: {
      type: String,
      required: true,
      trim: true,
    },

    published: { type: Boolean, required: true, default: true, index: true },
    featured: { type: Boolean, required: true, default: false },
  },
  {
    collection: "testimonials",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

TestimonialSchema.index({ source: 1, content_fingerprint: 1 }, { unique: true });
TestimonialSchema.index({ source: 1, published: 1, review_date: -1 });

export type TestimonialDocument = InferSchemaType<typeof TestimonialSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Testimonial: Model<TestimonialDocument> =
  mongoose.models.Testimonial ??
  mongoose.model<TestimonialDocument>("Testimonial", TestimonialSchema);
