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
  assertLeadProvenanceApplyAllowed,
  buildLegacyBaselineContactSnapshot,
  buildLegacyBaselineMoveSnapshot,
  classifyLeadIngestionOrigin,
  classifyLeadJob,
  leadProvenanceApplyManifest,
  leadProvenanceReviewProjection,
  leadRevisionManifestBody,
  persistReviewedBaseline,
  planLeadProvenanceMigration,
  planLeadRevisionMigration,
  resolveReviewedBaseline,
  scanLeadProvenanceArtifactForPii,
  verifyLeadProvenanceMigration,
  type LeadProvenanceInventoryRow,
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

const BASELINE = "2026-08-17T21:00:00.000Z";
const FORM_SCOPE = "aaaaaaaaaaaaaaaaaaaaaaaa";
const CALL_SCOPE = "bbbbbbbbbbbbbbbbbbbbbbbb";

function provenanceRow(
  id: string,
  overrides: Partial<LeadProvenanceInventoryRow> = {},
): LeadProvenanceInventoryRow {
  return { _id: id, ...overrides };
}

test("[AC-10][AC-11][AC-12] foundation/partial: unknown origin is legacy_unknown; labels and transport never decide", () => {
  assert.deepEqual(
    classifyLeadIngestionOrigin({ kind: "form", ingestion_origin: undefined }),
    { status: "missing", planned_origin: "legacy_unknown" },
  );
  assert.deepEqual(
    classifyLeadIngestionOrigin({ kind: "call", ingestion_origin: undefined }),
    { status: "missing", planned_origin: "legacy_unknown" },
  );
  assert.equal(
    classifyLeadIngestionOrigin({ kind: "form", ingestion_origin: "wordpress_form" }).status,
    "valid_deterministic",
  );
  assert.equal(
    classifyLeadIngestionOrigin({ kind: "form", ingestion_origin: "not_a_real_origin" }).status,
    "contradiction",
  );
  assert.equal(
    classifyLeadIngestionOrigin({ kind: "call", ingestion_origin: "legacy_import" }).status,
    "valid_deterministic",
  );
  const plans = planLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [
        provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
          name: "Synthetic User",
          phone_number: "5550100130",
          ringcentral_ingestion_source: "webhook",
        }),
      ],
      call_leads: [
        provenanceRow("bbbbbbbbbbbbbbbbbbbbbbbb", {
          name: "Synthetic Caller",
          phone_number: "5550100131",
          ringcentral_ingestion_source: "call_log_sync",
        }),
      ],
    },
  });
  assert.equal(plans[0]?.planned[0]?.planned_origin, "legacy_unknown");
  assert.equal(plans[1]?.planned[0]?.planned_origin, "legacy_unknown");
  assert.equal(plans[0]?.legacy_unknown_count, 1);
  assert.equal(plans[0]?.deterministic_origin_count, 0);
});

test("[AC-10][AC-11] foundation/partial: Job normalize from job_no only; ref_no and lid never become Job", () => {
  const fromJob = classifyLeadJob(
    provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", { job_no: "ab-12" }),
  );
  assert.equal(fromJob.planned_normalized, "AB 12");
  assert.equal(fromJob.raw_present, true);
  const fromRef = classifyLeadJob(
    provenanceRow("bbbbbbbbbbbbbbbbbbbbbbbb", { ref_no: "DT_u13ref", lid: "LID-99" }),
  );
  assert.equal(fromRef.missing, true);
  assert.equal(fromRef.planned_normalized, undefined);
  const mismatch = classifyLeadJob(
    provenanceRow("cccccccccccccccccccccccc", {
      job_no: "ab-12",
      normalized_job_no: "OTHER",
    }),
  );
  assert.equal(mismatch.contradiction, true);
});

test("[AC-10][AC-11] foundation/partial: baseline copies current fields only and never labels original submission", () => {
  const capturedAt = new Date(BASELINE);
  const contact = buildLegacyBaselineContactSnapshot(
    provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
      name: "Synthetic User",
      phone_number: "5550100130",
    }),
    capturedAt,
  );
  assert.equal(contact?.evidence_status, "legacy_baseline");
  assert.equal(contact?.name, "Synthetic User");
  assert.equal(contact?.first_name, undefined);
  assert.equal(contact?.normalized_phone_number, undefined);
  const empty = buildLegacyBaselineContactSnapshot(
    provenanceRow("bbbbbbbbbbbbbbbbbbbbbbbb"),
    capturedAt,
  );
  assert.equal(empty, undefined);
  const move = buildLegacyBaselineMoveSnapshot(
    provenanceRow("cccccccccccccccccccccccc", {
      pickup_zip: "10001",
      destination_zip: "94105",
    }),
    capturedAt,
  );
  assert.equal(move?.evidence_status, "legacy_baseline");
  assert.equal(move?.pickup_city, undefined);
  assert.equal(move?.move_date, undefined);
});

test("[AC-10][AC-11][AC-12] foundation/partial: planner preserves captured snapshots, revisions, and business-field silence", () => {
  const plans = planLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [
        provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
          ingestion_origin: "wordpress_form",
          job_no: "SYN-U13-1",
          normalized_job_no: "SYN U13 1",
          name: "Synthetic User",
          phone_number: "5550100130",
          pickup_zip: "10001",
          destination_zip: "94105",
          ingested_contact_snapshot: {
            name: "Synthetic User",
            captured_at: new Date("2026-01-01T00:00:00.000Z"),
            evidence_status: "captured_at_ingestion",
          },
          ingested_move_snapshot: {
            pickup_zip: "10001",
            captured_at: new Date("2026-01-01T00:00:00.000Z"),
            evidence_status: "captured_at_ingestion",
          },
          domain_revision: 4,
          change_history_started_at: new Date(REVIEWED),
          duplicate: true,
          bad_lead: "test",
        }),
        provenanceRow("bbbbbbbbbbbbbbbbbbbbbbbb", {
          ingestion_origin: "not_real",
          name: "Synthetic Blocked",
        }),
      ],
      call_leads: [
        provenanceRow("cccccccccccccccccccccccc", {
          name: "Synthetic Caller",
          phone_number: "5550100131",
          job_no: "SYN-U13-2",
          source_granularity_id: CALL_SCOPE,
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
        }),
        provenanceRow("dddddddddddddddddddddddd", {
          name: "Synthetic Collision A",
          job_no: "SYN-U13-2",
          normalized_job_no: "SYN U13 2",
          source_granularity_id: CALL_SCOPE,
        }),
      ],
    },
  });
  const form = plans[0];
  assert.equal(form?.unchanged, 1);
  assert.equal(form?.blocked, 1);
  assert.equal(form?.planned.length, 0);
  assert.equal(form?.snapshot_captured_at_ingestion, 1);
  assert.equal(form?.duplicate_count, 1);
  assert.equal(form?.bad_lead_count, 1);
  assert.equal(form?.revision_would_preserve, 1);
  assert.equal(form?.history_boundary_would_preserve, 1);
  const call = plans[1];
  assert.equal(call?.planned.length, 2);
  assert.equal(call?.planned[0]?.set_origin, true);
  assert.equal(call?.planned[0]?.set_normalized_job_no, true);
  assert.equal(call?.planned[0]?.set_contact_snapshot, true);
  assert.equal(call?.collision_groups.length, 1);
  assert.throws(() =>
    assertLeadProvenanceApplyAllowed({
      plans,
      revisionPlans: planLeadRevisionMigration({
        rowsByCollection: {
          form_leads: [provenanceRow("bbbbbbbbbbbbbbbbbbbbbbbb", { domain_revision: -1 })],
          call_leads: [],
        },
      }),
    }),
  );
});

test("[AC-10][AC-11][AC-12] foundation/partial: manifests are deterministic and PII-safe", () => {
  const plans = planLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [
        provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
          name: "Synthetic User",
          phone_number: "5550100130",
          email: "synthetic.user@example.test",
          job_no: "SYN-U13-100",
          pickup_zip: "10001",
          source_granularity_id: FORM_SCOPE,
        }),
      ],
      call_leads: [],
    },
  });
  const revisionPlans = planLeadRevisionMigration({
    rowsByCollection: {
      form_leads: [provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa")],
      call_leads: [],
    },
  });
  const apply = leadProvenanceApplyManifest({
    databaseName: "testvantagemovers",
    databaseCategory: "test",
    mode: "report",
    baselineCapturedAt: BASELINE,
    baselineSource: "requested",
    reviewedBoundary: REVIEWED,
    plans,
    revisionPlans,
    applied: 0,
  });
  const review = leadProvenanceReviewProjection({
    databaseName: "testvantagemovers",
    databaseCategory: "test",
    mode: "report",
    baselineCapturedAt: BASELINE,
    baselineSource: "requested",
    reviewedBoundary: REVIEWED,
    plans,
    revisionPlans,
    applied: 0,
    applyChecksum: apply.checksum,
  });
  assert.equal(apply.applied, 0);
  assert.equal(apply.fabricated_entity_changes, 0);
  assert.equal(review.protected_manifest_checksum, apply.checksum);
  assert.equal(JSON.stringify(review).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(JSON.stringify(review).includes("Synthetic User"), false);
  assert.equal(JSON.stringify(review).includes("5550100130"), false);
  assert.equal(JSON.stringify(review).includes("SYN-U13-100"), false);
  assert.equal(JSON.stringify(apply).includes("Synthetic User"), false);
  assert.equal(JSON.stringify(apply).includes("5550100130"), false);
  assert.deepEqual(scanLeadProvenanceArtifactForPii(review), []);
  assert.deepEqual(scanLeadProvenanceArtifactForPii(apply), []);
});

test("[AC-10][AC-11][AC-12] foundation/partial: verify fails remaining planned rows, mismatches, and revision regression", () => {
  const missing = verifyLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", { name: "Synthetic User" })],
      call_leads: [],
    },
    baselineCapturedAt: BASELINE,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.some((failure) => failure.includes("remaining planned")));
  assert.ok(missing.failures.some((failure) => failure.includes("missing domain_revision")));

  const valid = verifyLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [
        provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
          ingestion_origin: "legacy_unknown",
          name: "Synthetic User",
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
          ingested_contact_snapshot: {
            name: "Synthetic User",
            captured_at: new Date(BASELINE),
            evidence_status: "legacy_baseline",
          },
        }),
      ],
      call_leads: [],
    },
    baselineCapturedAt: BASELINE,
  });
  assert.equal(valid.ok, true);

  const overwritten = verifyLeadProvenanceMigration({
    rowsByCollection: {
      form_leads: [
        provenanceRow("aaaaaaaaaaaaaaaaaaaaaaaa", {
          ingestion_origin: "legacy_unknown",
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
          ingested_contact_snapshot: {
            name: "Synthetic User",
            captured_at: new Date("2020-01-01T00:00:00.000Z"),
            evidence_status: "legacy_baseline",
          },
        }),
      ],
      call_leads: [],
    },
    baselineCapturedAt: BASELINE,
  });
  assert.equal(overwritten.ok, false);
  assert.ok(overwritten.failures.some((failure) => failure.includes("captured_at")));
});

test("[AC-32] one reviewed ISO baseline is persisted and reused, never advanced or taken from history boundary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "u13-lead-baseline-"));
  try {
    const first = await resolveReviewedBaseline({
      requested: BASELINE,
      allowGenerate: true,
      directory,
    });
    assert.equal(first.record.baseline_captured_at, BASELINE);
    const reused = await resolveReviewedBaseline({
      allowGenerate: true,
      now: new Date("2026-12-01T00:00:00.000Z"),
      directory,
    });
    assert.equal(reused.source, "persisted");
    assert.equal(reused.record.baseline_captured_at, BASELINE);
    await persistReviewedBaseline(BASELINE, directory);
    await assert.rejects(() =>
      resolveReviewedBaseline({
        requested: "2026-12-01T00:00:00.000Z",
        directory,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
