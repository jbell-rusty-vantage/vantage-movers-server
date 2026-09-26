import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionRowDtoSchema, type AttentionRowDto } from "../dto";
import { ambiguousReviewFixture } from "../fixtures";
import { defaultCsiPolicy } from "../policy";
import { attentionIndexEntry } from "./attentionIndex";
import { staffedMinutesBetween } from "./staffing";
import { attentionIdentity, decodeAttentionArtifact, encodeAttentionManifest, orderManifestEntries, restoreAttentionRow, type ManifestEntry } from "./attentionManifest";

const policy = defaultCsiPolicy();
const staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
const asOf = new Date("2026-11-02T15:00:00Z");
function row(n: number, from = "2026-10-31T14:00:00Z", at = asOf): AttentionRowDto {
  const id = n.toString(16).padStart(24, "0");
  const derived = { ...ambiguousReviewFixture.derived, age_wall_ms: Math.max(0, +at - Date.parse(from)),
    age_staffed_ms: staffedMinutesBetween(new Date(from), at, staffing) * 60_000 };
  const subject = { kind: "number_review" as const, contact_number_id: id };
  return attentionRowDtoSchema.parse({ ...ambiguousReviewFixture, partition: "active", subject_key: `number_review:${id}`, subject, derived,
    outreach: { id, revision: 1, subject, state: "open", reason: null,
      assignment: { agent: null, origin: null, assigned_at: null, evidence_ref: null, owner_instruction_id: null },
      followups: [], followups_cursor: null, next_action: null, first_human_conversation_at: null, trigger_at: from,
      last_meaningful_contact_at: null, derived, related_record_links: [], allowed_actions: [] } });
}
const encode = (rows: AttentionRowDto[]) => encodeAttentionManifest(rows, staffing, attentionIndexEntry);
function decode(result: ReturnType<typeof encode>, at: Date) {
  const values = new Map(result.artifacts.map(a => [a.hash, decodeAttentionArtifact(a.kind, a.hash, a.bytes)]));
  const entries = orderManifestEntries(result.entries, values.get(result.manifest.order));
  return entries.map(entry => restoreAttentionRow((values.get(result.manifest.rows[entry.bucket]!) as unknown[])[entry.position], at, result.manifest.staffing));
}
test("manifest round trip preserves both age locations through DST and future anchors without mutating shared content", () => {
  const rows = [row(1), row(2, "2026-11-03T16:00:00Z"), ambiguousReviewFixture];
  const encoded = encode(rows);
  assert.deepEqual(decode(encoded, asOf), rows);
  const later = new Date(+asOf + 180_000);
  assert.deepEqual(decode(encoded, later), [row(1, undefined, later), row(2, "2026-11-03T16:00:00Z", later), ambiguousReviewFixture]);
  assert.deepEqual(decode(encoded, asOf), rows);
});
test("an unchanged tick writes zero artifacts and uses header staffing, including after policy change", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(i));
  const first = encode(rows);
  const next = encode(rows.map((_, i) => row(i, undefined, new Date(+asOf + 180_000))));
  assert.deepEqual(first.artifacts.map(a => a.hash), next.artifacts.map(a => a.hash));
  const changedPolicy = encodeAttentionManifest(rows, { timezone: "UTC", staffed_hours: [] }, attentionIndexEntry);
  assert.deepEqual(first.artifacts.map(a => a.hash), changedPolicy.artifacts.map(a => a.hash));
  assert.equal(decode(changedPolicy, asOf)[0]!.derived.age_staffed_ms, 0);
  assert.ok(decode(first, asOf)[0]!.derived.age_staffed_ms > 0);
});
test("business change, insertion, removal and reorder rewrite only affected buckets and explicit order", () => {
  const rows = Array.from({ length: 1500 }, (_, i) => row(i));
  const first = encode(rows), hashes = new Set(first.artifacts.map(a => a.hash));
  const changed = structuredClone(rows); changed[10]!.outreach!.revision++;
  const second = encode(changed);
  const newArtifacts = second.artifacts.filter(a => !hashes.has(a.hash));
  assert.equal(newArtifacts.length, 1); // Revision is indexed only when band_since exists.
  assert.ok(newArtifacts.reduce((sum, a) => sum + a.bytes.length, 0) < first.artifacts.reduce((sum, a) => sum + a.bytes.length, 0) / 100);
  const inserted = encode([row(99999), ...rows]);
  assert.ok(inserted.artifacts.filter(a => !hashes.has(a.hash)).length <= 3);
  const removed = encode(rows.slice(1));
  assert.ok(removed.artifacts.filter(a => !hashes.has(a.hash)).length <= 3);
  const reversed = encode([...rows].reverse());
  assert.deepEqual(reversed.manifest.rows, first.manifest.rows);
  assert.deepEqual(reversed.manifest.indexes, first.manifest.indexes);
  assert.notEqual(reversed.manifest.order, first.manifest.order);
  assert.deepEqual(decode(reversed, asOf), [...rows].reverse());
});
test("active/closed identities stay distinct, duplicate or corrupt artifacts fail explicitly", () => {
  const active = row(1), closed = { ...row(1), partition: "closed" as const };
  const encoded = encode([closed, active]);
  assert.deepEqual(decode(encoded, asOf).map(attentionIdentity), [attentionIdentity(closed), attentionIdentity(active)]);
  assert.throws(() => encode([active, active]), /Duplicate/);
  const artifact = encoded.artifacts[0]!;
  assert.throws(() => decodeAttentionArtifact(artifact.kind, artifact.hash, Buffer.from("corrupt")), /hash mismatch/);
  assert.throws(() => orderManifestEntries(encoded.entries, ["absent", "absent"]), /mismatch/);
  assert.throws(() => orderManifestEntries([...encoded.entries, encoded.entries[0]!] as ManifestEntry[], ["a", "b", "c"]), /Duplicate/);
});
