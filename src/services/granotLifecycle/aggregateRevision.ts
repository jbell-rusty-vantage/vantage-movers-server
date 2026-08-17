import type { ClientSession, Collection, ObjectId } from "mongodb";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";

export const DOMAIN_REVISION_CONFLICT =
  GRANOT_LIFECYCLE_ERROR_CODES.DOMAIN_REVISION_CONFLICT;

export type DomainRevisionCasFilter = {
  _id: ObjectId;
  domain_revision: number;
};

export type DomainRevisionCasResult =
  | { ok: true; domain_revision: number }
  | { ok: false; code: typeof DOMAIN_REVISION_CONFLICT };

export function assertDomainRevisionCasFilter(
  filter: DomainRevisionCasFilter,
): asserts filter is DomainRevisionCasFilter {
  if (filter._id == null) {
    throw new Error("compare-and-swap requires _id");
  }
  if (
    typeof filter.domain_revision !== "number" ||
    !Number.isInteger(filter.domain_revision) ||
    !Number.isFinite(filter.domain_revision) ||
    filter.domain_revision < 0
  ) {
    throw new Error("compare-and-swap requires a nonnegative integer domain_revision");
  }
}

export async function compareAndSwapDomainRevision(
  collection: Collection,
  filter: DomainRevisionCasFilter,
  session?: ClientSession,
): Promise<DomainRevisionCasResult> {
  assertDomainRevisionCasFilter(filter);
  const result = await collection.updateOne(
    { _id: filter._id, domain_revision: filter.domain_revision },
    { $inc: { domain_revision: 1 } },
    session ? { session } : {},
  );
  if (result.matchedCount === 0) {
    return { ok: false, code: DOMAIN_REVISION_CONFLICT };
  }
  return { ok: true, domain_revision: filter.domain_revision + 1 };
}
