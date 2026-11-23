# Brief: Sales Intelligence job volume and retention (next session)

**Owner goal (2026-11-21).** Keep MongoDB storage low; this is a serious priority. `sales_intelligence_jobs` is the largest collection by daily inflow. Reduce what it produces and how long completed jobs stay, without losing late replay, active or failed work, or any reader's obligation. Follow the Owner's capacity directive: state the measurement window, units, assumptions, and the business behavior each proposal preserves or changes.

## Measured on 2026-11-21 (read-only, primary/secondary reads, New York days)

**Stock.** 238,912 jobs; 176 MB on disk, of which 99 MB is index and 77 MB storage. The Nov 14–16 spike was a one-off backfill, which also inflated `daily_operations_events`, `entity_changes` and `sheet_sync_attempts`; it ages out by about Nov 30.

**Steady inflow (last 48 hours).** About **21,900 jobs/day and 15.5 MB/day of BSON**.

| Stage | Expiry | Jobs/day | MB/day |
|---|---|---:|---:|
| `outreach_evaluate` | **14 d** | **6,734** | **5.24** |
| `outreach_contact_change` | 3 d | 5,960 | 2.95 |
| `capture_projection` | **14 d** | **5,322** | **4.88** |
| `outreach_evaluate` | 3 d | 872 | 0.45 |
| `lead_link` | 14 d | 713 | 0.44 |
| `outreach_rep_day` | 3 d | 675 | 0.35 |
| `call_log_refresh` | 14 d | 613 | 0.46 |
| `outreach_contact_change` | 14 d | 379 | 0.24 |
| `rep_sms_sync` | 14 d | 357 | 0.31 |
| `outreach_lead_change` | 14 d / 3 d | 250 / 3 | 0.18 |

**Steady state at today's rules** (assumption: the current mix holds):
- 14-day jobs: about 14,400/day × 14 ≈ **200k jobs, about 165 MB logical**.
- 3-day jobs: about 7,500/day × 3 ≈ 22k jobs.
- **`outreach_evaluate` + `capture_projection` at 14 days are about 12,000/day, roughly 140 MB of that steady state.**
- `outreach_evaluate` touched about 2,000 distinct subjects in 48 hours, about **3–4 evaluations per subject per day**, and **89% of them miss the 3-day routine expiry**.

How expiry is chosen today: `csi_job_completed_ttl` keeps completed jobs 14 days; `csi_job_routine_ttl` uses `routine_purge_at`, set in `src/services/salesIntelligence/jobs.ts` (~:303) when `routineJobExpiry.ts` recognizes the result.

## Questions to answer, with evidence

1. **Why ~3–4 evaluations per subject per day?**
   - Map every producer: contact apply (`salesOutreach/contacts/apply.ts:96`), the evaluate sweep and cron (`salesOutreach/evaluation/evaluateJob.ts`, `/api/cron/sales-outreach-evaluate`, every minute), cadence deadlines, commands, Lead changes.
   - Measure, per producer: jobs/day; the share whose result changed nothing (same plan, no publication); and the coalescing already in place.
   - Find avoidable no-op evaluations: skip them before enqueue, or coalesce by subject and due instant, while keeping deadline accuracy.
2. **Why do 89% of evaluations, and all `capture_projection` jobs, keep 14 days?**
   - Read `routineJobExpiry.ts` and the per-stage replay obligations in [the Nov 19 Sales Intelligence jobs release](SALES-INTELLIGENCE-JOBS-RELEASE-2026-11-19.md), "What each reader still needs".
   - For each result shape held at 14 days: name the reader or replay window that actually needs it longer than 3 days, or show that none does.
   - Prove it from code and a read-only production sample of the readers' queries.
3. **Index weight.**
   - 99 MB of indexes on 77 MB of storage. List each index on the collection, its query owner, and its reads from the index-phase baseline ([INDEX-READ-BASELINE](INDEX-READ-BASELINE-2026-11-19.md)).
   - Propose hide-then-drop only for indexes with no owner.

## Deliverables

- **One PR**, with:
  1. producer-side reductions (skipped or coalesced no-op evaluations);
  2. routine-expiry classification extended to every result shape whose replay obligation is 3 days or less;
  3. docs updated in the same PR: `docs/knowledge/services/sales-intelligence-outreach.md`, `sales-outreach-desk.md`, `number-activity-capture.md` as touched, plus the Nov 19 release record's obligations table if a window changes.
- **Scenario math in the PR body.** For each change: jobs/day and MB/day before and after, the new steady state, the measurement window, the assumptions, and the business behavior preserved (Desk plans, deadlines, rep-day counts, replay and dedupe, late corrections).
- **Backlog.** Existing completed jobs keep their old expiry. If the PR shortens a window, add an `ops/` command (dry-run default, `--apply --limit N`, batched, resumable) that sets `routine_purge_at` on already-completed jobs that now qualify. Report its dry-run counts. Apply only after merge, with Owner approval.
- **Index proposals**, only with owners and plans stated. Hiding or dropping an index is a separate, Owner-approved action.

## Rules

- **Standing Owner directives** ([owner directives](owner-directives.md)) apply:
  - **lean, purposeful tests:** table-driven, extend existing files, and state the test delta with a reason per new test;
  - RingCentral-only Call admission;
  - Form/Call sibling rules;
  - official Bookings and Cancellations reportable;
  - no Calls-tab changes.
- **Preserve:**
  - active, leased, retrying, failed and dead-lettered jobs;
  - dedupe keys for their replay windows;
  - claim fences;
  - late corrections;
  - the Nov 19 obligations, unless the PR proves an obligation is shorter.
- **Production access:**
  - read-only: find, aggregate, collStats; no `$out` or `$merge`;
  - copy `.env` into your worktree only for reads, and delete it afterwards;
  - since #261, tests refuse a non-loopback `MONGO_URI`.
- **Release:**
  - one worktree per agent, with a real `pnpm install`;
  - every merge to `main` deploys production;
  - open a PR, get an independent review, and merge only with Owner approval, just after a top-of-hour slot (Estimates at 06, 09, 13, 17, 21; ALL and Pool hourly);
  - confirm the time with PowerShell `Get-Date`;
  - wait for the *final* deploy before any runtime flip.

## Answers (2026-11-22)

**Measurement.** Read-only production reads (`find`, `aggregate`, `collStats`, `$indexStats`, `explain`), mostly on a secondary, from 01:32 to 01:55 UTC on November 23 (20:32–20:55 New York on November 22). Units are jobs and MiB of stored BSON (`$bsonSize`). Days are New York days. Per-day counts cover November 16–22. The scenario day is Friday, November 20: the first full staffed weekday after the November 19 producer release. Overlap was measured over the 72 hours ending 01:32 UTC on November 23.

### 1. Why about three to four evaluations per subject per day

| Producer | Key | Jobs/day, Nov 16–22 | Result |
| --- | --- | ---: | --- |
| Clock sweep | `due:<ms>` | 4,697–4,937 (about 2,000 subjects) | 99.3% `updated` |
| Coverage repair | `coverage:<channel>:<wait>:<bucket>` | 1,704–2,226 (about 1,500–1,770 subjects) | 93% `updated`, 7% `unchanged` |
| Contact apply | `r<n>:contacts:<digest>` | 118 (Sunday) to 1,160 (Friday) | already three-day receipts |
| Subject revision, Estimates | `r<n>`, `estimates-refresh:` | 0–57; the refresh coalescer has carried these since November 19 | already three-day |
| Policy reconcile | `policy:<fp16>` | 2–10 | keeps 14 days |

- The clock and coverage wakes run every day, weekends included, because they follow the cadence calendar, not staffing. Over seven days the due instants were 00:00 New York 13,730 (the new business day), 20:00 12,705 (the day's deadline), 08:00 6,390 (obligations open) and 12:00 664. Coverage repair runs at about 20:20, when capture coverage proves the 20:00 deadline. That is about 2.4 clock wakes and 0.9 coverage wakes per subject-day.
- Each wake is a real state change. The engine's `nextEvaluation` candidates are day start, obligation open, due and close, terminations and windows. Almost every clock evaluation rewrites the projection.
- **Avoidable: 402 of 6,037 coverage jobs in 72 hours** (about 134 a day; 1,461 duplicate pairs, about 209 a day, over seven days). At 20:00 the drain lags the minute sweep. When the coverage watermark crosses into the next 5-minute bucket before the first job runs, the sweep nominates a second job for the same deadline. Every one of the 402 overlapped an unclaimed earlier job, and every one completed `unchanged`. The fix leaves the row to that pending job.
- **Defect found: 87 active Pool projections stuck** with a passed `next_evaluation_at` (7 at November 20 01:00:00.001 UTC, 60 at November 21, 20 at November 22). The oldest still shows business date 2026-11-19. The Pool fingerprint left out `next_evaluation_at`. A completed duty evaluated at close + 1 ms was `unchanged`, the passed wake stayed stored, and the completed `due:` job fenced the sweep. All 87 `due:` jobs were `completed/unchanged`. The fix adds the wake to the fingerprint.

### 2. Why sweep evaluations and every capture kept 14 days

`routineJobExpiry.ts` accepted only the `r<n>`, Estimates and `contacts` evaluation causes, and it had no `capture_projection` branch. The Nov 19 record kept the sweep keys because they "fence repeat nominations". Each obligation, checked against the code:

| Result | Readers of the completed row | Replay obligation | Window now |
| --- | --- | --- | --- |
| `due:<ms>` evaluation, `updated`/`unchanged` | Only the sweep's `existingJobKeys` (by key). No reader of `result`: the Desk reads projections. | Re-nomination needs the stored `next_evaluation_at` to still equal `<ms>`. After a completed evaluation it is later than the evaluation's own clock: the engine keeps only candidates after `asOf`, a quiet row's cooldown expiry is after `asOf`, and Pool takes the next date or close + 1 ms while that is still ahead. Pool needed the fingerprint fix for an unchanged row to store its wake. The obligation ends at commit. | 3 days |
| `coverage:<channel>:<wait>:<bucket>` evaluation, `updated`/`unchanged` | Same | The key carries the 5-minute coverage bucket. If coverage stalled in one bucket for three days, expiry would cost one idempotent evaluation. | 3 days |
| `policy:` evaluation | Same | A `subject_missing` or racing result can leave the fingerprint unmatched. 2–10 a day, so the change is not worth it. | 14 days |
| `capture_projection`, every session projected | `findMatchingCsiJob` (dedupe key, dataset, hash, status) | Re-ensure sources: a webhook redelivery (the same `uuid` maps to the same receipt) and the watermark recovery. Recovery resumes from its stored watermark minus a 5-minute overlap, and that watermark can lag by days when capture is disabled or recovery stalls. The only hard bound is the 7-day receipt TTL. A replay is normally a no-op, but exactly-once is kept by holding the key as long as the receipt. | 7 days (the receipt TTL), compact receipt without `result` |
| `capture_projection` with a failed session | Operators read the code on the row | Diagnostic | 14 days |

**Production proof.** The backlog dry run applied the shared rule (`routinePurgeAt`) to every completed `outreach_evaluate` and `capture_projection` row without a purge instant. Of 103,915 rows, 103,667 qualify: 44,017 `due` and 20,318 `coverage` evaluations, and 39,332 captures. Every capture in stock had zero failed sessions. Held: 248 rows (178 `created` revision evaluations, 45 policy and 25 `created` contact evaluations).

### 3. Index weight

`$indexStats` on the primary since November 18 at 20:51 UTC. TTL deletions are not counted.

| Index | MB | Reads | Owner |
| --- | ---: | ---: | --- |
| `_id_` | 11.8 | 170,826 | Fenced writes, queue dispatch |
| `csi_job_dedupe_unique` | 19.1 | 146,889 | Enqueue, read-before-upsert, sweep existing keys, creation-job check, Call Log refresh |
| `csi_job_due` | 22.0 | 66,025 | **None declared.** The planner picks it for the undirected claim (`stage: {$in: retained}`); `csi_job_claim` serves the same query. |
| `csi_job_lease` | 14.3 | 71,349 | Exhausted-lease sweep |
| `csi_job_claim` | 12.6 | 4,176 | Stage claim, retired-stage fence, admissions, the new coverage coalescing read |
| `csi_job_completed_ttl` | 20.6 | 4 | 14-day TTL, admissions day range |
| `csi_job_routine_ttl` | 3.1 | 0 | Three-day TTL |

Proposals. Each needs separate Owner approval and is not part of this PR.
1. Hide `csi_job_due`. Confirm with `explain` that the undirected claim plans on `csi_job_claim`, and watch claim latency for a week. Then drop it: 22.0 MB.
2. Later, replace `csi_job_due`, `csi_job_lease` and `csi_job_claim` with partial indexes on the actionable statuses (pending, retry, leased). Today they index every completed row; there is one pending row in 237,706.

Index size follows row count, so the retention change alone should roughly halve the index total once WiredTiger reuses the freed pages.

### Scenario math

Friday, November 20 mix. Sizes are measured averages: full rows 811 B (`due`), 829 B (`coverage`) and 962 B (capture). The receipt shape measured on the same rows is 529, 547 and 519 B.

| Class | Before: jobs/day, MiB/day, window | After: jobs/day, MiB/day, window | Steady before → after |
| --- | --- | --- | --- |
| `due` evaluations | 4,937, 3.82, 14 d | 4,937, 2.49, 3 d | 69,118 rows / 53.5 MiB → 14,811 / 7.5 MiB |
| `coverage` evaluations | 1,704, 1.35, 14 d | ≈1,570, 0.82, 3 d | 23,856 / 18.9 MiB → 4,710 / 2.5 MiB |
| Clean captures | 7,328, 6.72, 14 d | 7,328, 3.63, 7 d | 102,592 / 94.1 MiB → 51,296 / 25.4 MiB |
| **These three** | 13,969, 11.89 | 13,835, 6.94 | **195,566 / 166.4 MiB → 70,817 / 35.3 MiB** |

- **Whole collection at the weekday mix.** About 27,400 jobs/day and 19.3 MiB/day before; about 27,270 jobs/day and 14.3 MiB/day after. Steady state goes from about 268,000 rows / 212 MiB logical to about 143,500 rows / 80 MiB. Unchanged parts: other 14-day stages about 2,950/day (41,300 rows, 29.5 MiB) and existing three-day stages about 10,500/day (31,400 rows, 15.7 MiB). Today's stock is 237,706 rows / 178.9 MiB because weekend capture is lower.
- **Backlog, once and Owner-approved after merge.** `pnpm outreach:routine-expiry-backlog --target=vantagemovers` dry run at 02:10 UTC on November 23, scoped to the `csi-production` dataset: 103,667 rows, 85.95 MiB logical; 47,187 already past their window (completion + 3 days, or + 7 for captures). Those leave on the TTL monitor's first passes; the rest leave by November 30 at 01:41 UTC. Apply in chunks of about 10,000 and watch replication lag and the oplog.
- **Commands.** Each job still costs one insert, one lease write and one completion write; the receipt is the same completion update. Coalescing removes about 134 jobs a day and their evaluation transactions. It adds one indexed read per coverage page with fresh nominations, about 20 to 40 a day. TTL deletions come earlier, not more often. The backlog is 103,667 single-row updates in batches of 500, then the same number of TTL deletions.
- **Assumptions.** The November 20 mix holds. Clock and coverage volume follows the cadence calendar and the active subject count (about 2,000), so it does not drop on weekends. Capture follows call volume: Saturday was 45% and Sunday 14% of the Friday figure. Coalescing removes 134 to 209 jobs a day, and the table uses 134. Freed space returns to WiredTiger for reuse; the files are not compacted.

### Behavior preserved

- **Desk plans and deadlines.** The same wakes fire at the same instants. A coalesced coverage row is evaluated by its earlier pending job, which reads coverage no earlier than the sweep did. Leased and retrying jobs never coalesce.
- **Rep-day counts and contact events.** Untouched.
- **Replay and dedupe.** Every key keeps its identity until its sweep or watermark can no longer produce it. A late delivery after expiry re-runs an idempotent evaluation or capture.
- **Late corrections.** Untouched: corrections come through contact changes and Call Log reconciliation.
- **Active, leased, retrying, failed and dead-lettered jobs.** Untouched, and they still never expire. A capture with a failed session and a routine result after a retry keep their full rows.
- **Owner directives.** RingCentral-only Call admission, Form/Call siblings, official Booking and Cancellation reporting and the Calls tab are untouched.
- **Changed on purpose.** Pool rows store their next wake. After the deploy, every active Pool row is rewritten once at its next evaluation, with a live publish, because its stored fingerprint no longer matches. After that a Pool row writes at most once a day, when its close passes. The 87 frozen rows wake only when their pre-fix `due:` fences leave, which takes the backlog apply (or 14 days without it).

### Options not taken (they would change the Desk)

- Folding the midnight wake (about 1,960 a day) into the 08:00 opening would leave yesterday's state on the Desk overnight.
- Skipping the 20:00 clock evaluation (about 1,815 a day) and waiting for coverage would show "due" instead of "evidence pending" for about 20 minutes after the deadline.
- At three-day receipts, each option saves only about 1 MiB a day and 3 MiB at steady state. Neither is recommended.

### Left at 14 days

These stages keep the obligations in the Nov 19 record: `lead_link` (977/day), `call_log_refresh` (884), `rep_sms_sync` (476), `outreach_lead_change` (325) and non-routine contact changes (about 300). Together they are about 41,000 rows and 30 MiB at steady state. `rep_sms_sync` (10-second buckets) and `call_log_refresh` (45-minute expiry) look like the next candidates, but their provider outcomes need a stated diagnostic owner first.

## After this

Next is the index phase for `daily_operations_events`: 150 MB of index on 177 MB of data, measured the same way. Then the Granot follow-ups in [the retire-on-use release record](GRANOT-RETIRE-ON-USE-RELEASE-2026-11-21.md#next): the Nov 26 rerun plus compaction, and relaxing the Observation and Decision holds.
