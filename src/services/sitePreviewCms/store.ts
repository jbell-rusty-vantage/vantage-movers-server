import mongoose from "mongoose";
import { GridFSBucket, type ClientSession } from "mongodb";
import { toObjectId } from "../../utils/objectId";
import { connectMongo, withTransaction } from "../../db";
import { Testimonial } from "../../models/Testimonial";
import { CMS_DATABASE, CMS_SCOPE, CmsError, DEFAULT_POLICY, applyValues, catalogAdditions, catalogSchema, reviewSelection, validateImageBytes, type CmsActor, type CmsSnapshot, type ContentField, type TestimonialPolicy } from "./contract";

type ContentDocument = CmsSnapshot & { _id: string; catalog: ContentField[] };
type RevisionDocument = CmsSnapshot & { _id: string; scope: string; action: "save" | "restore" | "seed" | "catalog-append"; changedKeys: string[] };

async function database() {
  // Defense in depth: even accidental mounting in another app cannot reach production data.
  if (process.env.TEST_MODE !== "true" || process.env.TEST_MONGO_DATABASE_NAME !== CMS_DATABASE) throw new CmsError("Preview content is unavailable in this environment.", 503, "CMS_WRONG_ENVIRONMENT");
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db || db.databaseName !== CMS_DATABASE) throw new CmsError("Preview database mismatch.", 503, "CMS_WRONG_DATABASE");
  return db;
}

async function documents() { return (await database()).collection<ContentDocument>("site_preview_content"); }
async function revisions() { return (await database()).collection<RevisionDocument>("site_preview_content_revisions"); }
function snapshot(doc: CmsSnapshot): CmsSnapshot {
  return { revision: doc.revision, values: doc.values, testimonialPolicy: doc.testimonialPolicy, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
}
export async function readContent(session?: ClientSession) {
  const doc = await (await documents()).findOne({ _id: CMS_SCOPE }, { session });
  if (!doc) throw new CmsError("The preview content catalog has not been installed.", 503, "CMS_NOT_INITIALIZED");
  return { ...snapshot(doc), catalog: doc.catalog };
}
export async function readPublicContent() {
  const doc = await readContent();
  return { revision: doc.revision, values: doc.values, testimonialPolicy: doc.testimonialPolicy };
}

export async function installCatalog(input: unknown, options: { allowAppend?: boolean } = {}): Promise<{ installed: boolean; appended: number; fields: number; revision: number }> {
  const catalog = catalogSchema.parse(input);
  const collection = await documents();
  try {
    return await withTransaction(async session => {
      const existing = await collection.findOne({ _id: CMS_SCOPE }, { session });
      const updatedAt = new Date().toISOString();
      const updatedBy = { id: "catalog-install", email: "", requestId: "catalog-install" };
      if (!existing) {
        const initial: ContentDocument = { _id: CMS_SCOPE, catalog, revision: 0, values: {}, testimonialPolicy: DEFAULT_POLICY, updatedAt, updatedBy };
        await collection.insertOne(initial, { session });
        await (await revisions()).insertOne({ _id: `${CMS_SCOPE}:0`, scope: CMS_SCOPE, ...snapshot(initial), action: "seed", changedKeys: [] }, { session });
        return { installed: true, appended: 0, fields: catalog.length, revision: 0 };
      }
      const additions = catalogAdditions(existing.catalog, catalog, options.allowAppend);
      if (!additions.length) return { installed: false, appended: 0, fields: catalog.length, revision: existing.revision };
      const next = { ...snapshot(existing), revision: existing.revision + 1, updatedAt, updatedBy };
      const result = await collection.updateOne({ _id: CMS_SCOPE, revision: existing.revision }, { $set: { ...next, catalog } }, { session });
      if (result.matchedCount !== 1) throw new CmsError("Content changed during catalog append. Retry the reviewed append.", 409, "CMS_REVISION_CONFLICT");
      await (await revisions()).insertOne({ _id: `${CMS_SCOPE}:${next.revision}`, scope: CMS_SCOPE, ...next, action: "catalog-append", changedKeys: additions.map(field => field.key) }, { session });
      return { installed: false, appended: additions.length, fields: catalog.length, revision: next.revision };
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) return installCatalog(catalog, options);
    throw error;
  }
}

async function persistRevision(current: Awaited<ReturnType<typeof readContent>>, next: Pick<CmsSnapshot, "values" | "testimonialPolicy">, actor: CmsActor, action: "save" | "restore", session: ClientSession) {
  const changedKeys = [...new Set([...Object.keys(current.values), ...Object.keys(next.values)])].filter(key => current.values[key] !== next.values[key]);
  if (JSON.stringify(current.testimonialPolicy) !== JSON.stringify(next.testimonialPolicy)) changedKeys.push("testimonialPolicy");
  if (!changedKeys.length) return { ...current, changed: false };
  const saved: CmsSnapshot = { ...next, revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
  const result = await (await documents()).updateOne({ _id: CMS_SCOPE, revision: current.revision }, { $set: saved }, { session });
  if (result.matchedCount !== 1) throw new CmsError("Content changed since you opened it. Reload before saving.", 409, "CMS_REVISION_CONFLICT");
  await (await revisions()).insertOne({ _id: `${CMS_SCOPE}:${saved.revision}`, scope: CMS_SCOPE, ...saved, action, changedKeys }, { session });
  return { ...saved, catalog: current.catalog, changed: true };
}
function assertRevision(actual: number, expected: number) {
  if (actual !== expected) throw new CmsError("Content changed since you opened it. Reload before saving.", 409, "CMS_REVISION_CONFLICT");
}
export async function saveContent(input: { expectedRevision: number; values: Record<string, string | null>; testimonialPolicy?: TestimonialPolicy }, actor: CmsActor) {
  await database();
  return withTransaction(async session => {
    const current = await readContent(session);
    assertRevision(current.revision, input.expectedRevision);
    const values = applyValues(current.catalog, current.values, input.values);
    const mediaIds = [...new Set(Object.entries(input.values).filter(([key, value]) => value !== null && current.catalog.find(field => field.key === key)?.kind === "image" && /^\/api\/site-content\/media\//.test(value)).map(([, value]) => value!.split("/").at(-1)!))].map(toObjectId);
    if (mediaIds.length) {
      const count = await (await database()).collection("site_preview_media.files").countDocuments({ _id: { $in: mediaIds }, "metadata.scope": CMS_SCOPE }, { session });
      if (count !== mediaIds.length) throw new CmsError("One or more selected images are unavailable.", 400, "CMS_IMAGE_NOT_FOUND");
    }
    return persistRevision(current, { values, testimonialPolicy: input.testimonialPolicy ?? current.testimonialPolicy }, actor, "save", session);
  });
}
export async function restoreContent(input: { expectedRevision: number; revision: number }, actor: CmsActor) {
  await database();
  return withTransaction(async session => {
    const current = await readContent(session);
    assertRevision(current.revision, input.expectedRevision);
    const previous = await (await revisions()).findOne({ _id: `${CMS_SCOPE}:${input.revision}` }, { session });
    if (!previous) throw new CmsError("Content revision not found.", 404, "CMS_REVISION_NOT_FOUND");
    return persistRevision(current, { values: previous.values, testimonialPolicy: previous.testimonialPolicy }, actor, "restore", session);
  });
}
export async function listHistory(page: number, limit: number) {
  const collection = await revisions();
  const [docs, total] = await Promise.all([collection.find({ scope: CMS_SCOPE }).sort({ revision: -1 }).skip((page - 1) * limit).limit(limit).toArray(), collection.countDocuments({ scope: CMS_SCOPE })]);
  return { items: docs.map(({ revision, updatedAt, updatedBy, changedKeys, action }) => ({ revision, updatedAt, updatedBy, changedKeys, action })), page, limit, total, has_next_page: page * limit < total };
}

export function testimonialFilter(policy: TestimonialPolicy) {
  return { published: true, rating: { $gte: policy.minimumRating }, _id: { $nin: policy.excludedIds.map(toObjectId) } };
}
export async function listCmsTestimonials(page: number, limit: number, admin = false) {
  const { testimonialPolicy } = await readContent();
  const filter = admin ? {} : testimonialFilter(testimonialPolicy);
  const [docs, total] = await Promise.all([
    Testimonial.find(filter).select("source reviewer_name review_date rating review_text business_response published featured").sort({ review_date: -1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
    Testimonial.countDocuments(filter).exec(),
  ]);
  const items = docs.map(doc => {
    const item = { id: doc._id.toString(), source: doc.source, reviewer_name: doc.reviewer_name, review_date: doc.review_date, rating: doc.rating, review_text: doc.review_text, business_response: doc.business_response ?? null, published: doc.published === true, featured: doc.featured === true };
    const reason = reviewSelection(item, testimonialPolicy);
    return admin ? { ...item, eligible: reason === "selected", reason } : item;
  });
  return { items, page, limit, total, has_next_page: page * limit < total };
}

export async function uploadMedia(input: { filename: string; contentType: string; base64: string }, actor: CmsActor) {
  const bytes = Buffer.from(input.base64, "base64");
  validateImageBytes(bytes, input.contentType);
  const bucket = new GridFSBucket(await database(), { bucketName: "site_preview_media" });
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stream = bucket.openUploadStream(safeName, { metadata: { scope: CMS_SCOPE, contentType: input.contentType, uploadedBy: actor, size: bytes.length } });
  await new Promise<void>((resolve, reject) => { stream.once("error", reject); stream.once("finish", resolve); stream.end(bytes); });
  return { id: String(stream.id), url: `/api/site-content/media/${String(stream.id)}`, contentType: input.contentType, size: bytes.length };
}
export async function readMedia(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new CmsError("Image not found.", 404, "CMS_IMAGE_NOT_FOUND");
  const bucket = new GridFSBucket(await database(), { bucketName: "site_preview_media" });
  const objectId = toObjectId(id);
  const files = await bucket.find({ _id: objectId, "metadata.scope": CMS_SCOPE }).limit(1).toArray();
  const file = files[0];
  if (!file) throw new CmsError("Image not found.", 404, "CMS_IMAGE_NOT_FOUND");
  return { stream: bucket.openDownloadStream(objectId), contentType: String(file.metadata?.contentType ?? "application/octet-stream"), size: file.length };
}
