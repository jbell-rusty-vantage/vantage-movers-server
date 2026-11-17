# Phase 1 — stop false Call changes

Owner-authorized release, November 16, 2026, America/New_York. This record covers W1 only. The larger MongoDB capacity mission still needs measured sustained growth reduction and the separately reviewed later phases.

## Result and release state

Implemented: an unchanged Call move date no longer independently produces an applied business change, move provenance, EntityChange, Sheet Sync request or Daily Operations link fact. A fresh equal observation still becomes the temporal winner. First links and genuine updates retain their existing behavior.

All pre-release checks passed. Main integration and deployment evidence will be recorded below. Production savings are not yet qualified.

Baseline: fresh `origin/main` at `6aaf3bda`. Work uses an isolated `capacity-phase-one` worktree. The original `agent/site-preview-api` checkout, its uncommitted files and its preview commits were preserved. No preview commit is included in this release.

## What went wrong, and what to learn

The database already held the correct move date. The adapter that supplied a Call Lead to the planner omitted that field. The planner therefore compared the incoming date to an absent value and correctly concluded, from its incomplete input, that a change was needed. The write command trusted that plan. Although the date itself did not change, it stamped new move provenance and requested downstream work.

This is a useful distinction: a correct comparison function can still produce an incorrect business result when its input contract is incomplete. A planner test with a hand-written, complete fixture would miss the production defect. The new replica test goes through the real database adapter. A separate projection contract checks every planner field for both Lead types; its required TypeScript shape makes future additions require an explicit expectation.

The fix also checks the date again inside the command transaction. Planning and writing happen at different times. A concurrent writer can make the date equal after the plan was prepared. The command now derives date-related effects from its actual transaction snapshot, using the same finite-instant equality as the planner. It does not introduce a general change-processing framework.

There are two different meanings of “nothing changed”:

- **Business state:** the customer move date is already correct, so there is no business revision or delivery work to produce.
- **Accepted evidence:** a newer observation still establishes the newest known state. Its time and Observation ID must be recorded so an older delayed observation cannot overwrite it.

Returning early would fix unnecessary writes while breaking ordering. The command instead commits one `already_current` Decision and temporal acceptance together under the revision/temporal fence. A revision-race replan that becomes empty also uses that path. The existing ordinary no-op path now accepts a missing previous winner; its old database predicate matched only existing older tuples, despite the planner treating no winner as newer.

The executor's command status may still be `applied`, meaning that the command committed. The Synchronization Decision is `already_current` with no effects. These are different contracts; a command log is not proof that a business value changed.

## Evidence and regression boundaries

The saved pure reproduction ran against fresh main and showed `applied / [move_date]` with the omitted field, versus `already_current / []` with the complete field. Four new replica cases then failed against the baseline: the actual projection, both command-race cases, and equal-date first linking. They passed after the runtime fix.

The W1 replica cases assert the exact accepted tuple, canonical date and revision, Decision outcome/effects/count, EntityChanges, Sheet outbox and captured Daily Operations facts. They cover repeated fresh captures, same-observation replay, delayed older changed dates, a genuine newer date, date normalization across New York offsets, invalid calendar dates, concurrent acceptance, a writer making the date equal with and without a revision increment, first linking, both projection adapters, and qualified/unqualified Form/Call sibling repair. The wider lifecycle suite supplies actual operation-ID replay, receiver assignment, priority-only updates, rollback, identity and Booking/Cancellation regression proof.

Replica target: disposable Docker `mongo:8.0`, single-member `capacityp1`, loopback `127.0.0.1:27216`; isolated `testvantagemovers_capacity*` databases. The existing runner checks the database name and every replica member, scrubs provider credentials and pins dotenv to a nonexistent file. Sheet delivery/queue publication are blocked by the test bootstrap; Daily Operations assertions use its in-memory sink. No production credentials enter these tests.

The first broad replica sweep exposed obsolete test fixtures from before the RingCentral-only policy: direct Granot Call creation, incomplete qualification metadata and unfinished Call Log records. Only tests were corrected: Granot creation now proves rejection and zero partial effects; RingCentral fixtures carry the required saved qualification, Voice type and finished marker. Runtime admission policy was not weakened.

Final pre-release checks:

| Check | Result |
| --- | --- |
| Full offline suite, same globs/bootstrap as `pnpm test`, concurrency limited to 2 | 3,830 passed, 172 gated tests skipped, zero failures (4,002 discovered) |
| `pnpm test:granot-lifecycle:replica` against disposable loopback replica | 150 passed across both stages; zero skipped/failures |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, zero warnings |
| `pnpm quality:test` | 33 passed, zero skipped/failures |
| Exact staged diff / whitespace check | Passed; no preview commits or unrelated files |

[Validation evidence](evidence/phase-one-validation.json) records commands, result summaries and SHA-256 hashes of retained local logs. The offline suite's gated database tests do not substitute for the separately executed replica suite. Release SHA and deployment evidence are recorded in the deployment section after the pipeline completes.

## Production measurement

Read-only baseline, November 16 **7–8 p.m. New York** (`00:00–01:00 UTC` November 17): 506 Call synchronization EntityChanges, all 506 provenance-only; 506 applied Call Decisions requesting Sheets; 506 new Call update jobs, all synced; 6,846 recent receipts, all completed. Daily Operations had 509 link and 509 Sheet-completed facts across all Lead kinds. Counts correlate but are not a causal one-to-one savings proof. [Aggregate evidence](evidence/phase-one-production-before.json).

`ops/granot-frequency/observe-equal-date.ts` is an aggregate-only read tool. Supply explicit start/end instants, at most two hours apart. It uses the native driver, one connection, indexed ObjectId windows and 15-second query limits; it imports no application models and performs no writes. It reports new-row counts, not all coalesced queue updates, disk reclamation or billing savings. Its latest-20 accepted Call sample checks equal dates, empty effects and the exact current winner without exporting customer payloads or IDs.

The Atlas connector required reauthentication. The baseline was obtained through the local operator environment in a separate read-only process. Production cron/apply endpoints were not invoked to manufacture evidence.

## Compatibility and rollback

No environment flag, persisted configuration, schema, production index, retention, cadence or credential change. No history rewrite, deletion or compaction. Existing Decisions and EntityChanges remain immutable; official Booking/Cancellation reporting and saved Call admission evidence stay intact.

Rollback is a normal revert of the runtime release followed by the existing main deployment pipeline. Keep all acceptance/history already committed. A revert restores the old false-change behavior; it cannot and should not erase evidence recorded while the fix was active.

## Next session

First qualify W1 across a complete daytime slot and overnight slot, then the next business day, 48-hour and seven-day checkpoints. Compare provenance-only Call changes and downstream nominations with the recorded baseline, verify real changes still propagate, and measure growth separately. A quiet partial window is insufficient qualification.

The next code release is **W2 Release A**, per [ACTION-PLAN.md](ACTION-PLAN.md): avoid duplicate Outreach evaluation only when subject synchronization already durably requested it, preserving unchanged-subject repair. Durable coalescing, Sheet machinery, retention promotion/deletion, index changes and compaction remain separate releases. Do not apply the older blanket cleanup proposals.
