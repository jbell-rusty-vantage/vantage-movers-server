import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { archiveJobKey, archiveObject, decodeChains, digest, encodeChains } from "./archiveCodec";
import { mergeEvidence } from "./archiveReads";
test("Granot evidence restores dates, BSON identifiers, decision links and original payload exactly", () => {
  const o = new ObjectId(), r = new ObjectId();
  const chain = { observation: { _id: o, receipt_id: r, captured_at: new Date(), identity: { normalized_job_no: "A001" } },
    receipt: { _id: r, payload: { unknown_original_field: "unchanged" } }, decisions: [{ _id: new ObjectId(), observation_id: o }] };
  const bytes = encodeChains("A001", [chain]);
  const [copy] = decodeChains(bytes, digest(bytes), "A001");
  assert.deepEqual(copy, chain);
  assert.throws(() => decodeChains(bytes, "0".repeat(64), "A001"), /checksum/);
  assert.throws(() => decodeChains(bytes, digest(bytes), "001"), /identity/);
  assert.throws(() => encodeChains("A001", [{ ...chain, decisions: [{ _id: new ObjectId(), observation_id: r }] }]), /mismatch/);
  assert.throws(() => archiveObject("../other", digest(bytes)), /Invalid/);
  assert.equal(archiveJobKey("A001"), archiveJobKey("001"));
  assert.notEqual(archiveJobKey("A001"), archiveJobKey("A1"));
  assert.deepEqual(mergeEvidence([{ _id: r, processing: "current" }], [copy.receipt]), [{ _id: r, processing: "current" }]);
});
