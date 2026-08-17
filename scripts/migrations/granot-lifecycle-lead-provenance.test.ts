import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HISTORICAL_DATABASE } from "./operations-registry-migration.lib";
import {
  ALL_REVISION_COLLECTIONS,
  HISTORICAL_REVISION_TARGET_COLLECTIONS,
  LEAD_REVISION_COLLECTIONS,
  assertNotHistoricalDatabase,
  assertRevisionApplyAllowed,
  persistReviewedBoundary,
  planRevisionBackfill,
  resolveReviewedBoundary,
  verifyRevisionInventory,
} from "./granot-lifecycle-revisions.lib";
import {
  LEAD_PROVENANCE_REVISION_COLLECTIONS,
  leadRevisionManifestBody,
  planLeadRevisionMigration,
} from "./granot-lifecycle-lead-provenance.lib";

const REVIEWED = "2026-08-17T20:00:00.000Z";

function row(
  id: string,
  overrides: Partial<{
    domain_revision: unknown;
    last_change_id: unknown;
    last_changed_at: unknown;
    change_history_started_at: unknown;
  }> = {},
) {
  return { _id: id, ...overrides };
}

test("[AC-32] lead provenance Unit 09 owns only Form/Call revision and boundary fields", () => {
  assert.deepEqual([...LEAD_PROVENANCE_REVISION_COLLECTIONS], ["form_leads", "call_leads"]);
  assert.deepEqual([...LEAD_REVISION_COLLECTIONS], ["form_leads", "call_leads"]);
  assert.deepEqual([...HISTORICAL_REVISION_TARGET_COLLECTIONS], []);
  assert.ok(ALL_REVISION_COLLECTIONS.includes("form_leads"));
  assert.throws(() => assertNotHistoricalDatabase(HISTORICAL_DATABASE));
});

test("[AC-32] report plans only missing revisions/boundaries and fabricates no history", () => {
  const plans = planLeadRevisionMigration({
    rowsByCollection: {
      form_leads: [
        row("aaaaaaaaaaaaaaaaaaaaaaaa"),
        row("bbbbbbbbbbbbbbbbbbbbbbbb", { domain_revision: 4 }),
        row("cccccccccccccccccccccccc", {
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
        }),
      ],
      call_leads: [row("dddddddddddddddddddddddd")],
    },
  });
  const form = plans[0];
  assert.equal(form?.missing_revision, 1);
  assert.equal(form?.valid_revision, 2);
  assert.equal(form?.planned.length, 2);
  assert.equal(form?.already_current, 1);
  assert.equal(
    form?.planned.every((entry) => entry.set_revision || entry.set_boundary),
    true,
  );
  const manifest = leadRevisionManifestBody({
    databaseName: "testvantagemovers",
    databaseCategory: "test",
    mode: "report",
    reviewedBoundary: REVIEWED,
    boundarySource: "requested",
    plans,
    applied: 0,
  });
  assert.equal(manifest.applied, 0);
  assert.equal(manifest.last_change_writes, 0);
  assert.equal(manifest.fabricated_entity_changes, 0);
  assert.equal(manifest.fabricated_decisions, 0);
  assert.equal(manifest.fabricated_commands, 0);
  assert.equal(manifest.sheet_sync_requests, 0);
  assert.deepEqual(manifest.historical_collections_targeted, []);
  assert.equal(JSON.stringify(manifest).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-32] invalid revisions, malformed dates, and one-sided last-change are blockers", () => {
  const plan = planRevisionBackfill({
    collection: "form_leads",
    rows: [
      row("aaaaaaaaaaaaaaaaaaaaaaaa", { domain_revision: -1 }),
      row("bbbbbbbbbbbbbbbbbbbbbbbb", { domain_revision: 1.5 }),
      row("cccccccccccccccccccccccc", { change_history_started_at: "not-a-date" }),
      row("dddddddddddddddddddddddd", { last_change_id: "eeeeeeeeeeeeeeeeeeeeeeee" }),
    ],
  });
  assert.equal(plan.blockers.length, 4);
  assert.equal(plan.planned.length, 0);
  assert.throws(() => assertRevisionApplyAllowed({ plans: [plan] }));
  const serialized = JSON.stringify(plan.blockers);
  assert.equal(serialized.includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("[AC-32] existing positive revisions and valid boundaries are never planned for overwrite", () => {
  const plan = planRevisionBackfill({
    collection: "call_leads",
    rows: [
      row("aaaaaaaaaaaaaaaaaaaaaaaa", {
        domain_revision: 7,
        change_history_started_at: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ],
  });
  assert.equal(plan.planned.length, 0);
  assert.equal(plan.already_current, 1);
  assert.equal(plan.valid_revision, 1);
  assert.equal(plan.valid_boundary, 1);
});

test("[AC-32] verify fails on every missing or invalid invariant", () => {
  const missing = verifyRevisionInventory({
    collection: "form_leads",
    rows: [row("aaaaaaaaaaaaaaaaaaaaaaaa")],
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.some((failure) => failure.includes("missing domain_revision")));
  assert.ok(missing.failures.some((failure) => failure.includes("missing change_history_started_at")));

  const valid = verifyRevisionInventory({
    collection: "form_leads",
    rows: [
      row("aaaaaaaaaaaaaaaaaaaaaaaa", {
        domain_revision: 0,
        change_history_started_at: new Date(REVIEWED),
      }),
    ],
  });
  assert.equal(valid.ok, true);
});

test("[AC-32] one reviewed ISO boundary is persisted and reused, never advanced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "u09-lead-boundary-"));
  try {
    const first = await resolveReviewedBoundary({
      requested: REVIEWED,
      allowGenerate: true,
      directory,
    });
    assert.equal(first.record.reviewed_change_history_started_at, REVIEWED);
    const reused = await resolveReviewedBoundary({
      allowGenerate: true,
      now: new Date("2026-12-01T00:00:00.000Z"),
      directory,
    });
    assert.equal(reused.source, "persisted");
    assert.equal(reused.record.reviewed_change_history_started_at, REVIEWED);
    await persistReviewedBoundary(REVIEWED, directory);
    await assert.rejects(() =>
      resolveReviewedBoundary({
        requested: "2026-12-01T00:00:00.000Z",
        directory,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
