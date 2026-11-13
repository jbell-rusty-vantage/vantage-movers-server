import { z } from "zod";

export const CMS_SCOPE = "main-site-optimization";
export const CMS_DATABASE = "testvantagemovers_sitepreview";
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const keySchema = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_.:/-]+$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value));
export const catalogSchema = z.array(z.object({
  key: keySchema, section: z.string().min(1).max(200), label: z.string().min(1).max(500),
  locale: z.enum(["en", "es", "shared"]), kind: z.enum(["text", "image"]),
  defaultValue: z.string().max(100_000),
  sourceFile: z.string().max(500).optional(), sourceLine: z.number().int().positive().optional(),
}).strict()).min(1).max(20_000).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.key)).size !== items.length) ctx.addIssue({ code: "custom", message: "Catalog keys must be unique" });
});
export type ContentField = z.infer<typeof catalogSchema>[number];
export const policySchema = z.object({
  minimumRating: z.number().int().min(1).max(5),
  excludedIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(10_000).transform(ids => [...new Set(ids)].sort()),
}).strict();
export type TestimonialPolicy = z.infer<typeof policySchema>;
export const DEFAULT_POLICY: TestimonialPolicy = { minimumRating: 4, excludedIds: [] };
const overridesSchema = z.preprocess((value, ctx) => {
  if (value && typeof value === "object" && Object.keys(value).some(key => ["__proto__", "prototype", "constructor"].includes(key))) {
    ctx.addIssue({ code: "custom", message: "Reserved content field name" });
    return z.NEVER;
  }
  return value;
}, z.record(keySchema, z.string().max(100_000).nullable()));
export const saveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  values: overridesSchema.default({}),
  testimonialPolicy: policySchema.optional(),
}).strict();
export const restoreSchema = z.object({ expectedRevision: z.number().int().min(0), revision: z.number().int().min(0) }).strict();
export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const uploadSchema = z.object({
  filename: z.string().min(1).max(180), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  base64: z.string().min(4).max(Math.ceil(MAX_MEDIA_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export type CmsActor = { id: string; email: string; requestId: string };
export type CmsSnapshot = { revision: number; values: Record<string, string>; testimonialPolicy: TestimonialPolicy; updatedAt: string; updatedBy: CmsActor };
export class CmsError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

function validateTextValue(field: ContentField, value: string): void {
  // Display text may reorder interpolation tokens, but cannot alter the dynamic facts.
  const tokens = (text: string) => (text.match(/\{\{[^{}]*\}\}/g) ?? []).sort();
  if (JSON.stringify(tokens(field.defaultValue)) !== JSON.stringify(tokens(value))) {
    throw new CmsError("Keep every numbered placeholder, such as {{0}}, exactly once for each occurrence in the original text.", 400, "CMS_INVALID_PLACEHOLDERS");
  }
  if (field.sourceFile !== "lib/content.ts") return;
  if (field.label.startsWith("phoneDisplay ·")) {
    const digits = value.replace(/\D/g, "");
    if (/[^+\d ().-]/.test(value) || !/^(?:1)?\d{10}$/.test(digits)) {
      throw new CmsError("Enter a 10-digit phone number, optionally prefixed with country code 1.", 400, "CMS_INVALID_PHONE");
    }
  }
  if (field.label.startsWith("email ·")) {
    // Mailto query/fragment characters must never turn a contact address into extra actions.
    const hasControlCharacter = [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!z.email().safeParse(value).success || hasControlCharacter || /[\s?#%&/\\:]/.test(value)) {
      throw new CmsError("Enter one valid email address without spaces or URL parameters.", 400, "CMS_INVALID_EMAIL");
    }
  }
}

export function applyValues(catalog: ContentField[], existing: Record<string, string>, changes: Record<string, string | null>): Record<string, string> {
  const fields = new Map(catalog.map(field => [field.key, field]));
  const registeredImages = new Set(catalog.filter(field => field.kind === "image").map(field => field.defaultValue));
  const result = { ...existing };
  for (const [key, value] of Object.entries(changes)) {
    const field = fields.get(key);
    if (!field) throw new CmsError(`Unknown content field: ${key}`, 400, "CMS_UNKNOWN_FIELD");
    if (value === null || value === field.defaultValue) { delete result[key]; continue; }
    if (field.kind === "text") validateTextValue(field, value);
    if (field.kind === "image" && !registeredImages.has(value) && !/^\/api\/site-content\/media\/[a-f0-9]{24}$/.test(value)) {
      throw new CmsError("Choose an uploaded image or restore the original image.", 400, "CMS_INVALID_IMAGE");
    }
    result[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 2_500_000) throw new CmsError("Content is too large.", 413, "CMS_CONTENT_TOO_LARGE");
  return result;
}

export function reviewSelection(review: { id: string; rating: number; published: boolean }, policy: TestimonialPolicy) {
  if (!review.published) return "unpublished" as const;
  if (policy.excludedIds.includes(review.id)) return "excluded" as const;
  if (review.rating < policy.minimumRating) return "below_minimum" as const;
  return "selected" as const;
}

export function validateImageBytes(bytes: Buffer, contentType: string): void {
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new CmsError("Images must be no larger than 2 MiB.", 413, "CMS_IMAGE_TOO_LARGE");
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR";
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const webp = bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) === bytes.length - 8 && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (!(contentType === "image/png" && png || contentType === "image/jpeg" && jpeg || contentType === "image/webp" && webp)) throw new CmsError("Upload a valid PNG, JPEG or WebP image.", 400, "CMS_INVALID_IMAGE");
}
