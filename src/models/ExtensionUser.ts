import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  CURRENT_EXTENSION_ROLES,
  type CurrentExtensionRole,
} from "../auth/extension/roles";

export const EXTENSION_ROLES = CURRENT_EXTENSION_ROLES;
export const LEGACY_EXTENSION_ROLES = ["employee"] as const;
export const STORED_EXTENSION_ROLES = [
  ...EXTENSION_ROLES,
  ...LEGACY_EXTENSION_ROLES,
] as const;
export type ExtensionRole = CurrentExtensionRole;

const ExtensionUserSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    password_hash: { type: String, required: true },
    roles: [{ type: String, enum: EXTENSION_ROLES }],
    role: {
      type: String,
      enum: STORED_EXTENSION_ROLES,
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
