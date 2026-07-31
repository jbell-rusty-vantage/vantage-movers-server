import mongoose, { type Types } from "mongoose";

type MongooseMongoRuntime = {
  ObjectId: new (value: string) => Types.ObjectId;
};

/**
 * ObjectId helpers that stay type-stable under pnpm + TypeScript 6 / Vercel.
 *
 * Construct via `mongoose.mongo.ObjectId` (the driver class Mongoose already
 * loads) instead of a named `import { ObjectId } from "mongodb"`. Vercel's
 * serverless transpile of that named import has produced runtime
 * `ReferenceError: mongodb_1 is not defined` in production.
 *
 * Prefer this over `new mongoose.Types.ObjectId(...)` at call sites, which CI
 * sometimes types as a 0-arg constructor with no statics.
 * See docs/typescript-library-typing-pitfalls.md.
 */

export function isObjectIdString(value: string): boolean {
  return mongoose.isValidObjectId(value);
}

export function toObjectId(value: string): Types.ObjectId {
  // Preserve Mongoose's runtime driver path while insulating Vercel's checker
  // from mongodb's flattened declaration export.
  const { ObjectId } = mongoose.mongo as unknown as MongooseMongoRuntime;
  return new ObjectId(value);
}

export function toObjectIdOrUndefined(
  value: string | null | undefined,
): Types.ObjectId | undefined {
  if (value == null || value === "") return undefined;
  return toObjectId(value);
}
