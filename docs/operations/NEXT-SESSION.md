# Resume the server optimization sprint from main

## Start here — next session (November 23 close)

**Owner decisions 1, 2 and 5 are live in production.** `main` `1c2f23f0`; [release record](VALIDATED-RETIREMENT-RELEASE-2026-11-23.md).
- **Decision 5 (RingCentral receipts):** proven receipts stay 1 day hot, then move to GCS (#269). The cron drains the about 35k-receipt backlog by about 07:00 New York.
- **Decision 1:** Granot history and the Nov 19 packs keep 90 days in GCS (bucket metageneration 9).
- **Decision 2 (Granot end of life):** enabled for receipts, evidence pages and history chunks (#270). 62,656 rows expire 89 days after release. The closed runs and receipts with a hot Observation stay.

Next, in order:
1. **Confirm the drains.**
   - `pnpm ringcentral:receipt-retirement status --target=vantagemovers`: `reviewable_pending` near 0 and 0 unexpected holds.
   - `node --env-file=.env --import tsx ops/granot-history-end-of-life.ts status`: `expiring_rows` growing, 0 failures.
   - `pnpm outreach:job-retirement status --target=vantagemovers`: lag near zero.
2. **Compact (decision 4)** once those backlogs are drained: batched, one member at a time, secondaries first.
3. **Nov 26:** the Granot backlog rerun. **Nov 29:** drop `csi_job_due` if clean (decision 6; the same PR removes its declaration).
4. **Proposals for the Owner (decisions 3, 7, 8), each with scenario math:**
   - `daily_operations_events`;
   - Sheet Sync attempts, runs and jobs;
   - Granot booking webhooks;
   - the decision 2 reader review, which releases most Granot receipts;
   - `entity_changes` and `domain_command_executions` (after a full reader inventory).
   - Also the 247,661 unreferenced older Granot objects (1.75 GB) that no pass reaches.
5. **Real-bucket contract proof** of the Cloud Storage module. It needs the Owner's approval for a disposable bucket.

## Start here — next session (Owner, November 22)

**November 23 close (01:10 New York): Sales Intelligence validated retirement is ON and draining the backlog.** [Release record and Owner decisions](SI-VALIDATED-RETIREMENT-RELEASE-2026-11-23.md). The Owner's eight decisions there set this session's scope.

**Next session: review and optimize every service against [validated retirement](../knowledge/validated-retirement.md).** Owner directive, November 22: records that grow with operation volume (receipts, observations, job rows, events, attempts) leave MongoDB only after the system proves they were used for their purpose and their lifecycle effect exists, with a verified GCS copy kept 60–90 days and restorable by original ID. Start from the [audit](VALIDATED-RETIREMENT-AUDIT-2026-11-22.md) and its order:
1. Confirm Sales Intelligence job retirement in production (`pnpm outreach:job-retirement status`): lag near zero, 0 unexpected holds, the cursor through the backlog. Then drop `csi_job_due` on or after Nov 29, and compact (batched).
2. Move Granot and the Nov 19 packs to 90 days, and give Granot objects and locators an end of life (Owner decisions 1–2).
3. `ringcentral_webhook_events`: proven receipts 1 day hot, then GCS (Owner decision 5).
4. Run the real-bucket contract proof of the Cloud Storage module. Only the multipart smoke has run (Nov 23).
5. Proposals for the Owner: Granot follow-ups (Nov 26 rerun, decision 2, booking webhooks), Sheet attempts and runs, `daily_operations_events` (decision 3), `sheet_sync_jobs`, then `entity_changes` and `domain_command_executions`.

## Start here — next session (Owner, November 20)

**Next session: start with [the Sales Intelligence job volume brief](SI-JOBS-VOLUME-BRIEF-2026-11-22.md).** It is the largest daily inflow, about 21,900 jobs and 15.5 MB per day, mostly 14-day `outreach_evaluate` and `capture_projection` jobs.

**November 22 (evening, New York): the brief's PR #264 is open on `feat/si-jobs-volume`, not merged.** [Answers and scenario math](SI-JOBS-VOLUME-BRIEF-2026-11-22.md#answers-2026-11-22). It moves sweep evaluations (`due`, `coverage`) to three-day receipts and clean captures to seven-day receipts (the webhook receipt TTL), coalesces duplicate coverage repairs and fixes the Pool wake. Steady state for those classes falls from about 195,600 rows / 166 MiB to 70,800 / 35 MiB. Owner-gated after the merge and the final deploy: the backlog apply in chunks (`pnpm outreach:routine-expiry-backlog --target=vantagemovers --apply --limit=10000`, repeated; dry run 103,667 rows / 85.95 MiB). The apply is also what wakes the 87 frozen Pool rows, because their `due:` fences predate the fix. Then the `csi_job_due` hide-then-drop.

**November 21 close (20:50 New York): `main` serves production.**
- **Granot retire-on-use is ON** (#257). The backlog run retired 6,057 receipts with 0 failures, and read-back by ID from GCS is proven. The TTL indexes and the old trial records are gone. Compaction is deferred to after the November 26 rerun. [Release record and next steps](GRANOT-RETIRE-ON-USE-RELEASE-2026-11-21.md)
- **Booking Job Number enforcement is ON (18:14).** It blocks only a missing Job Number, and Granot-created Bookings are never blocked (#260). Rollback: `control.ts set --mode=shadow`.
- **Also live:**
  - #258: the Sheet Sync profile and `pnpm vantage -- sheet-sync reconcile`.
  - #259: the lean-test Owner directive.
  - #261: no import-time `.env` load; tests refuse a non-loopback `MONGO_URI`.
- **Next storage targets:**
  - Granot decision 2, relaxing the Observation and Decision reference holds.
  - Then `daily_operations_events` (190 MB), `sales_intelligence_jobs` (176 MB), `entity_changes` and `domain_command_executions` (about 65 MB each, no expiry) and the Sheet Sync logs (about 113 MB).

**November 21 status (16:30 New York).**
- **Program started locally.** The Owner chose to start the program on the workstation rather than wait for the cloud environment. Two agents work in parallel, each in its own worktree with a real install, and each opens a PR:
  - workstream 5: the Sheet Sync agent profile plus `pnpm vantage -- sheet-sync reconcile`;
  - workstream 1: the GCS contract and module, with fake-bucket tests.
  - Cloud setup (#254 and its first-session checklist) remains a separate track.
- **Carry-overs 1 and 2 are closed.** Details are below.
- **#255 and #256 are merged and deployed.** Details are in item 8.

The next session starts the Owner's [next program](NEXT-PROGRAM-2026-11-20.md). It has five workstreams:

1. A Google Cloud Storage service.
2. Further reviews.
3. A clean-code cleanup.
4. Git-triggered quality checkpoints.
5. Agent profiles and CLI runners for every major service.

The November 20 tracks are complete; their record is below.

**Kickoff prompt.** Paste this to start:

> In the `vantage-dev` cloud environment ([CLOUD-SESSIONS.md](docs/operations/CLOUD-SESSIONS.md); run its first-session checklist first), run the next program from `docs/operations/NEXT-PROGRAM-2026-11-20.md`, workstreams in order, with separate agents and one worktree per agent. Start with workstream 5's Sheet Sync profile and CLI runner and workstream 1's GCS module design, in parallel. First close the carry-overs listed under "Start here" in `NEXT-SESSION.md`. Every merge to `main` deploys production. Open PRs, have each independently reviewed, and merge only with my approval, just after a top-of-hour slot.

### State at close (November 20, 20:15 New York)

**Production.** `main` `9c0cc421` is serving production. Every release below is deployed and observed:

| PR | What it changed |
| --- | --- |
| #243 | Granot scheduled sibling catch-up, Record Links, bounded post-commit steps and disputes. Follow-ups are capped at 50 per plan, with a 6-hour backoff. |
| #245 | Forms and Duplicate Forms are exclusive. Every positional Sheet update rechecks row identity. |
| #246 | The routine three-day purge is restored after a retry. |
| #247 | Sheet removals honour protection editors. Stale `processing` leases are reclaimed (cap 3, then the job fails), replacing "never reset processing jobs". |
| #250 | Lead job-number point lookups (Calls fell from about 1,342 keys to about 6). Retention holds are hardened. |
| #251 | Two Form Lead contact-email indexes, 344 KB per member. The contact match fell from about 1,771 keys to about 1.3. |
| #252 | Booking job-number validation in **shadow** mode, a normalization drift check on the booking-reconciliation cron, and removal of the Pool full scan. |

**Docs.** #244 is the [Lead lifecycle pack](../knowledge/lead-lifecycle/README.md). #248 is the next program.

**Sheets.** Forms, Duplicate Forms, Bad Form Leads, Booked Deals and Cancelled Deals match MongoDB exactly. Calls and Duplicate Calls are handled manually by the Owner. The [pack's COVERAGE](../knowledge/lead-lifecycle/COVERAGE.md) lists their known differences.

**Owner-approved data fixes on November 20:**

- 592 pre-November 3 Bad Forms were removed from Forms.
- 7 Forms were re-delivered to their correct tab.
- 6 orphan rows and 1 stale Duplicate Forms row were removed.
- The September 6 No-Sync test booking row was removed.
- The August 19–20 replica-test fixtures were purged: 37 Cancellations and 3 Bookings.
- The September 8 `EJBA03` test Booking and its test Call Lead were deleted.

Evidence is in the main checkout's untracked `.tmp/bad-form-cleanup-2026-11-20/` and the workspace's private `internal/booking-job-number-2026-11-20/`.

### Carry-overs to close first

1. **~~Hidden-index drop~~ DONE.**
   - The drop ran at 22:17 New York on November 20 and exited 0.
   - On November 21: all 13 indexes are absent, `call_leads.source_granularity_id_1` is present, the covering compounds are visible, and the task is unregistered.
   - The result is recorded on [PR #249](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/249). The Owner approved its merge on November 21.
   - Still open: the Atlas slow-query check, which is blocked from this workstation.
2. **~~Booking job-number shadow review~~ DONE (November 21, 16:16 New York).**
   - After about 20 hours in shadow: **0 would-reject records** and drift 0.
   - **The `enforce` decision is the Owner's.**
   - The rule rejects these spellings, which never appeared in the replay: `P5556759-1`, `P5556759 (2nd)`, `5,556,759`, `5556759A` and a Cyrillic `Р` prefix.
3. **Booked Deals row 541.** Booking `6a7a47dfc78f1e03f807d970` (August 10) has the customer's name in its Job Number field. The Owner does not know the job. A read-only search of the Lead link and every other stored record ran on November 20; see the private evidence folder for its result.
   - Without a definitive Granot job, leave it as is (Owner, November 20). It still reports as a booking, and its Lead stays out of the Pool through `lead_ref`.
   - The job-number rule checks only a changed job number, so it is not flagged.
4. **Calls tabs: Owner only.** No Calls-tab backfill, repair job or major change (Owner directive, November 20). The known differences:
   - 209 rows of pre-November 3 Calls without RingCentral admission.
   - Calls row 317, a Form Fill Call.
   - 3 Form Fill Calls with no row.
   - 55 qualified Calls with no row.

   A hand-removed row on a billable Call comes back on that Call's next update.
5. **Owner decisions still open.** Details are in COVERAGE.
   - `form_fill` is never cleared.
   - `POST /booked-leads/from-source` still accepts the retired Best Relocation source.
   - `confirmGranotBooking` does not prefer the Form Lead.
   - The Desk, the Daily Operations rebuild and legacy Analytics do not check Call admission.
   - Legacy Analytics sums the stamped CPL.
   - The optional Number summary consistency check needs a cadence and alerting decision.
6. **Follow-ups found on November 20.**
   - Cross-path job matching: cancellation correlation, employee-booking matching, `equivalentNormalizedJobFilter` and the unique index do not treat `P 5556759` as `P5556759` (#252 docs).
   - After hardening, the retention fast path still scans 29 of 34 batches.
   - 40 production job groups have Record Links that name more than one Lead.
   - Header migration before any new managed Sheet column: the proposal is on #247.
   - The seven-day all-member `$indexStats` series has not started. Atlas slow-query access from this workstation is blocked by the service account's API access list.
   - ~~The #252 drift check and the #251 tool's `countDocuments` have no `maxTimeMS`.~~ Fixed in [PR #255](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/255). A timed-out drift scan now records `last_attempt_at` and stays throttled hourly.
7. **Earlier clocks.** See "Clocks still open" in the record below: November 21 17:33, November 22 16:27, November 23 21:06, November 26 00:00 UTC, November 27 20:04 and December 19.

8. **Late November 20 stability pass (21:40 New York).**
   - **PR #255** was merged and deployed at 16:03 New York on November 21 (`549cf45b`). The 16:00 slot's 25 runs completed with no failures. On a MongoDB credential rejection (code 18), the five queue consumers now acknowledge the wake-up, and the current deployment's cron drains the work. Before this, the superseded November 19 deployment `5137f06f` retried Sales Intelligence and Granot lifecycle wake-ups about 176 times an hour from 10:00 to 16:30 UTC. Live production was unaffected. [Rule](README.md)
   - **Repository cleanup.**
     - Six merged worktrees were removed: `booking-jobno`, `pr245-review`, `-lifecycle`, `-ops`, `-ops2` and `-tracka`. Their `.tmp` evidence was copied, verified identical, to the main checkout's `.tmp/bad-form-cleanup-2026-11-20/from-worktree-*`.
     - Every merged branch was deleted, locally and on GitHub. Only `main` and the open PRs #222, #249, #253, #254 and #255 remain.
     - The main checkout is on `main`.
     - The root's ignored scratch files (`.owner-*.log`, `.cleanup-*`, `.storage-*`) moved to `.tmp/root-scratch-archive-2026-11-20/`.
   - **PR #256** was merged and deployed at 16:21 New York on November 21 (`76cbfb53`).
     - **The failure.** From 17:06 UTC every `granot-storage-retention` run threw `Granot shadow Pool mismatch` (107 by 21:20). The sampled Call Lead `6a690a4fdd2ddd5892879876` holds its v2 proof, but its accepted Observation, Decision and receipt had already left MongoDB. The history read could only refuse it, and the aborted transaction kept the cursor on it.
     - **Impact.** Shadow mode never deletes, so nothing was at risk. Pool admission uses the current read and was unaffected.
     - **The fix.** Such samples are counted in `read_comparisons_skipped_retired_chain`, the last 20 go to `read_comparisons_skipped_samples`, they are logged as `granot_retention.shadow_comparison_skipped`, and the cursor advances. The first run after deploy recorded the skip and failures stopped at 107.
     - **Promotion.** The seven-day promotion window restarts, because November 21 has failures.
     - **Open.**
       - Which retention path removed that chain? It has no `granot_archived_receipts` locator.
       - How many active-Pool v2 Leads are in the same state?
       - Owner decision: should the promotion gate bound the share of skipped samples?

### Working rules learned on November 20

These are also part of [workstream 5](NEXT-PROGRAM-2026-11-20.md#5-agent-profiles-and-cli-runners-per-stack-and-service).

- **Worktrees.** Give each agent its own worktree with a real `pnpm install`. Never junction `node_modules`. Never edit a worktree another agent uses; two collisions happened on November 20.
- **Line endings.** The repository stores LF, and this machine has `core.autocrlf=true`. Never commit with `-c core.autocrlf=false`. Check with `git ls-files --eol` and `git diff --stat origin/main...HEAD`.
- **New York time.** Use PowerShell `Get-Date`; the machine's local zone is Eastern. Git Bash `TZ=America/New_York date` prints UTC.
- **Merging.** Use `gh pr merge --match-head-commit <sha>`. Re-check CI right before merging, because leaving draft re-runs the checks. Merge just after a top-of-hour slot. Estimates slots run at 06, 09, 13, 17 and 21; ALL and Pool run hourly.
- **Replica tests.**
  - Use a suffixed `TEST_MONGO_DATABASE_NAME` (`testvantagemovers_<x>`) on csi01: `mongodb://127.0.0.1:27189/?replicaSet=csi01`.
  - Some suites hard-code ports 27961, 27964 or 27129, or the `poolcollector` and `capacityp1` fixtures.
  - Every replica test must assert a loopback target; the August fixtures that reached production show why.
- **Production access.**
  - Mongo: `.env` with `TEST_MODE=false`, and find or aggregate only.
  - Sheets: `values.get` and `spreadsheets.get` only.
  - Queue ordinary Sheet Sync re-delivery (`enqueueSheetSyncJob`, `createdBy: "script"`) only with Owner approval, and never for the Calls tabs.

## Completed November 20 tracks (record)

Track A (engineering) and Track B (Lead lifecycle documentation) both closed on November 20. The original instructions follow.

### Two tracks (Owner, November 20)

Run both tracks in the same session, with separate agents.

- **Track A, engineering:** the "Start here" handoff below. Confirm the scheduled index drop, release the three Granot fixes, then take the Sheet Sync follow-ups and the index phase.
- **Track B, Lead lifecycle documentation:** document completely, and from the current code, how Form Leads, Duplicate Forms, Bad Form Leads, Call Leads, Duplicate Calls and Bad Call Leads are created and move through their lifecycle. The [brief](LEAD-LIFECYCLE-DOCUMENTATION-BRIEF.md) sets the outputs, the four mandatory inventories and the verification. Track B is complete only when its coverage file has zero unclassified rows and an independent verifier signs off.
- **Hand-off between tracks:** after Track A merges, Track B re-verifies its Granot sibling and Form Fill sections against the merged code. Track A's sibling fix must satisfy Track B's documented gate.

## November 20 handoff (completed record)

**State.** `main` is serving `25ae0026` in production. The November 20 review of Sales Outreach, Sheet Sync, Granot runs and Lead updates, and RingCentral found one critical defect, in Sheet Sync. It was fixed and deployed in [PR #237](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/237). Every queue was empty and healthy at review time. [Full review, evidence and verified behaviour](SERVICE-REVIEW-2026-11-20.md)

- **Disk:** each member uses about 24% of its 17.3 GB disk after the November 20 compaction.
- **Hidden indexes:** 13 redundant Lead indexes are hidden and wait for the scheduled drop.

**1. Confirm the scheduled index drop.** Windows Task Scheduler task "Vantage drop hidden redundant indexes" runs once at 22:17 New York on November 20, on the Owner's laptop. If the laptop is off then, `StartWhenAvailable` runs it at the next start.

- **What it runs:** `.tmp/scheduled-index-drop-2026-11-20.ps1` (untracked), which calls `node ops/capacity/retire-redundant-indexes-2026-11-20.cjs --drop`.
- **Guards:** the wrapper exits 3 if the tool lacks its hidden gate, and 4 before 03:04:35 UTC on November 21. The tool then refuses any target that is visible, has a changed key or lacks a visible covering compound.
- **Log:** `.tmp/scheduled-index-drop-2026-11-20.log`. The before and after `listIndexes` files land in `docs/operations/evidence/redundant-indexes-{before,after}-*.json`.
- **Verify:**
  - The log ends with `exit 0`.
  - All 13 names are absent from every collection's `listIndexes`.
  - `call_leads.source_granularity_id_1` is still present.
  - The Atlas slow-query log shows no new slow shape on `form_leads`, `call_leads`, `booked_leads`, `lead_messages` or `booking_lead_reconciliation_cases`.
- **If it did not run:** run the same command manually. Unhide (`--unhide`) only to roll back before the drop.
- **Rollback after the drop:** recreate each index from its before file with `createIndex`.
- **Afterwards:** record the result in [INDEX-READ-BASELINE](INDEX-READ-BASELINE-2026-11-19.md#november-20-actions-owner-approved) and unregister the task with `Unregister-ScheduledTask -TaskName "Vantage drop hidden redundant indexes" -Confirm:$false`.

**2. Fix the three Granot regressions from `5137f06f`.** Each one had zero measured production impact on November 20, so fix them as one bounded release. Details and file references are in the [review](SERVICE-REVIEW-2026-11-20.md#granot-runs-and-lead-updates).

1. **Form→Call sibling catch-up.** Restore the Owner's October 28 sibling rule for a Call that qualifies after its Form already holds the job. Prefer mirroring when a scheduled row is `already_current` for a Form, or when the RingCentral queue creates the Call. Never create or qualify a Call outside the RingCentral queue. Keep the mirror's eligibility gate unchanged (`callLeadFormSibling.ts`). The target Call must already be reporting-eligible under `hasReportingEligibleCall` (`leads/callLeadAdmission.ts`). That means RingCentral inbound queue qualification, or a preserved historical or trusted final-import Best Relocation admission. It must not be a 90-day repeat `duplicate` or `created_on_unmatched`. New Calls are still created only by the RingCentral queue. The Form Fill rule matters here. A qualified Call whose phone matches a same-source Form gets `form_fill: true` (`detectFormFill`, `drainFormFillWork.ts`). `callLeadReportingDisposition.ts` routes it to **Duplicate Calls**, and it is not billable. The mirror does not exclude `form_fill`. The usual sibling is that Form Fill Call, so mirrored job, priority and receiver updates land on its Duplicate Calls row. The mirror never changes `form_fill`, `duplicate` or qualification, and the tab follows those flags, not the job, so the Call never moves to the Calls tab. Add tests showing that the catch-up updates a Form Fill Call in place on Duplicate Calls, never writes to a repeat-duplicate or non-eligible Call, and still reaches an eligible preserved Best Relocation Call.
2. **Record Links.** Establish the Record Link for an `already_current` Lead without an active link, as the webhook processor does.
3. **Post-commit retries.** Bound the scheduled path's post-commit Lead-link wake and sibling mirror. Use the webhook path's rule: 2 s, never throw, record the failure. A persistent error must no longer block the run until its 24-hour expiry.
4. **Disputes.** Persist the Record Link dispute instead of discarding it on the skip path.

**Test:**
- an `already_current` Form with a later qualified Call;
- an unlinked current Lead;
- a mirror that always fails, with the rest of the run still completing;
- an idempotent replay;
- the existing Granot lifecycle replica suites (`*.replica.test.ts`), which need a local replica.

Release through a PR, then observe one natural ALL and Pool slot.

**3. Sheet Sync follow-ups.** None of these is urgent in the current workbook, except the first, which needs an Owner decision.

- **Excluded legacy Calls on the Calls tab:** four rows on Calls and one on Duplicate Calls belong to excluded legacy Leads (`missing_call_reporting_admission`). Sheet Sync does not remove the rows of excluded Leads. Get the Owner's decision, then measure how many excluded Leads hold rows on any tab. [Details](SERVICE-REVIEW-2026-11-20.md#sheet-sync)
- **Phone cells:** the formula-phone bug is fixed and repaired (PR #240, 1,711 rows).


- **Header changes:** decide how a managed header change ships. Delivery now refuses a tab whose header row lacks the full managed list (`sheet_identity_header_rewrite_unsafe`). A release that adds a column must migrate tab headers first.
- **Protection:** before anyone protects a tab, make the removal check honour protection editors and warning-only protections.
- **Stuck jobs:** jobs left in `processing` by a killed worker are pre-existing and need operator requeue. Consider stale-lease reclamation.

**4. Index and read phase.** The plan is in the section below. Reclaim is done. The review found these slow shapes worth targeting first, all from before the hide:

- `booked_leads`: 508 collection scans.
- `call_leads` by `normalized_job_no`: about 1,335 keys examined for about 38 returned.
- `form_leads`: 77 collection scans on `last_accepted_granot_observation.observation_id`.
- `form_leads` duplicate-match `$or`: about 3,000 keys examined for 0 returned.

[Targets](SERVICE-REVIEW-2026-11-20.md#index-phase-targets-found-during-the-review)

**5. Minor items from the review.**
- Restore the three-day purge for routine jobs retried once (`salesIntelligence/jobs.ts`, `c4176fab`).
- Add unit coverage for the Outreach overlap `existingJobMatches` branch.
- Optionally, add a periodic Number summary consistency check, since unchanged recounts are now skipped.

**Operator tools added November 20.**
- `ops/capacity/retire-redundant-indexes-2026-11-20.cjs` (`preflight`, `--hide`, `--unhide`, `--drop`).
- `ops/capacity/compact-operator-2026-11-20.cjs` (`status`, `create <new private path>`, `failover`, `delete`). It uses the `MONGO.env` service account and never modifies `jbell_db_user`.
- `scripts/storage-compact.ts` and `scripts/storage-reclaim-report.ts`. These are local and untracked.

## Granot receipt retention

The next Granot session should determine when a receipt has finished matching or updating a Lead and how soon its full document can leave MongoDB. A receipt tracks one delivery. A scheduled Estimates run tracks many actions. Older HTTP automation stored a result in both places. New scheduled Estimates already bypass receipt capture, and eligible inbound `lead_created` and `priority_updated` receipts already move to verified Google Cloud Storage (GCS). A genuine webhook can arrive without any run. [Scheduled apply](../knowledge/granot-lifecycle/automation-apply.md) · [Inbound retirement](../knowledge/granot-lifecycle/capture.md#retirement-of-completed-inbound-lead-receipts)

Start with the remaining receipts. The November 19 cleanup retired 22,781 historical HTTP receipts. Of the 13,019 held in that cohort, 6,066 still had live evidence or lacked a verified archive page, and 6,953 lacked closed-run replay proof. At 21:01 New York the primary held 13,032 receipts across all channels, totaling 28.6 MiB of logical data, with 1,119.6 MiB of allocated collection space available for reuse. Measure fresh arrivals and removals to establish the current growth rate. [Cleanup results](../../../storage-capacity-analysis-2026-11-17/granot-receipt-cleanup-2026-11-19/RESULTS.md) · [Storage baseline](INDEX-READ-BASELINE-2026-11-19.md)

1. **Prove fulfillment.** Trace the receipt through its Observation and Synchronization Decision to the matched Lead. For an update, verify the committed effect on that Lead and any required Sheet or Outreach handoff. For an already-current, stale or policy-final outcome, identify the durable evidence that closes it. Keep pending matches, retries, conflicts and unresolved downstream work available to their workers.
2. **Decide what each channel still needs.** Trace inbound webhooks, historical HTTP actions and browser-extension operations separately. Where an original-ID reader needs the body, reuse its verified GCS generation and compact lookup. Where all remaining readers and recovery paths can use the Lead, Decision or closed-run replay, test deleting the full receipt without creating another archive copy or locator. Verify duplicate delivery and changed-input handling through the channel's normal entry point, including a retry during removal. Preserve Daily Operations counts and the extension's unique operation identity.
3. **Prove the collection stays bounded.** In the implementation session, test a matched update, a terminal no-change, a held receipt and an interrupted retirement. Give the existing production watch the longer measurement of daily arrivals and distinct removals by channel, time from fulfillment to removal, age and reason for holds, and net MongoDB bytes including locators. Report one-time backlog cleanup separately. The decision is which receipts can leave immediately, which need GCS, and what specific work keeps the rest in MongoDB.

**November 21, PR #257 (not merged).** Retire on use is implemented for all three channels, with read-back by original ID, the backlog command `ops/granot-retire-used-receipts.ts` and the removal of the shadow and TTL path. It stays off until the Owner runs `ops/granot-retention-install.ts --install` and `--enable`. Steps 1 and 2 are covered by the "used" table and reader inventory in [storage retention](../knowledge/granot-lifecycle/storage-retention-operations.md#retire-on-use). Step 3 still needs the production watch after enabling. [PR #257](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/257)

**November 19 Sales Outreach and RingCentral Capture and Numbers.** Both services shipped. The receipt cleanup released 64.76 MiB logical. Both repeat previews returned zero. The November 18 receipt mix projects 9.61 MiB/day less BSON. Signed Numbers and Desk reads agreed with canonical calls, assignments and rep-day totals. [Production release and observation queries](OUTREACH-NUMBERS-RELEASE-2026-11-19.md)

**November 19 Daily Operations, domain commands and Master Sheets.** Backlog cleanup removed 49,332,062 redundant BSON bytes from 1,006,476 records. The repeated cutoff preview returned zero. Keep canonical acceptance, immutable revisions, 400-day board facts, Sheet intents and 90-day attempt history in MongoDB. Runtime `62653f03` reproduced the closed day and all four timeline cases. The worker repaired six duplicate IDs in 6.47 seconds. All eight tabs and the empty queue verified. Follow up on natural milestone visibility and the 57.33 MiB increase in allocated data plus indexes. [Release and remaining proof](DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md)

## Collection-wide index and read optimization

The service storage passes are released. Production served `d5a1d33c` at 19:34 New York on November 19. Start from the [read-only index and read baseline](INDEX-READ-BASELINE-2026-11-19.md). Each Service doc under `docs/knowledge/` has a "Storage, indexes and read paths" section. It lists the declared indexes, their query shapes and retention.

1. **Measure.** Capture `$indexStats` and `$collStats` on all three members at matched hours for seven days. The first sample covered only 29.2 hours on the primary. Add a slow-query or profiler sample for the hottest collections. Record the members, the windows and counter resets.
2. **Attribute.** Map each index with zero or low reads to its declared query owner in the Service doc. Map each hot read to its code path. Hot reads include the `_id` reads on `form_leads`, `granot_observations` and `granot_webhook_receipts`, the `sheet_sync_leases.scope_1` reads and the `granot_automation_runs.granot_run_recovery` reads. Mark unknown owners as unknown.
3. **Propose.** For each change, give its bytes, its write amplification, the plans before and after on the owning queries, and its rollback. Prefer hiding an index before dropping it. Batch or project hot reads only where the business contract is unchanged.
4. **Reclaim.** Done on November 20 for all members, including the oplog. Recheck the reusable space per member after large cleanups, because deletions inflate the oplog file again.

**Authority.** This handoff grants no index, TTL, compact, deletion or deployment authority. Each production change needs explicit Owner approval with its scope recorded.

Preserve RingCentral-only Call Lead qualification, saved historical qualifications, official Booking and Cancellation reporting, Master Sheet tab identities, command replay identities and recovery evidence.

**November 20 progress.**
- **Indexes:** 13 prefix-redundant Lead indexes are hidden in production (PR #235). The drop is scheduled for 22:17 New York on November 20. See "Start here" above.
- **Compact:** done on all three members, including the oplog. A temporary operator ran it and was then deleted, and member 02 is now primary after a Test Failover. Disk use fell from 49.0/58.9/53.4% to 24.2/23.6/24.5%, returning 15,394.5 MB in total. Oplog windows held at 25.6 hours. [Results](INDEX-READ-BASELINE-2026-11-19.md#november-20-actions-owner-approved)
- **Review:** the four-service review found one critical Sheet Sync defect, fixed in PR #237 (`25ae0026`), and three Granot regressions to fix next. [Review](SERVICE-REVIEW-2026-11-20.md)
- **Next:** confirm the scheduled drop, release the Granot fixes, then run the seven-day index series against the compacted files.

**Clocks still open from earlier releases:**

- **November 21 after 17:33 New York:** the eight-job Outreach expiry witness.
- **November 22 after 16:27:17.007 New York:** the compact-receipt TTL check, plus the first-natural-receipt check for no stored preview or credential headers.
- **November 23 at 21:06:40 New York:** the W1 checkpoint.
- **November 26 at 00:00 UTC:** the earliest Granot receipt-expiry promotion, if November 19–25 are clean.
- **November 27 at 20:04:51 New York:** the first fourteen-day Sales Intelligence job deadline.
- **December 19 after 16:21:36.666 New York:** GCS generation expiry for the Sales Intelligence packs.
- **Still to collect:** natural Daily Operations milestone visibility percentiles, and the matched-hour capacity watch. [Outreach and Numbers observations](OUTREACH-NUMBERS-RELEASE-2026-11-19.md#owner-observations) · [Daily Operations remaining proof](DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md)

## Completed November 19 assignment — Daily Operations, commands and Master Sheets

Released and verified on November 19. Outcome, measurements and remaining proof are in the [release record](DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md). The Owner's original assignment follows for reference.

Complete the Daily Operations, Lead/Booking/Cancellation commands, and Master Sheets storage and workload optimization on vantage-main-server main. Carry it through implementation, deployment, eligible backlog cleanup, and live verification. You have my authorization to use the server code and logic, MongoDB Atlas, Google Cloud Storage, and the Google Sheets integration for every service and collection in scope.

Start with the [root owner ledger](C:/Users/Pinda/Proyectos/vantage/OWNER-STORAGE-LEDGER.md) and the [Sales Intelligence release record](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/operations/SALES-INTELLIGENCE-JOBS-RELEASE-2026-11-19.md). Apply the same evidence and release strategy. Complete these three areas in order.
### Daily Operations and `daily_operations_events`

Historical display rows have already been trimmed, and retained events have a 400-day TTL. Determine exactly what the live board, day close, historical views, and late corrections read from these events. Price the current design against viable alternatives, including coalesced refreshes, rebuilding from canonical records, and archiving closed-day history to GCS. Verify that the chosen design reproduces a representative closed day and handles a correction after the New York day boundary.

**Job number timeline**

Simplify the job number timeline. I want a short history that answers three questions at a glance. Where did the lead originate? When was the job number linked, if known? When was the job booked or cancelled? Show the lead origin, the first job-number link, and any official Booking or Cancellation in chronological order. If a job was booked and later cancelled, show both. If an official Booking or Cancellation has no linked Lead, show the known milestones without inventing an origin.

Exact event-by-event history and real-time updates are no longer requirements. Routine field edits, repeated observations, sync attempts, and retries can be omitted from the timeline. Derive milestones from canonical records wherever those records preserve the historical fact and its date. Before retiring granular events, verify whether another consumer still needs them for day close, corrections, command replay, or sheet delivery.

Verify the simplified timeline against production examples of an open job, a booked job, and a booked-then-cancelled job, plus a leadless official record if available. Record which event writes and retained rows this simplification removes, the measured savings, and any history that still needs MongoDB or GCS.

### Lead, Booking, and Cancellation commands

Cover `domain_command_executions` and `entity_changes`. Trace every producer and consumer, including retry and replay paths, downstream workers, and their checkpoints. Determine which records must remain queryable in MongoDB, for how long, and what can be compacted, archived, or removed. Preserve durable command acceptance, idempotency, same-key conflict detection, and recovery after partial failure. Preserve RingCentral Call Lead qualification and billing, legitimate historical qualifications, and official Booking and Cancellation reporting, including leadless records.

### Master Sheets

Cover `sheet_sync_jobs` and `sheet_sync_attempts`. Cover all six Master Leads tabs and both Master Booked tabs. Measure the cost of enqueuing, polling, retrying, and retaining delivery history. Coalesce superseded work wherever the latest canonical state is sufficient. Preserve spreadsheet and tab identities, correct row placement and removal, and operator-owned cells. Prove recovery when Sheets accepts a write and the worker stops before MongoDB records success. Verify that an older retry cannot overwrite a newer correction or recreate a removed row.
### Measurement, release, and verification across all three areas

Eventual consistency is acceptable. The board and sheets can update in batches. Choose a reasonable cadence from measured traffic and business use. Keep canonical commands durable and make downstream work recoverable. Report the observed median and 95th-percentile time from a canonical change to its visible result, the oldest pending work, and how quickly a backlog drains. Verify that the system converges to the correct result after retries and late corrections.

Measure before changing production. Use a representative full business day where available, identify peak and day-close windows, and state the dates, time zone, units, and sampling limits. Measure per-collection reads and writes where observable, document counts, logical bytes, allocated storage, index bytes, and queue age. For each proposed change, show the arithmetic for ongoing work removed and work added across MongoDB, the server, GCS, and Sheets. Keep one-time cleanup savings separate from recurring savings. Record query shapes and index usage now so the later collection-wide index analysis has a baseline.

Release and clean up against explicit eligibility rules. Test duplicate delivery, worker interruption, replay, and late correction before deployment. Verify the production API and affected workers are running the intended revision. Preview cleanup by collection and cutoff, with counts, bytes, and reasons for held records. Apply eligible cleanup in bounded, restartable batches and rerun the preview. Where GCS takes over a retention obligation, verify the object generation, checksum, and restore or lookup path before removing the MongoDB copy. Verify live board and sheet results against canonical records using real activity, and identify the observation window for each claim.

Update the server ledgers, server handoff, and root owner ledger with the deployed revision, before-and-after measurements, eligible and held backlog, observed delivery lag, and what stays in MongoDB or GCS and why. End with a status for each of the three areas and the exact outstanding proof for anything still open. The overall final measurements and broad index refactor come after this assignment.

## Previous release notes

**November 19 Sales Intelligence jobs and Sales Outreach.** Production removed 233,735 full jobs and compacted 177,836 replay receipts, saving 202.23 MiB net logical BSON. Keep current Desk, attribution, admissions and worker recovery evidence in MongoDB. Verified rollback data occupies 38.72 MiB in GCS. The next proof is the November 22 new-receipt TTL check, then December 19 generation-specific recovery expiry. [Release and measured results](SALES-INTELLIGENCE-JOBS-RELEASE-2026-11-19.md) · [Owner bookmark](C:/Users/Pinda/Proyectos/vantage/SERVER-OPTIMIZATION.md)

**November 19 Granot receipt cleanup.** Production removed 22,781 historical HTTP receipts and six superseded Observations with their six Decisions. Verified archive locators reduced the receipt cohort by 47.10 MiB net. Eight original-ID lookups and replays passed. The duplicate rollback generation entered its 30-day recovery window. Sales Intelligence jobs are next. [Archive release procedure](../knowledge/granot-lifecycle/storage-retention-operations.md)

**Fulfilled scheduled Estimates runs are in production.** The November 19 drain verified and retired the complete baseline and 130 later arrivals, with zero held runs. For the next scheduled slot, use the normal two-minute worker and compare the run completion timestamp with its MongoDB deletion timestamp. [Measured release](SERVICE-OPTIMIZATION-ROADMAP.md) · [Workspace verification bookmark](C:/Users/Pinda/Proyectos/vantage/SERVER-OPTIMIZATION.md)

**November 19 Owner correction.** Scheduled Estimates now have a direct Lead change path in the primary checkout. Fresh polls skip unchanged, unmatched and ambiguous Leads. New scheduled actions bypass webhook receipt capture, enqueue Sheet Sync for affected fields and request an Outreach refresh for a committed priority change. Qualify a live slot for zero new automation webhook receipts before the historical cleanup. The November 19 9 a.m. figures and archive-first proposals below describe the pre-cutover producer and its historical data. [Current scheduled apply contract](../knowledge/granot-lifecycle/automation-apply.md)

## November 19 pre-cutover receipt and run design

The following records the design and volumes before the November 19 releases. Use the [current receipt retention handoff](#granot-receipt-retention) for the remaining cohorts.

The Owner's November 19 scope covers all four collections, with fulfilled receipts first. Implement on server `main`. The target is the first point at which a retry, reader or downstream worker can finish from independently durable state. The following are implementation targets. The existing production controls and measured retirement are recorded below.

**Use the existing GCS archive.** On November 19 a read-only `buckets.testIamPermissions` request using the checkout's production-mode service-account credential returned `storage.objects.create` and `storage.objects.get` on `vantage-mongodb-backups-496816`. The server uses its shared Google service-account helper, writes content-addressed objects with a generation-zero precondition and reads back the pinned generation to verify its SHA-256. Production has already published and recovered Granot history. Use this path for the four collections. Vercel Blob is the fallback if production loses access. [Archive adapter](../../src/services/granotHistory/archiveObjects.ts) · [Production archive evidence and object layout](GRANOT-HOT-STORAGE-2026-11-18.md)

| MongoDB collection | Earliest proposed retirement and reader contract |
|---|---|
| `granot_webhook_receipts` | Start with completed scheduled HTTP actions classified as already current or older than the temporal winner. Publish the sealed run's operation manifest while the receipt, Observation and Decision are still present. Once verified, serve same-key retries from that manifest with the original operation kind, payload hash, result and expiry. Remove the full receipt once history lookup by receipt ID works and its live references release it. For a genuine webhook, preserve its Daily Operations count and receipt-ID history. For a browser extension operation, keep its compact unique channel/operation record for duplicate and changed-payload detection. Pending matches, retryable effects and leased work remain actionable. |
| `granot_observations` | For the first cohort, publish the linked chain once to job/month history. Verify job timeline recovery by original observation ID and a later accepted winner. Remove with its Decision when the reference check clears. Keep the winning Lead snapshot, contact/move provenance, priority-5 pairing, open reconciliation and Desk pool/subject evidence while those readers depend on it. |
| `granot_automation_runs` | For sealed, completed scheduled runs, verify the approved actions against their actual operation namespace and every required Outreach refresh. Publish and read back exact run BSON and operation replay, then transact the closed-run index and compact summary. Today compaction waits for original expiry (24 hours). To advance it to terminal completion, first exercise the ordinary apply/retry path on both sides of original expiry, including a duplicate during closure. Today the summary expires at the latest of creation + 9 days, slot purge + 1 day and compaction + 1 day. Move schedule coverage, deduplication and unapplied-action counts to an independent reader before shortening that tail. |
| `synchronization_decisions` | Remove a superseded, effect-free Decision in the same verified chain as its Observation. For an applied change, require durable Lead state and completed or independently recoverable Sheet Sync and Outreach work. Keep Decision IDs used by Record Links, entity provenance, Booking or Cancellation reconciliation and retry until their readers can retrieve the same evidence. Recheck references and source identity at commit. |

**Drain capacity.** At the 9 a.m. mix, 13 equal slots would produce 90,870 scheduled receipts/day and 1,690 runs/day. One 64-receipt page per two-minute tick can examine at most 46,080/day even at full utilization. At 80% unique eligible utilization, three pages per tick would retire 110,592/day; a fourth provides catch-up capacity. Four run reviews per tick permit 2,880 reviews/day before holds. Size both budgets against observed GCS latency and distinct successful removals. The receipt worker currently reviews chains older than one day and gates automatic expiry on seven clean UTC days. Advance eligibility for proven cohorts using completion and committed replay publication. Measure completion-to-removal latency, hold age and net backlog separately for each collection across all 13 starts, discovery and the overnight gap. [Receipt worker](../../src/services/granotHistory/futureRetention.ts) · [Reference checks](../../src/services/granotHistory/retentionReferences.ts) · [Scheduled run archiver](../../src/services/granotHistory/scheduledRunArchive.ts)

**Measured overlap.** In the completed November 19 9 a.m. New York slot, 65 ALL and 65 Pool refresh runs stored 6,990 action results. Every result pointed to a different, completed HTTP automation receipt still in MongoDB. Those receipt documents occupied 15.33 MB of logical BSON in addition to 2.05 MB of action results embedded in the run documents. At the same volume and document size across 13 ordinary slots, that would add approximately 90,870 receipts and 199 MB of receipt BSON per day before removals. Price daily discovery, genuine webhooks and extension traffic separately. The overnight watch saw 29 real webhook receipts with zero new scheduled runs. [Slot measurement](../../../storage-capacity-analysis-2026-11-17/receipt-run-overlap-2026-11-19-0900.json) · [Overnight and morning observations](../../../storage-capacity-analysis-2026-11-17/watch/OBSERVATIONS.md)

1. **Define completion by outcome and channel.** Trace a real match and update, an already-current or stale result, and an unresolved or retryable match. Identify the durable record that proves the outcome and any required Sheet or Sales Outreach work is complete or independently recoverable. Scheduled runs carry per-action results. Genuine webhooks and browser extension receipts require their own evidence.
2. **Choose what survives.** For fulfilled operations, identify which readers still need the original body, an original result, or just the operation identity. Where a receipt can be discarded, show that a duplicate or late retry returns the original result or follows the original expiry rule without repeating business effects. Where history is needed, reuse the existing GCS archive and its checksum/generation lookup. Exercise recovery through the ordinary reader before removing the hot source. Include an interrupted transfer, a retry during removal, and reuse of an operation ID with a changed payload.
3. **Measure the drain.** Compare arrivals and distinct removals per day, retained MongoDB document and index bytes, locator bytes, and GCS bytes. Break out receipts still waiting for a match, a retry or a downstream dependency. The November 19 morning watch found receipt retirement in shadow mode. The steady-state receipt count and storage cost are the outcome of this next session. [Existing archive and replay design](GRANOT-HOT-STORAGE-2026-11-18.md) · [Receipt qualification and archive reader](../../src/services/granotHistory/settledLeadEvidence.ts) · [Retention worker](../../src/services/granotHistory/futureRetention.ts)

**Index release already live.** On November 19, server `2fb10de8` removed the diagnostic payload-hash index declaration and the index was dropped on the production replica set. The other seven receipt indexes retained their definitions. A read-only lookup by channel and operation ID found the saved receipt, hash, observation and Decision. The production query planner chose a collection scan in samples both before and after the drop. Measure that lookup when comparing replay options for fulfilled receipts. [Release and rollout](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/234)

Use the primary `vantage-main-server` checkout on `main`. The Sheet Sync drainer and its recovery harness are integrated. The [workspace bookmark](C:/Users/Pinda/Proyectos/vantage/SERVER-OPTIMIZATION.md) records the production revision and the [roadmap](SERVICE-OPTIMIZATION-ROADMAP.md) tracks the remaining proofs. Measure Sheet savings on natural overlapping jobs. Phase 2 collector timings are deployed at `3450ae2f`. The Phase 9 scheduled-run archive comparison is locally tested.

**Capacity handback, November 18.** Before consolidation, main, the production alias and the worker agreed on `b978f400`. The 13-slot historical mix projects 90,909 receipt chains/day. The fixed M10 three-year budget was 2.67 MB/day at 17:39 New York. Gate A is measured for Booking and Cancellation. The highest-value next comparison is verified unique Granot chain removal versus intake through the overnight and 08:00 discovery windows. A separate run-verifier candidate preserved all 4,074 historical replay results from 17 held runs in a read-only experiment. [Post-release flow, archive proof and Booking costs](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md) · [13-slot runway and scenarios](C:/Users/Pinda/Proyectos/vantage/storage-capacity-analysis-2026-11-17/DAYLIGHT-RUNWAY-2026-11-18.md)

**Server tests, November 19.** The two-pass regression review is complete. The updated assertions cover the RingCentral qualification boundary, Form Fill and Desk replay, official Booking and Cancellation writes, and recovery of uncertain Sheet Sync writes. The [roadmap entry](SERVICE-OPTIMIZATION-ROADMAP.md) records the suite counts and local qualification.

## Implementation and testing after consolidation

- **Phase 2 live proof.** The canonical alias and worker agreed on `3450ae2f` at 21:23 New York on November 18. Use the existing queue callback `timing` fields to compare complete natural ALL and Pool refresh slots by lane and matched action volume. The first candidates are 09:00 and 10:00 New York on November 19. Report 08:00 discovery separately. Gate F remains open for direct production measurement and the ALL tail. [Live measurement protocol](GRANOT-RELEASE-QUALIFICATION.md#phase-2-measurement-follow-up)
- **Phase 9 archive verifier.** The local scheduled verifier accepts a missing Decision effect `ref` when the saved replay contains explicit `null` and the remaining effect data matches exactly. The replica verified refusal cases, an interrupted upload, concurrent retry, original run restore and byte-identical replay through the existing reader. The release and natural archive qualification are separate from the collector timing release. [Historical comparison](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md#why-the-run-archive-held-evidence)
- **Production watch.** The active Codex automation **Vantage production watch** samples at 08:15 and 21:15 New York time. It owns ongoing capacity and due-date observations, including the daylight schedule, unique source removals, backlog, terminal-job expiry and per-member disk trends. Its first scheduled run is November 18 at 21:15. Keep a missing observation open against its specific live gate while implementation and isolated tests proceed.

## Capacity watch evidence

Server `62a20ea4` includes the initial slimming release `a1f395c0`. Admin `aa9cb553` and MCP `523a7cec` are deployed. The manual Granot and custom Reporting services have been retired, their 13 exclusive namespaces have been removed, and Master Leads and Master Booked passed the eight-tab cutover sample. The 18 authenticated Manager workflows passed again against the final server. The release record identifies the verified archive cohorts, operating controls and remaining qualification. [Production cutover and recovery](GRANOT-SLIMMING-RELEASE-2026-11-18.md) · [Original design and baseline](GRANOT-SLIMMING-PLAN.md)

November 19 is the first complete New York day on the released schedule. Use the bounded change-stream collector for all 13 starts and the overnight gap, record distinct source inserts and deletes by collection, and pair them with matched run summaries, holds, due age, hot BSON and per-member physical snapshots. Price the 08:00 discovery separately. Check retired namespaces after the former 00:00 and 04:00 UTC janitor windows. The dedicated Desk release owns natural slot, attribution, latency and three-day expiry qualification. [Dedicated release dates](OUTREACH-CADENCE-HANDBACK-2026-11-18.md)

At 18:07 New York the worker had 14,384 due runs. The opening seven minutes of the natural 18:00 slot added 65 ALL and 65 Pool refresh runs, plus 640 receipt chains. Thirteen older runs compacted, three went on hold and the source chain collections had zero deletes. Between 17:31:01 and 17:47:18 it compacted 31 distinct zero-action runs, recorded one hold, admitted one receipt and deleted zero source chains. In the preceding mixed deployment slot, 47 run compactions competed with 17 held runs. The deployed verifier remains authoritative. Use the read-only 17-hold comparison as the starting point for isolated concurrency, refusal and recovery tests. [Post-release flow, archive proof and Booking costs](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md)

## Storage runway requested by the Owner

At 17:39 New York the limiting member had 4.739 GB free and 2.924 GB to the 90%-used line. The 1-, 3- and 5-year budgets were 8.01, 2.67 and 1.60 MB/day at fixed capacity. The same-hour member deltas had opposing signs. Follow all three members at the same hour after 1, 3, 7, 14 and 30 days. [13-slot runway and scenarios](C:/Users/Pinda/Proyectos/vantage/storage-capacity-analysis-2026-11-17/DAYLIGHT-RUNWAY-2026-11-18.md)

The current shadow scenario gives 21.4–25.7 days at 1× and 10.7–12.9 days at 2× under stable other working sets. Keep durable official records, retention-limited data, shared filesystem use, cold objects and the one-time run backlog separate. Measure the first complete day and recalculate from matched member snapshots before adopting a fixed-capacity horizon. [13-slot runway and scenarios](C:/Users/Pinda/Proyectos/vantage/storage-capacity-analysis-2026-11-17/DAYLIGHT-RUNWAY-2026-11-18.md)

## Existing production storage work

The Owner advanced Granot producer optimization and Phase 9 archival ahead of the Booking writer. Release `69d6504d` and six verified archive manifests removed 230,062 chains (1.038 GB logical BSON). The three reference indexes are qualified. Release `615ff367` combined receipt completion with winning-Lead certification. The daylight comparison recorded new run compactions and verified production cold reads. Further removals have their own source, recovery and approval scope. [Historical manifests and index proof](GRANOT-HOT-STORAGE-2026-11-18.md) · [Post-release flow, archive proof and Booking costs](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md)

At 17:42 all 20 sampled recent certificates matched both their receipt Decision and the current Lead winner. The seven receipt-shadow failures were previously attributed to provenance-read timeouts. November 26 at 00:00 UTC is the earliest possible promotion if November 19–25 are individually clean. [Post-release flow, archive proof and Booking costs](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md)

## Phase 4 Booking and Cancellation decision

Gate A's bounded writer baseline is complete. Seven days contained 22 linked, five leadless and one Referral Booking. All 28 reached Booked Deals. The 30-day population included three Cancellations with matching Cancelled Deals appends. Current weekly mix prices at 39,311 BSON bytes/day for commands and single-job Sheet drains, or 78,622 at 2×. Existing same-key replays added zero writes. Defer writer changes until a duplicate business effect or projection can be demonstrated without changing replay, Sheet delivery or Desk behavior. [Post-release flow, archive proof and Booking costs](DAYLIGHT-CAPACITY-AND-BOOKING-2026-11-18.md)

The November 18 storage analyst brief also carries the Granot producer and Phase 9 archive proposals. Reuse its restored-data measurements. Preserve every official Booking and Cancellation, Lead qualification, both master sheets and their tabs, then Sales Outreach behavior. The earlier cleanup approvals covered their exact manifests. [Measured archive options and remaining proof](WRITE-AND-ARCHIVE-DECISIONS.md#granot--avoid-writes-at-intake-then-make-old-evidence-cheaper-to-serve)

## Phase 3 handback and outstanding clocks

The Lead intake storage release is deployed at `f28048cf7c47355b315e7fd6a6a75cf9d0e262db`. A later identical RingCentral final result now advances the timestamp on the qualified Call with one write. At 23:00 four natural polls retained zero new logical BSON bytes each. A matched prior poll on each of the same Calls retained a 1,293-byte receipt. A new WordPress Form committed its original snapshots, revision, audit and outbox. Sheet application delivery completed and its Lead Message recorded provider delivery. The release gate is closed. [Release qualification, rollback and filesystem measurements](LEAD-INTAKE-RELEASE-QUALIFICATION.md) · [Roadmap](SERVICE-OPTIMIZATION-ROADMAP.md).

At the confirmed pre-release workload the Lead intake estimate is 171,882 BSON bytes avoided per day. The November 18 all-member capacity watch has fresh measurements. Whole-day realized Lead savings and the November 18 and 23 W1 checks at 21:06:40 New York retain their own observation windows. [13-slot runway and scenarios](C:/Users/Pinda/Proyectos/vantage/storage-capacity-analysis-2026-11-17/DAYLIGHT-RUNWAY-2026-11-18.md)

Granot A–D and release E remain shipped. Its direct per-claim production benefit and slower ALL tail keep its strict F open. Preserve its per-action original-expiry guard, the Sheet S6 candidate/archive and the integrated capacity checkout. [Granot follow-up](GRANOT-RELEASE-QUALIFICATION.md).
