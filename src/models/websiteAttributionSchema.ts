import { Schema } from "mongoose";
import { CAMPAIGN_MEDIA, CAMPAIGN_NAMES, CAMPAIGN_SOURCES, REFERRING_HOSTS } from "../contracts/websiteAttribution";

const page = { path: String, content_id: String, locale: { type: String, enum: ["en", "es"] } };
const touch = new Schema({
  ...page, occurred_at: String,
  channel: { type: String, enum: ["direct", "organic_search", "referral", "campaign"] },
  referring_host: { type: String, enum: REFERRING_HOSTS },
  campaign: { type: new Schema({ source: { type: String, enum: CAMPAIGN_SOURCES }, medium: { type: String, enum: CAMPAIGN_MEDIA }, name: { type: String, enum: CAMPAIGN_NAMES } }, { _id: false }), default: undefined },
}, { _id: false });
export const websiteAttributionField = {
  type: new Schema({
    version: { type: Number, enum: [1] }, first_touch: touch,
    latest_non_direct_touch: { type: touch, default: undefined },
    capture_page: new Schema(page, { _id: false }),
    design: { id: String, version: String }, received_at: Date,
  }, { _id: false }),
  default: undefined, immutable: true,
};

/** Capture evidence is insert-only, including dotted query updates. */
export function applyWebsiteAttributionGuards(schema: Schema): void {
  schema.pre("validate", function () {
    if (!this.isNew && this.isModified("website_attribution")) {
      this.invalidate("website_attribution", "Website attribution is immutable after insert");
    }
  });
  schema.pre(["replaceOne", "findOneAndReplace"], function () {
    throw new Error("Form Lead replacement cannot preserve immutable attribution");
  });
  schema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
    const update = this.getUpdate();
    const protectedPath = (path: string) => path === "website_attribution" || path.startsWith("website_attribution.");
    if (Array.isArray(update)) {
      throw new Error("Form Lead replacement and pipeline updates cannot preserve immutable attribution");
    }
    for (const [operator, value] of Object.entries(update ?? {})) {
      if (protectedPath(operator) || (operator.startsWith("$") && value && typeof value === "object" &&
        Object.entries(value).some(([path, target]) => protectedPath(path) || (operator === "$rename" && typeof target === "string" && protectedPath(target))))) {
        throw new Error("Website attribution is immutable after insert");
      }
    }
  });
}
