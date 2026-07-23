import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const PublicSubmissionThrottleBucketSchema = new Schema(
  {
    key_hash: { type: String, required: true, trim: true },
    window_start: { type: Date, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "public_submission_throttle_buckets",
    timestamps: true,
  },
);

PublicSubmissionThrottleBucketSchema.index(
  { key_hash: 1, window_start: 1 },
  { unique: true },
);
PublicSubmissionThrottleBucketSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type PublicSubmissionThrottleBucketDocument = InferSchemaType<
  typeof PublicSubmissionThrottleBucketSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const PublicSubmissionThrottleBucket: Model<PublicSubmissionThrottleBucketDocument> =
  mongoose.models.PublicSubmissionThrottleBucket ??
  mongoose.model<PublicSubmissionThrottleBucketDocument>(
    "PublicSubmissionThrottleBucket",
    PublicSubmissionThrottleBucketSchema,
  );
