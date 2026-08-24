import mongoose, { type Types } from "mongoose";

type MongooseMongoRuntime = {
  ObjectId: {
    new (): Types.ObjectId;
    new (value: string): Types.ObjectId;
  };
};

function objectIdCtor(): MongooseMongoRuntime["ObjectId"] {
  // Preserve Mongoose's runtime driver path while insulating TypeScript 6 /
  // Vercel from mongodb's flattened declaration export. `Types.ObjectId` is
  // often a 0-arg constructor with no `toHexString` under that checker.
  return (mongoose.mongo as unknown as MongooseMongoRuntime).ObjectId;
}

/**
 * ObjectId helpers that stay type-stable under pnpm + TypeScript 6 / Vercel.
 *
 * Construct via `mongoose.mongo.ObjectId` (the driver class Mongoose already
 * loads) instead of a named `import { ObjectId } from "mongodb"`. Vercel's
 * serverless transpile of that named import has produced runtime
 * `ReferenceError: mongodb_1 is not defined` in production.
 *
 * Prefer this over `new mongoose.Types.ObjectId(...)` at call sites, which CI
 * sometimes types as a 0-arg constructor with no statics or `toHexString`.
 * Convert existing ids with `String(id)`, not `.toHexString()`.
 * See docs/typescript-library-typing-pitfalls.md.
 */

export function isObjectIdString(value: string): boolean {
  return mongoose.isValidObjectId(value);
}

export function toObjectId(value: string): Types.ObjectId {
  const ObjectId = objectIdCtor();
  return new ObjectId(value);
}

export function newObjectIdHex(): string {
  const ObjectId = objectIdCtor();
  return String(new ObjectId());
}

export function toObjectIdOrUndefined(
  value: string | null | undefined,
): Types.ObjectId | undefined {
  if (value == null || value === "") return undefined;
  return toObjectId(value);
}
