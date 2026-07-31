import { ObjectId } from "mongodb";
import mongoose, { type Types } from "mongoose";

/**
 * ObjectId helpers that stay type-stable under pnpm + TypeScript 6 / Vercel.
 * Construct via `mongodb.ObjectId` instead of `mongoose.Types.ObjectId(...)`,
 * which CI sometimes types as a 0-arg constructor with no statics.
 * See docs/typescript-library-typing-pitfalls.md.
 */

export function isObjectIdString(value: string): boolean {
  return mongoose.isValidObjectId(value);
}

export function toObjectId(value: string): Types.ObjectId {
  return new ObjectId(value) as Types.ObjectId;
}

export function toObjectIdOrUndefined(
  value: string | null | undefined,
): Types.ObjectId | undefined {
  if (value == null || value === "") return undefined;
  return toObjectId(value);
}
