import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNumbersV2Args, seedLeadLinkFromAttachments } from "./numbers-v2";

test("numbers-v2 arguments: named target, dry run by default, bounded options, unknown flags refused", () => {
  assert.deepEqual(parseNumbersV2Args(["--target=vantagemovers"]), { target: "vantagemovers", apply: false, all: false, reseed: false, limit: null, after: null });
  assert.deepEqual(parseNumbersV2Args(["--target=db1", "--apply", "--all", "--reseed", "--limit=25", `--after=${"a".repeat(24)}`, "--allow-schema-drift"]),
    { target: "db1", apply: true, all: true, reseed: true, limit: 25, after: "a".repeat(24) });
  assert.throws(() => parseNumbersV2Args([]), /--target/);
  assert.throws(() => parseNumbersV2Args(["--target=a.b"]), /plain database name/);
  assert.throws(() => parseNumbersV2Args(["--target=db", "--limit=0"]), /--limit/);
  assert.throws(() => parseNumbersV2Args(["--target=db", "--after=xyz"]), /--after/);
  assert.throws(() => parseNumbersV2Args(["--target=db", "--force"]), /Unknown argument/);
  assert.throws(() => parseNumbersV2Args(["--target=db", "--all"], { allowed: ["--apply"] }), /Unknown argument/, "cleanup accepts only its own flags");
});

test("numbers-v2 seed: newest Owner-confirmed attachment pins, Owner rejections exclude, automatic edges seed nothing", () => {
  const ref = (id: string, model: "FormLead" | "CallLead" = "FormLead") => ({ model, id });
  const seed = seedLeadLinkFromAttachments([
    { lead_ref: ref("a"), state: "attached", certainty: "owner_confirmed", decided_at: new Date("2026-09-01T00:00:00Z"), decided_by: "owner-1" },
    { lead_ref: ref("b", "CallLead"), state: "attached", certainty: "owner_confirmed", decided_at: new Date("2026-09-03T00:00:00Z"), decided_by: "owner-2" },
    { lead_ref: ref("c"), state: "attached", certainty: "likely", decided_at: null },
    { lead_ref: ref("d"), state: "rejected", certainty: "rejected", decided_at: new Date("2026-09-02T00:00:00Z") },
    { lead_ref: ref("d"), state: "rejected", certainty: "rejected", decided_at: new Date("2026-09-02T00:00:00Z") },
    { lead_ref: ref("e"), state: "candidate", certainty: "likely", decided_at: new Date("2026-09-04T00:00:00Z") },
  ]);
  assert.deepEqual(seed.pin, { model: "CallLead", id: "b", set_at: new Date("2026-09-03T00:00:00Z"), set_by: "owner-2" });
  assert.deepEqual(seed.excluded, [{ model: "FormLead", id: "d" }]);
  assert.deepEqual(seedLeadLinkFromAttachments([{ lead_ref: ref("c"), state: "attached", certainty: "exact", decided_at: null }]), { pin: null, excluded: [] });
});
