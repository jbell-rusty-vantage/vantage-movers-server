# Sales Intelligence validated retirement: release (November 22–23, 2026)

**Owner direction (2026-11-22).** Records that grow with operation volume leave MongoDB only after the system proves they were used for their purpose and their lifecycle effect exists. A verified GCS copy is kept for 90 days and can be restored by original ID. The Owner approved the build, the backlog run through it, and 60–90 days in GCS (90 chosen). The standing rule is in [validated retirement](../knowledge/validated-retirement.md).

**Code.**
- PR #264 (`fc6c3745`): three-day receipts for sweep evaluations, seven-day for clean captures, coalescing of coverage repairs, and the Pool wake fix.
- PR #265 (`56bcbf90`): validated retirement.
- PR #266 (`5d139993`): Cloud Storage streams the media part of multipart uploads.

Each PR had an independent review with no blockers, and every should-fix was fixed before merge.

## Run (New York time; production)

| Step | Time | Result |
| --- | --- | --- |
| #264 merged and deployed | Nov 22, 22:01–22:06 | Production stamp `fc6c3745` |
| `csi_job_due` hidden | 22:07 | Every remaining query plans on another index (0–1 keys). Rollback: unhide. Drop on or after Nov 29 if clean (Owner) |
| #265 merged and deployed | Nov 23, 00:07–00:13 | Stamp `56bcbf90` |
| `install` | 00:14 | Catalog indexes `si_archive_pack_name_unique`, `si_archive_pack_completed`, `si_archive_pack_expiry`. Bucket metageneration 6 → 7: rule `Delete daysSinceCustomTime 90` on `history/sales-intelligence/v2/vantagemovers/`. The four existing rules are unchanged; mirrored in `ops/cloud/mongodb-backup/lifecycle.json` |
| `enable` and first run | 00:14 | **Failed before any write:** `part.body.pipe is not a function`. A put carrying `customTime`/metadata is a multipart upload, and the driver sent a Buffer. Granot's media-only puts were unaffected |
| `disable` | 00:15 | No job completed while the switch was on; 0 catalog rows; nothing compacted |
| #266 merged and deployed | 01:01–01:07 | Regression test, plus a real-bucket smoke: created, read back verified, 90-day clock started |
| `enable` and supervised run | 01:09 | 1,000 rows proven and archived in 2 packs (803,101 → 96,613 bytes). 843 compacted to receipts, 157 kept (ordinary window), 0 held |
| `lookup 6af7b3759ee1b40b54e5b0e2` | 01:09 | In MongoDB a receipt; restored from GCS with its full result (820 bytes) |
| Backlog | from 01:09 | The cron drains it, at most 2,000 rows per two-minute run, about 4 hours. Check with `pnpm outreach:job-retirement status --target=vantagemovers` |

**Dry run before enabling** (read-only, 2026-11-23 04:15 UTC): of 221,388 completed full rows, 103,677 retire (64,335 evaluations and 39,342 captures, 90.1 MB logical), 117,711 keep (88.9 MB), and 0 hold.

## Expected result

| | Before | After the backlog and steady state (Nov 20 weekday mix) |
| --- | --- | --- |
| `sales_intelligence_jobs` rows / logical | 237,706 / 178.9 MiB | about 143,500 / 80 MiB |
| Live data + index on disk, per member | 60 MB + 54 MB (files 184 MB) | about 27 MB + 33 MB (files stay about 184 MB until a compact) |
| GCS | 0 | about 2.7 MB/day, about 250 MB at 90 days |

- **Physical space.** It returns to Atlas only by compaction. Owner decision: compact after the backlog drains, batched with other freed collections, one member at a time, secondaries first.
- **Recovery.** Run `pnpm outreach:job-retirement lookup --target=vantagemovers --id=<job>`. It restores the job byte for byte from the verified pack.
- **Rollback.** Run `disable`. Completions then compact on the spot again, per the #264 rule. Archived packs stay in GCS until their 90 days end.

## Owner decisions for next session (2026-11-23, about 00:55 New York)

1. Granot history and the Nov 19 Sales Intelligence packs move from 30 to **90 days**: a bucket rule change, a `cloud_storage_control.recovery_days` change, and an update to the strict assert in `retire-historical-jobs.cjs`.
2. **Granot end of life.** Each retired object's 90-day clock starts once it is retired. MongoDB locators expire with it, except the extension-operation duplicate fence, which stays as a compact key for its replay window.
3. **`daily_operations_events`.** Reverse the Nov 19 decision to keep it in MongoDB. Design and measure validated retirement (a closed, frozen day as the proof, a hot dedupe fence, and the reader windows), and bring the scenario math before any change.
4. **Compaction** after the backlog, batched, as above.
5. **`ringcentral_webhook_events`.** A proven receipt (its capture job completed, its calls at that revision) stays 1 day hot, then moves to GCS. The capture job keeps its 7-day key fence.
6. **`csi_job_due`.** Drop on or after Nov 29 if it stays clean; the same PR removes its declaration.
7. **Proposals** (each needs Owner approval): Sheet Sync logs, `sheet_sync_jobs`, Granot booking webhooks, then `entity_changes` and `domain_command_executions` (after a full reader inventory).
8. **Granot decision 2.** Review every reader by field, then relax the reference holds on the 5,755 Observation/Decision chains; readers fall back to GCS by ID. Bring the reader list and the savings first.
