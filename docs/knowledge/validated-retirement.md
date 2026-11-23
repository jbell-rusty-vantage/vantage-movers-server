---
type: Reference
title: Validated retirement
description: The Owner's standing strategy (2026-11-22) for records that grow with operation volume — receipts, observations, job rows, events, attempts. A record leaves MongoDB only after the system proves it did its job (its lifecycle effect exists in the owning business record), packs it to GCS with a verified create-only write, catalogues it and can restore it by original ID. GCS keeps it 60–90 days. Adoption checklist, standard numbers, the reference implementation and where every service stands.
tags: [storage, cloud-storage, retention, durable-work]
status: draft
stale_after: 2027-02-28
resource: src/services/salesIntelligence/retirement/
applies_to:
  - src/services/salesIntelligence/retirement/evidence.ts
  - src/services/salesIntelligence/retirement/pack.ts
  - src/services/salesIntelligence/retirement/worker.ts
  - src/services/salesIntelligence/retirement/control.ts
  - src/services/cloudStorage/namespaces.ts
  - src/services/granotHistory/retireOnUse.ts
  - ops/sales-outreach/job-retirement.ts
owners: [team:main-server]
sources:
  - id: audit
    resource: docs/operations/VALIDATED-RETIREMENT-AUDIT-2026-11-22.md
    title: Cross-service audit, 2026-11-22
  - id: cloud-storage
    resource: docs/knowledge/services/cloud-storage.md
  - id: granot
    resource: docs/knowledge/granot-lifecycle/storage-retention-operations.md
  - id: si-brief
    resource: docs/operations/SI-JOBS-VOLUME-BRIEF-2026-11-22.md
---
# Validated retirement

**Owner directive (2026-11-22, standing).** Keeping MongoDB storage low is a serious priority. A record that grows with operation volume leaves MongoDB only when the system can say: *this record was used for its purpose, its lifecycle effect exists, and it can be reliably retired.* Before it leaves, it is in GCS, verified, catalogued and restorable by original ID for validation. GCS keeps it **60–90 days** (90 by default). Every service that retires such records follows this page, and next session reviews and optimizes every service against it ([audit](../operations/VALIDATED-RETIREMENT-AUDIT-2026-11-22.md)).

## The rule

A record may leave MongoDB only after all five steps succeed, in this order:

1. **Used.** A check reads the owning business record and proves the record's lifecycle effect is there. Examples: an evaluation job's projection holds that publication revision or a later one; a capture job's call interactions are at its revision or later; a Granot receipt's Lead effect is committed. A queue status or a calendar age is never proof on its own.
2. **Packed.** The record's exact stored BSON (never re-serialized) goes into a gzip pack, written **create-only** through the [Cloud Storage module](services/cloud-storage.md).
3. **Verified.** The bytes read back from the pinned generation have the expected SHA-256, and decoding them returns every original record byte for byte.
4. **Catalogued.** MongoDB records where it is (object name, generation, SHA-256, size) before any record changes. Prefer one catalog row per pack (id and time ranges, counts) over one locator per record: at high volume, per-record locators eat the saving.
5. **Retired.** Only then is the record removed or compacted, with a fence on the exact row that was proven (`_id`, status, immutable fields).

A failure at any step changes nothing in MongoDB. A record whose effect is not found is **held**: it keeps its ordinary window, already archived, and appears in the run report by reason.

## What stays in MongoDB

- **Dedupe and replay fences.** The archive never replaces a dedupe key. A key stays (as a compact receipt or fence) until no producer can generate it again. State the hard bound for every producer, not the usual case: the capture key lives 7 days because receipt recovery can lag by days and receipts live 7 days.
- **Rows a reader needs in MongoDB**, for that reader's window (for example, admissions reads Lead-change results for 14 days).
- **Business records.** These are the lifecycle effects. They are not retirement targets (contact events, projections, call interactions under the Owner's 730-day policy).

## Standard numbers

| Setting | Value |
| --- | --- |
| GCS retention | 90 days (Owner band 60–90). Bucket `Delete` rule on `daysSinceCustomTime`, one rule per namespace prefix, checked by `checkRecoveryPolicy` before release |
| Recovery clock | Started at creation for disposable copies (sealed names); after a release review for objects a locator still serves (Granot) |
| Catalog TTL | Equal to the GCS retention, so the catalog never points at a deleted object |
| Settle | Longer than any transaction that could still commit an older row (Atlas transaction lifetime 60 s; 5 minutes used) |
| Backstop | The record's existing TTL stays as a backstop and acts only if retirement stops; watch the cursor lag |
| Switch | Runtime control in MongoDB, never an env var; off restores the previous behavior |

## Adopting a collection: checklist

1. What is one row, who produces it, and how fast (rows/day, MB/day, measured)?
2. What is its lifecycle effect, in which collection and field, and which indexed query proves it?
3. Who reads it in MongoDB, and for how long? Who can re-produce its key, and what is the hard bound?
4. Pack shape: one pack per batch with a range catalog (high count, small rows), or a page with an id index (Granot evidence pages).
5. Verdicts: retire, hold (with reasons), keep (ordinary window). Every verdict is archived.
6. Operator modes: `status`, `dry-run` (read-only verdict counts), `install` (indexes and bucket rule), `enable`, `disable`, `run`, `lookup <id>`.
7. Proof before enabling: a read-only production dry run, a fake-bucket replica run (failure changes nothing, byte-identical restore, re-run is a no-op), and lean unit tests (one verdict table, one pack integrity test).
8. Scenario math: rows and MB per day and at steady state before and after, measurement window, assumptions, behavior preserved.

## Reference implementation: Sales Intelligence jobs (2026-11-22)

`src/services/salesIntelligence/retirement/`, cron `/api/cron/sales-intelligence-job-retirement` (every 2 minutes), operator `pnpm outreach:job-retirement`.

- **Switch.** `sales_intelligence_job_retirement` `{_id: "v1", enabled_at}`. While on, `completeCsiJob` keeps every completion's full row instead of compacting it on the spot (cached 60 s per process; a read failure keeps the old behavior).
- **Run.** In completion order after a 5-minute settle, batches of 500 by the `csi_job_completed_ttl` index (no blocking sort; rows sharing one completion instant never split across batches):
  - `evidence.ts` proves each job's effect: evaluation → `sales_outreach_projections.publication_revision`; rep-day → `sales_outreach_rep_day_projections`; call contact change → its contact event and `call_interactions.projection_revision`; Estimates Lead change → a later evaluated projection of the same Lead's subject; capture → every touched call at its revision.
  - `pack.ts` packs the raw BSON; the worker writes it under `history/sales-intelligence/v2/<db>/<day>/<sha256>.bson.gz` with its 90-day clock started, and checks the read-back.
  - `sales_intelligence_job_archive_packs` gets one catalog row (TTL 90 days).
  - Proven routine jobs become receipts that leave at the end of their replay window (3 days; captures 7). Held and ordinary rows are not written.
- **Lookup.** `pnpm outreach:job-retirement lookup --target=vantagemovers --id=<job>` restores a job byte for byte.
- **Proof.** `ops/sales-outreach/job-retirement.replica.ts` (local replica, fake bucket). Production dry run on 2026-11-22: 221,388 completed full rows; 103,677 proven and retirable (90.1 MB logical), 117,711 ordinary, 0 held.
- **Live since 2026-11-23 01:09 New York** ([release record](../operations/SI-VALIDATED-RETIREMENT-RELEASE-2026-11-23.md)). The first supervised run proved and archived 1,000 jobs (843 retired, 157 kept, 0 held; 8.3× compression), and a lookup restored a retired job from GCS. The first attempt found a Cloud Storage multipart-upload defect, fixed in #266: an archive that cannot be written changes nothing.

## Owner decisions (2026-11-23)

The [release record](../operations/SI-VALIDATED-RETIREMENT-RELEASE-2026-11-23.md#owner-decisions-for-next-session-2026-11-23-about-0055-new-york) lists them in full.
- **Approved to implement:**
  - 90 days for every namespace;
  - Granot end of life: clock at retirement, locators expire, the extension fence stays compact;
  - `ringcentral_webhook_events` 1 day hot;
  - drop `csi_job_due` on or after Nov 29.
- **Approved to propose with evidence:** `daily_operations_events`, Sheet Sync logs and jobs, Granot booking webhooks, `entity_changes` with `domain_command_executions`, and relaxing the Granot reference holds.
- **Compaction:** after the Sales Intelligence backlog drains, batched.

## Where every service stands (2026-11-22)

From the [audit](../operations/VALIDATED-RETIREMENT-AUDIT-2026-11-22.md). Verdicts: **Adopted**, **Partial**, **Should adopt**, **Not applicable**.

| Collection | Today | Verdict and gap |
| --- | --- | --- |
| `sales_intelligence_jobs` | This page's reference implementation | **Adopted** once enabled. Next: early receipts for proven ordinary stages; migrate the Nov 19 packs' bespoke client |
| `granot_webhook_receipts`, Observations, Decisions, scheduled runs | Retire-on-use with verified GCS archive and lookup (#257) | **Adopted, with gaps:** objects never start a GCS clock (kept forever), locators are permanent, booking routes never retire, 5,755 chains held by references |
| `ringcentral_webhook_events` | 7-day TTL, no proof, no archive; 13.6–19.5 MB/day | **Should adopt, first.** Proof: the receipt's capture job completed and its call interactions are at that revision |
| `sheet_sync_attempts`, `sheet_sync_runs` | 90-day TTL, no archive; 155 MB live | **Should adopt.** Proof: the parent job is synced |
| `daily_operations_events` | 400-day TTL; +660 MB projected | **Should adopt** after the Owner revisits the Nov 19 "keep in MongoDB" decision. Proof: the day is closed and frozen; keep a hot dedupe fence |
| `sheet_sync_jobs` | Permanent | **Should adopt.** Proof: synced, the entity's sheet metadata records the row, nothing newer pending |
| `entity_changes`, `domain_command_executions` | Permanent | **Should adopt, last.** Many readers; idempotency fence must stay hot |
| Sales Outreach business collections, `call_interactions` | Business records | **Not applicable**: they are the lifecycle effects |

Cross-cutting: both older GCS namespaces use 30 days, not 60–90. The live bucket rules are not mirrored in the repo (`ops/cloud/mongodb-backup/lifecycle.json` lists only the backup rules). The real-bucket contract proof of the Cloud Storage module has not run.
