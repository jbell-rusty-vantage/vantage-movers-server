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

## After this

Next is the index phase for `daily_operations_events`: 150 MB of index on 177 MB of data, measured the same way. Then the Granot follow-ups in [the retire-on-use release record](GRANOT-RETIRE-ON-USE-RELEASE-2026-11-21.md#next): the Nov 26 rerun plus compaction, and relaxing the Observation and Decision holds.
