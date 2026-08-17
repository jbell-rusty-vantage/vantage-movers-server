import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import {
  assertDomainRevisionCasFilter,
  DOMAIN_REVISION_CONFLICT,
} from "./aggregateRevision";

test("[AC-21] CAS primitive requires { _id, domain_revision } and names DOMAIN_REVISION_CONFLICT", () => {
  assert.equal(DOMAIN_REVISION_CONFLICT, "DOMAIN_REVISION_CONFLICT");
  assert.doesNotThrow(() =>
    assertDomainRevisionCasFilter({
      _id: new ObjectId(),
      domain_revision: 0,
    }),
  );
  assert.throws(() =>
    assertDomainRevisionCasFilter({
      _id: new ObjectId(),
      domain_revision: -1,
    } as never),
  );
  assert.throws(() =>
    assertDomainRevisionCasFilter({
      _id: new ObjectId(),
      domain_revision: 1.5,
    } as never),
  );
});
