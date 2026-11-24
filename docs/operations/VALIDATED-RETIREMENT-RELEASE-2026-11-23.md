# Validated retirement: RingCentral receipts, 90-day GCS and Granot end of life (November 23, 2026)

**Owner direction.** The Owner's November 23 decisions 1, 2 and 5 ([decisions](SI-VALIDATED-RETIREMENT-RELEASE-2026-11-23.md#owner-decisions-for-next-session-2026-11-23-about-0055-new-york)) were approved to implement. The Owner asked this session to finish the remaining validated-retirement work on `main` and push it for deployment. Decisions 3, 7 and 8 are proposals and were not implemented. Decision 6 (drop `csi_job_due`) waits for Nov 29. The rule is [validated retirement](../knowledge/validated-retirement.md).

**Code.** Each PR had an independent review. Every blocker and should-fix was fixed before merge.
- **PR #269** (`ad2825ba`): validated retirement of RingCentral webhook receipts (decision 5).
- **PR #270** (`1c2f23f0`): 90-day recovery for `granot-history` and `sales-intelligence-packs` (decision 1), and the Granot end of life (decision 2).

The #269 review found:
- the cron crashed when no telephony receipt existed;
- the redelivery path was documented wrongly;
- the compacted-job proof depended implicitly on the job worker's `updatedAt`. Now the job worker stamps the compaction with its catalog row's `created_at`.

The #270 review found:
- an abandoned review left a previously clocked object with no hold, so GCS could have deleted it while rows still pointed at it. Every abandon path now restores the publisher hold, and a replica regression case covers it.
- the reference reads had no index;
- a later, shorter recovery window could strand rows already marked;
- rows pointing at an object already missing from GCS were never marked.

## Run (production; New York time)

| Step | Time | Result |
| --- | --- | --- |
| `main` checks before work | 03:15 | `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (322 pass, 0 fail, 93 s). SI job retirement healthy: 0 holds, bucket rule ok, about 150k rows of backlog |
| #267 (docs) merged | 03:30 | `a9d2979e` |
| #269 merged and deployed | 04:03–04:06 | Stamp `ad2825ba` |
| `ringcentral:receipt-retirement install` | 04:06 | 3 catalog indexes. Bucket metageneration 7 → 8: `Delete daysSinceCustomTime 90` on `history/ringcentral-webhook-receipts/v1/vantagemovers/`. The other five rules unchanged |
| `enable` and supervised `run --batches=4` | 04:06 | 2,000 receipts proven, archived in 4 packs (5.27 MB → 0.40 MB) and deleted; 0 held |
| `lookup 6afb13f8e2e30648911f7688` | 04:07 | Not in MongoDB; restored from its pinned pack generation with `rawBody` (2,855 bytes) |
| Crons on the new deploy | 04:07–04:15 | The receipt cron retired 2,000 more (0 held). The SI job cron, whose worker changed, compacted 761 (0 held) |
| Bucket rules 30 → 90 days (decision 1) | 04:16 | Metageneration 8 → 9. Only `history/granot/{released,v1}/vantagemovers/` and `history/sales-intelligence/v1/vantagemovers/` changed. Checked against an exact six-rule preview first. Nothing on `main` opened those namespaces for release, so the order was safe. The Nov 19 packs' first expiry moves from Dec 19 to Feb 17 |
| #270 merged and deployed | 04:20–04:25 | Stamp `1c2f23f0`. No Granot run was in flight |
| `granot-history-end-of-life status` / `dry-run` | 04:25 | Bucket rule ok at 90 days. Eligible objects: 109 receipts (6,285 kept, `observation_hot`), 243 evidence pages (37 kept, `hot_receipt`), 17,049 history chunks. 62,656 rows (19.4 MB BSON) to expire |
| `install`, `enable --kinds receipt,evidence,history` | 04:26 | Control `end-of-life-v1` with `recovery_days: 90` |
| Supervised `run --passes 3` | 04:27 | 192 reviews started, 0 failures. Each object drains 800 s before its rows are marked and its clock starts; the cron continues every 2 minutes |
| First releases (cron) | 04:42 | 12 objects released, 79 rows marked, 0 failures; 278 reviews draining. Spot check: chunk `1ea67f91…` has its clock at 09:42:34 UTC with no holds (GCS may delete it from Feb 21, 2027); its catalog row expires Feb 20, 2027 |

## Evening follow-up (Nov 23, 18:37–18:46 New York)

### Drains confirmed (18:37)

| Pass | Result |
| --- | --- |
| RingCentral receipts (`pnpm ringcentral:receipt-retirement status`) | 35,993 receipts in 116 packs (7.3 MB packed), 0 held. `reviewable_pending` 2. The cursor is 12 min behind its 1-day hot window (`lag_seconds` 87,118 counts from now, by design). 8,776 receipts hot. Bucket rule ok |
| Granot end of life (`granot-history-end-of-life.ts status`) | 0 failures. Rows marked: 22,780 `granot_archived_receipts` + 27,373 `granot_history_archive_chunks` = 50,153 of 62,656. 323 reviewing, 117 queued. Still releasing every 2 minutes |
| SI job retirement (`pnpm outreach:job-retirement status`) | Lag 439 s, 0 holds, 4 settled rows pending. Catalog 757 packs, 242,072 rows (121,510 retired, 120,562 kept) |

### Real-bucket contract proof: blocked, nothing written

Approved by the Owner for this session.
- **What happened.** Creating the disposable bucket `vantage-contract-disposable-20261123-23809` in `just-cosmos-437222-b7` through `googleapis` with the test service account returned **403 "The billing account for the owning project is disabled in state absent"**.
- **What was touched.** No bucket was created, no object was written and the suite did not run. `vantage-sheets-496816` was not touched.
- **To unblock.** Link an active billing account to `just-cosmos-437222-b7`, or name another test project. The steps are in [Cloud Storage](../knowledge/services/cloud-storage.md#running-the-real-bucket-proof-owner-or-operator).

### Compaction (Owner decision 4, Nov 23 evening)

The Nov 20 method:
- a temporary 24 h Atlas operator from the `MONGO.env` service account; the app user was not modified;
- secondaries first, one member at a time;
- an Atlas failover (restartPrimaries at 18:40, REPAIRING → IDLE by 18:43:52), then the former primary;
- the temporary user and role deleted at about 18:45.

**What was compacted.** Fifteen namespaces, chosen from the measured WiredTiger "file bytes available for reuse": the oplog, plus every collection with at least 2.6 MB reusable.

**`freeSpaceTargetMB` trap.** The first pass on member 00 freed space only in `sales_intelligence_jobs` (28.5 MB). MongoDB's default `freeSpaceTargetMB` is 20, and WiredTiger skips any single file with less than that recoverable. The free space here is spread across many index files. The untracked `scripts/storage-compact.ts` now takes `--free-space-target-mb=N`. Every member was then compacted with `--free-space-target-mb=1`, each namespace in 0–3 s.

| Member | Before (used / % of 17,308 MB) | Reusable before | After | Reusable after | Returned |
| --- | --- | --- | --- | --- | --- |
| `…-00-00` (secondary) | 4,201.7 MB / 24.3% | 352.2 MB | 3,952.9 MB / 22.8% | 98.6 MB | 248.8 MB |
| `…-00-01` (secondary, now primary) | 4,217.1 MB / 24.4% | 365.8 MB | 3,957.9 MB / 22.9% | 106.2 MB | 259.2 MB |
| `…-00-02` (former primary) | 4,270.1 MB / 24.7% | 359.8 MB | 4,001.8 MB / 23.1% | 90.4 MB | 268.3 MB |

- **Total returned:** about 776 MB.
- **Largest gains per member:** `daily_operations_events` (73–78 MB), `sales_intelligence_jobs` (69–79 MB), `granot_webhook_receipts` (22–35 MB) and `sales_intelligence_audit_events` (28–32 MB).
- **Oplog, unchanged:** 212–235 MB on disk (977.8 MB logical of the 990 MB maximum), with a 96.8 h window, oldest entry Nov 19 22:49 UTC. Compact freed 0 there because only 6–21 MB was reusable.
- **Evidence:** the untracked `scripts/output/storage-reclaim-report-2026-11-23-{before,after}.json` and `storage-compact-2026-11-23T*.json` in the main checkout.
- **Next compaction:** the Nov 26 Granot backlog run frees about 17 MB more, which WiredTiger reuses anyway. Compact again only if a later retirement frees at least about 200 MB per member.

## What stays in MongoDB, and why

- **RingCentral receipts:**
  - one day of proven telephony receipts;
  - every held receipt (pending job, effect missing, redelivery);
  - the newest telephony receipt, which the Desk header reads;
  - non-telephony receipts.
  The 7-day TTL stays as the backstop. The capture job keeps its 7-day key fence.
- **Granot:**
  - receipts whose Observation is still hot. These are almost all retired receipts (6,285), and they stay until the decision 2 reader review relaxes the holds;
  - evidence pages still named by a hot receipt;
  - closed scheduled runs and their replays: they fence duplicate run creation and answer same-key replays, and there is no Owner bound for them;
  - the extension duplicate fence: a locator is never set to expire before `captured_at` + 7 days, the extension's retry bound, and in practice lives 89 days.
- **Out of reach:** 247,661 older per-chain Granot objects (1.75 GB) that no MongoDB row names. Only operator manifests reference them. Their end of life is a separate Owner decision.

## Expected result

| | Before | After backlog |
| --- | --- | --- |
| `ringcentral_webhook_events` | 38,227 receipts, about 101 MB logical (a weekday week: 95–137 MB) | about 1 day of receipts: 14–20 MB on a weekday |
| GCS, RingCentral packs | 0 | about 1.5–2 MB/day, about 150–180 MB at 90 days |
| Granot rows with `expires_at` | 0 | 62,656 rows (19.4 MB BSON), TTL-deleted about 89 days after release |
| Granot GCS deletable | 0 | 128.5 MB, 90 days after each clock starts |

- **Physical space** returns to Atlas only through compaction. This is Owner decision 4: compact once the SI and RingCentral backlogs have drained, batched, one member at a time, secondaries first.
- **TTL burst** about 89 days out: roughly 62k Granot rows will be TTL-deleted together, so expect an oplog bump that day.

## Operate

- RingCentral: `pnpm ringcentral:receipt-retirement status|dry-run|run|lookup --target=vantagemovers`. Rollback: `disable` (archived packs stay 90 days).
- Granot: `node --env-file=.env --import tsx ops/granot-history-end-of-life.ts status|dry-run|run|disable`. Rollback: `disable`. Marked rows keep their `expires_at`, and objects already on their clock keep it (a re-put re-holds one). **Never shorten the bucket rule or `recovery_days`.** The pass refuses a window shorter than the one recorded at enable.
- SI jobs: `pnpm outreach:job-retirement status --target=vantagemovers`.

## Open

- **Real-bucket contract proof:** approved, but blocked because the test project has no billing account (above). Only the multipart smoke has run.
- **Proposals delivered for Owner review** (decisions 3, 7, 8), measured and with scenario math: [proposals](VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md). None is implemented.
- **Nov 26 (not before):** the Granot backlog rerun.
- **Nov 29 or later:** drop `csi_job_due` if it stayed clean (decision 6).
- **Compaction (decision 4):** done Nov 23 evening (above).
- **Review nits not done:**
  - a retried RingCentral pack's catalog expiry is computed from the retry's `now`, not from the object's original `customTime`;
  - the job-pack scan cost grows with the catalog;
  - `dry-run` loads full documents.
