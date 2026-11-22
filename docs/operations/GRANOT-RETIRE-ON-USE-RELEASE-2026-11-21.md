# Granot retire-on-use: release and backlog run (November 21, 2026)

**Owner direction.** Granot receipts, Observations and Synchronization Decisions leave MongoDB once used, and any of them can be read back from GCS by original ID. The Owner approved the plan and the six recommendations below ("go with your recommendations"). Keeping storage low is a serious priority.

**Code.** PR #257 (`0092641c`), deployed 19:14 New York. It contains:
- the Cloud Storage module;
- read-back by original ID (`readGranotReceipt`, `readGranotObservation`, `readGranotDecision`);
- the per-channel "used" rule. Only `lead_snapshot_apply` channel operations and inbound `lead_created`/`priority_updated` webhooks retire. Booking receipts stay in MongoDB;
- a fail-closed operation-index check, with a 2-minute settle after install;
- removal of shadow mode, the seven-day auto-promotion, the Pool shadow comparison and TTL stamping.

It went through four independent reviews with no blockers, and every should-fix was fixed before merge. Rules and runbook: [storage retention operations](../knowledge/granot-lifecycle/storage-retention-operations.md), [Cloud Storage](../knowledge/services/cloud-storage.md).

## Run (New York time; production; evidence in the main checkout's untracked `.tmp/granot-retire-on-use-2026-11-21/`)

| Step | Time | Result |
|---|---|---|
| `--install` | 20:27 | `granot_archived_receipt_operation_unique` built; `receipts-on-use-index.installed_at` = 01:27:07 UTC |
| `--enable` | 20:27 | `receipts-on-use-v1.enabled_from` = 2026-11-22T01:27:16.637Z |
| Backlog dry run | 20:27–20:31 | 6,057 HTTP receipts retirable (13.4 MB out, 5.0 MB of locators in); matches the PR's dry run |
| `--apply --limit 200`, then `--limit 800` | 20:32 | 0 retired. `--limit` counts receipts *examined* in `_id` order, and the first 6,960 are held |
| `--apply --limit 7164` | 20:33 | **197 retired**, 0 failures (the retirable cohort starts at position 6,961) |
| Read-back by ID | 20:34 | The first, middle and last retired receipts restored from GCS (`ops/granot-read-archived-evidence.ts`); none remained in MongoDB |
| `--apply --limit 13100` | 20:35–20:45 | **5,860 retired**, 0 failures |

**Totals.** 6,057 of 6,057 eligible receipts retired, with 0 failures.

| Collection | Before | After |
|---|---|---|
| `granot_webhook_receipts` | 13,070 docs, 30.0 MB logical | 7,013 docs, 15.9 MB |
| `granot_archived_receipts` (locators) | 23,066 docs, 6.2 MB | 29,123 docs, 11.0 MB |

The net logical reduction is about 9.4 MB. Production logged 0 errors from install through 20:46, and the storage cron answered 200 every two minutes.

**Still in MongoDB, and why.**
- **6,959 HTTP receipts:** `closed_run:unfinished_or_recent`. Their run's replay record publishes after the seven-day rule, around November 26, and the online pass re-checks them daily.
- **3 HTTP receipts:** `decision_missing`.
- **49 webhooks:** 25 booking routes (not retired, per decision 1), 21 with no Lead target, and 3 with a missing Decision.
- **5,755 Observations and their Decisions** behind the retired receipts: still referenced.
  - `form_leads.last_accepted_granot_observation`: 5,411.
  - `sales_outreach_subjects.priority`: 1,619.
  - `sales_outreach_pool_work`: 905.
  - `call_leads.last_accepted_granot_observation`: 498.
  - Record Links and entity changes: about 30 each.

## Owner decisions (2026-11-21, recommendations accepted)

1. Booking webhooks stay in MongoDB for now. They retire once their booking case closes (follow-up).
2. Relax the reference holds on Observations and Decisions after a review of the readers that query by field. This is where the remaining Granot savings are (follow-up).
3. Drop the inert TTL indexes and the old trial records. Done 20:47–20:48.
   - `granot_retention_purge_v1` was dropped on `granot_webhook_receipts`, `granot_observations` and `synchronization_decisions`. No document held `retention_purge_at`, and nothing writes it.
   - The `granot_retention_control` `v1` document and the `granot_retention_days` collection were removed.
   - Copies are in the evidence folder: `ttl-indexes-before.json` and `retired-trial-records.json`.
4. Keep the seven-day closed-run rule. Rerun the backlog after November 26.
5. Rollout order: install, enable, a limited apply, then the rest. Done.
6. Locators of about 780 B are accepted.

## Compaction: deferred (measured)

The primary had **54.3 MB** of reusable WiredTiger space across the four Granot collections. Most of it is receipt index pages: 34.3 MB in `granot_webhook_receipts` and 10.8 MB in `granot_observations`.

Compacting the primary needs a temporary privileged user and an Atlas failover (see the [November 20 procedure](INDEX-READ-BASELINE-2026-11-19.md)). WiredTiger already reuses this space for new writes, so the disk does not grow meanwhile. **Compact once, after the November 26 backlog run**, so one failover covers both cohorts.

## Next

1. **After November 26:**
   - Rerun the backlog dry run, then `--apply --limit 13100`.
   - Read back a sample by ID.
   - Then compact (secondaries, failover, then the former primary).
2. **Decision 2:** a reader review of the Observation and Decision references above, then relax the holds.
3. **Tool note:** `--limit` bounds receipts examined, not receipts retired. To stage a first batch, find the first eligible position (receipts whose run has a `granot_closed_automation_runs` row) and set the limit just past it.
