# Phase 1 — stop false Call changes

Owner-authorized release, November 16, 2026, America/New_York. This record covers W1 only. The larger MongoDB capacity mission still needs measured sustained growth reduction and the separately reviewed later phases.

## Result and release state

Implemented: an unchanged Call move date no longer independently produces an applied business change, move provenance, EntityChange, Sheet Sync request or Daily Operations link fact. A fresh equal observation still becomes the temporal winner. First links and genuine updates retain their existing behavior.

**Implemented, tested, integrated into main, pushed and deployed.** Runtime release: `3327b31ce7b5a2f001e74febb0b2d3be79e47543`. Production alias and database worker both attest the new deployment; application and database health pass. Phase 1 code release is complete. Live behavior across a representative processing slot and sustained capacity savings are not yet qualified.

Baseline: fresh `origin/main` at `6aaf3bda`. Work uses an isolated `capacity-phase-one` worktree. The original `agent/site-preview-api` checkout, its uncommitted files and its preview commits were preserved. No preview commit is included in this release.

## Owner handoff invariant — automatic Call Lead creation

**Ordinary automatic application processing may create a new Call Lead only through the RingCentral inbound queue qualification pipeline. Qualification and admission come first; subsequent automatic updates and Sheet Sync operate on the already-admitted Call Lead.** A Granot observation, matching phone/contact, Form sibling, job number, Booking, enrichment result or Sheet row must never create a missing Call Lead or substitute for RingCentral qualification. Later capacity phases must preserve this boundary.

The Owner refers to this as the RingCentral qualification cron path. Precisely, the current implementation has two RingCentral entry points: the scheduled Call Log scan and webhook-triggered final Call Log verification. Both must pass `vetRingCentralCallLogRecord` and `qualifiedCallFromCallLog` before the same `ingestRingCentralQualifiedCall` admission gate. A webhook preview alone cannot authorize creation. This is one shared qualification policy, not a separate unqualified creation path. See [RingCentral Call Lead Qualification](../knowledge/services/ringcentral-call-lead-qualification.md).

**Scope of this clarification is automatic processing.** Manual/operator creation and the create-Call API surface are outside this statement; it neither changes nor certifies their availability. Phase 1 does not enable, remove or redesign those surfaces. Its regression tests prove Granot Call creation is refused without partial effects and that qualified existing Calls retain their update/Sheet behavior.

Preserve previously accepted RingCentral evidence and the documented, closed Best Relocation historical/final-import admissions. Those existing records remain eligible under their saved admission rules; they are not permission for another automatic import, new Call creation bypass or fabricated RingCentral evidence. See [Call Lead admission and billing contract](../call-lead-billing.md).

## What went wrong, and what to learn

The database already held the correct move date. The adapter that supplied a Call Lead to the planner omitted that field. The planner therefore compared the incoming date to an absent value and correctly concluded, from its incomplete input, that a change was needed. The write command trusted that plan. Although the date itself did not change, it stamped new move provenance and requested downstream work.

This is a useful distinction: a correct comparison function can still produce an incorrect business result when its input contract is incomplete. A planner test with a hand-written, complete fixture would miss the production defect. The new replica test goes through the real database adapter. A separate projection contract checks every planner field for both Lead types; its required TypeScript shape makes future additions require an explicit expectation.

The fix also checks the date again inside the command transaction. Planning and writing happen at different times. A concurrent writer can make the date equal after the plan was prepared. The command now derives date-related effects from its actual transaction snapshot, using the same finite-instant equality as the planner. It does not introduce a general change-processing framework.

There are two different meanings of “nothing changed”:

- **Business state:** the customer move date is already correct, so there is no business revision or delivery work to produce.
- **Accepted evidence:** a newer observation still establishes the newest known state. Its time and Observation ID must be recorded so an older delayed observation cannot overwrite it.

Returning early would fix unnecessary writes while breaking ordering. The command instead commits one `already_current` Decision and temporal acceptance together under the revision/temporal fence. A revision-race replan that becomes empty also uses that path. The existing ordinary no-op path now accepts a missing previous winner; its old database predicate matched only existing older tuples, despite the planner treating no winner as newer.

For example, the Lead already says “move November 20.” A 10:00 observation agrees, so no Sheet update is needed, but 10:00 must become the accepted evidence time. If a delayed 09:30 observation says “November 21,” it must lose. Suppressing every write for the 10:00 observation would let the older value win if the last accepted evidence were still 09:00. Idempotency and freshness solve different problems: replay must not duplicate effects, while fresh identical evidence must still fence older evidence.

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

[Validation evidence](evidence/phase-one-validation.json) records commands, result summaries and SHA-256 hashes of retained local logs. The offline suite's gated database tests do not substitute for the separately executed replica suite. CI repeated the full `pnpm test` command on Linux with the same 3,830 passed / 172 skipped / zero failed result.

## Deployment verification

Main was fast-forwarded from the verified baseline and pushed normally. [Production pipeline 43999490293](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/43999490293) succeeded for `3327b31c`, including typecheck, tests, production build, packaged Granot retention verification and deployment. The deploy step completed **November 16 at 9:06:40 p.m. New York** (`2026-11-17T02:06:40Z`). [Pipeline evidence](evidence/phase-one-deployment.json).

Vercel deployment `dpl_55kau2rKsicyWmnBx6Quyb2R7JgP` is READY in production. The pipeline's URL matches the target of `vantage-movers-main-server.vercel.app`: [deployed build](https://vantage-movers-main-server-54tyi4hb9-vantage-4d3db9ef.vercel.app). Application health returned HTTP 200; database health returned HTTP 200, `ok: true`, `readyState: 1`, database `vantagemovers`. At **9:08 p.m. New York**, the natural worker recorded the same release SHA and deployment ID. No cron endpoint was invoked for verification. [Verification evidence](evidence/phase-one-production-verification.json).

The Vercel build emitted **91 distinct error annotations**, despite successful standalone typecheck and a successful build. Every annotation exactly matches the prior successful baseline deployment; none was added by this release. This is an inherited build-tooling limitation, not a clean diagnostic result or a newly bypassed check. Its separate repair remains outside W1. [Exact comparison](evidence/phase-one-build-annotations.json).

Final documentation and observation evidence are saved in a subsequent documentation-only main commit with `[skip ci]`; that commit does not replace the deployed runtime revision above. The isolated replica container was stopped after validation. The original preview checkout and its uncommitted work remain preserved.

## Production measurement

Read-only baseline, November 16 **7–8 p.m. New York** (`00:00–01:00 UTC` November 17): 506 Call synchronization EntityChanges, all 506 provenance-only; 506 applied Call Decisions requesting Sheets; 506 new Call update jobs, all synced; 6,846 recent receipts, all completed. Daily Operations had 509 link and 509 Sheet-completed facts across all Lead kinds. Counts correlate but are not a causal one-to-one savings proof. [Aggregate evidence](evidence/phase-one-production-before.json).

`ops/granot-frequency/observe-equal-date.ts` is an aggregate-only read tool. Supply explicit start/end instants, at most two hours apart. It uses the native driver, one connection, indexed ObjectId windows and 15-second query limits; it imports no application models and performs no writes. It reports new-row counts, not all coalesced queue updates, disk reclamation or billing savings. Its latest-20 accepted Call sample checks equal dates, empty effects and the exact current winner without exporting customer payloads or IDs.

The Atlas connector required reauthentication. The baseline was obtained through the local operator environment in a separate read-only process. Production cron/apply endpoints were not invoked to manufacture evidence.

Read-only post-release sample: **9:07:00–9:08:07 p.m. New York**, after deployment and before the next collector slot. There were no new Granot receipts, Call Decisions, Call EntityChanges, Call Sheet jobs or selected Daily Operations facts in that window. The database stamp confirmed the new runtime. With no qualifying activity, this sample proves neither the equal-date behavior in production nor a savings rate. [Post-release aggregate evidence](evidence/phase-one-production-after.json). The isolated replica proves behavior; a complete natural slot is the next production proof owed.

## Compatibility and rollback

No environment flag, persisted configuration, schema, production index, retention, cadence or credential change. No history rewrite, deletion or compaction. Existing Decisions and EntityChanges remain immutable; official Booking/Cancellation reporting and saved Call admission evidence stay intact.

Rollback is a normal revert of the runtime release followed by the existing main deployment pipeline. Keep all acceptance/history already committed. A revert restores the old false-change behavior; it cannot and should not erase evidence recorded while the fix was active.

## Next session

Carry the automatic Call Lead creation invariant above into every subsequent phase. Optimize updates and Sheet Sync only after admission; never recreate a missing Call as a repair or optimization shortcut.

First qualify W1 across a complete daytime slot and overnight slot, then the next business day, 48-hour and seven-day checkpoints. For this evening release, the next nominal collector slot is November 16 at 22:00 New York; the first daytime slot is November 17 at 08:00. Observe after each finishes processing, not merely after its scheduled start. Review next-business-day evidence November 17, 48-hour evidence November 18 evening and seven-day evidence November 23 evening. These are outstanding observation checkpoints, not newly created automations. Compare provenance-only Call changes and downstream nominations with the recorded baseline, verify real changes still propagate, and measure growth separately. A quiet partial window is insufficient qualification.

The next code release is **W2 Release A**, per [ACTION-PLAN.md](ACTION-PLAN.md): avoid duplicate Outreach evaluation only when subject synchronization already durably requested it, preserving unchanged-subject repair. Durable coalescing, Sheet machinery, retention promotion/deletion, index changes and compaction remain separate releases. Do not apply the older blanket cleanup proposals.
