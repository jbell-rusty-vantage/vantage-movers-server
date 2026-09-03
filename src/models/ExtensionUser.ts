import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const EXTENSION_ROLES = ["owner", "sales", "customer_service"] as const;
export const LEGACY_EXTENSION_ROLES = ["employee"] as const;
export const STORED_EXTENSION_ROLES = [
  ...EXTENSION_ROLES,
  ...LEGACY_EXTENSION_ROLES,
] as const;
export type ExtensionRole = (typeof STORED_EXTENSION_ROLES)[number];

const ExtensionUserSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    password_hash: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: STORED_EXTENSION_ROLES,
      default: "owner",
    },
    active: { type: Boolean, required: true, default: true },
    token_version: { type: Number, required: true, default: 0 },
    created_at: { type: Date, required: true, default: Date.now },
    updated_at: { type: Date, required: true, default: Date.now },
    last_login_at: { type: Date },
    password_changed_at: { type: Date, required: true, default: Date.now },
  },
  {
    collection: "extension_users",
    versionKey: false,
  },
);

ExtensionUserSchema.pre("save", function updateTimestamp() {
  this.updated_at = new Date();
});

ExtensionUserSchema.index({ email: 1 }, { unique: true });
ExtensionUserSchema.index({ active: 1 });

export type ExtensionUserDocument = InferSchemaType<typeof ExtensionUserSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ExtensionUser: Model<ExtensionUserDocument> =
  mongoose.models.ExtensionUser ??
  mongoose.model<ExtensionUserDocument>("ExtensionUser", ExtensionUserSchema);
