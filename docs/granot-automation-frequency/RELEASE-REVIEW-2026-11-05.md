# Granot cadence release review — November 5, 2026

The Owner authorized review, fixes, commit and push to main. **Released to production as `6ed1aef62ce01a4f1b160152a15451604c81d4c6`.** The goal is timely Desk state and accurate cadence progress without multiplying unchanged Sheet writes. Sustained capacity qualification remains separate from the completed rollout.

## Released and verified

- [Production workflow 42055454582](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/42055454582) succeeded: clean-checkout typecheck; full suite **3,830 passed, zero failed, 164 skipped** (3,994 tests); production build and deployment.
- Vercel deployment `dpl_CDTGNswpbhYtvLtfGpUKGDFmENEj` became READY at **15:39:06 UTC / 10:39:06 New York**. Its metadata matches the integration SHA and aliases include [the production API](https://vantage-movers-main-server.vercel.app).
- At 15:40 UTC the runtime `sales_intelligence_sync_state` deployment stamp independently reported the same SHA. Aggregate-only post-release reads found **zero pending/retrying/processing/failed Sheet jobs**. The retained Desk/RC job queue had only 11 recent pending `call_log_refresh` jobs and no leased/retry/paused/dead-letter backlog.
- No new Granot Decisions were present in the first minute after release. This is deployment/backlog proof, not a post-release automation-slot or no-op sample. The production no-op baseline and real processor replica tests below establish the reviewed behavior; the next new daytime slot and overnight/06:00 boundaries still need observation.
- Audit queries are sequential, not a cross-collection transactional snapshot. The read-only utility explicitly includes each queue's own status vocabulary. Its final follow-up and documentation do not alter the deployed runtime.

## Write-path review

- Same scheduled slot/child has deterministic identity and insert-only timestamps. Each approved action captures a receipt using `run_id:action_id`; pending actions resume that receipt. Replaying the same observation/attempt returns its existing Decision.
- A **fresh** equal-valued observation advances temporal acceptance so an older snapshot cannot overwrite newer knowledge. It retains receipt/Observation/Decision evidence but creates no Lead business revision, EntityChange or Sheet job. It is not a zero-Mongo-write operation.
- Existing open Desk subjects receive receipt-keyed refresh jobs, including `already_current`, so current time, evidence and policy can be re-evaluated. Subject field comparisons and evaluator fingerprints suppress unchanged projections; unchanged cadence does not restart a period or count another contact. Receipt jobs are deduplicated on replay, not across different collection times. This recovery work intentionally remains.
- Form/Call mirror skips an unchanged pair before the command. A changed marker durably wakes the existing open Form subject; it cannot reopen a closed subject or admit a missing one. Changed Call Job/receiver values refresh previously delivered canonical destinations; Priority alone does not.
- **Additional fix in this review:** the main lifecycle writer also suppresses Sheet Sync for a change consisting solely of `granot_priority`. Neither Form nor Call row projection or routing exports that field. Lead revision, Decision and Desk feed remain intact. Other companion changes (including Form Quoted, receiver and move fields) keep their existing reporting path. This is a conservative suppression, not a general projection-hash cache.
- Sheet outbox uses `source_lead:model:id` coalescing for pending/retrying jobs. Processing jobs remain isolated so a concurrent change is not lost. The drainer reloads current Mongo, batches by destination and merges identical physical writes. Mongo ID identifies rows; uncertain Google structural responses are reconciled on the next drain. This provides recoverable idempotency, not exactly-once network delivery.

## Production baseline (aggregate-only read, 15:25 UTC)

Trailing 24 hours, all lifecycle channels: **18,604 already-current Decisions, zero sheet requests**; 2,321 stale Decisions also requested zero sheets. There were 2,005 applied Decisions, all requesting sheets in the prior writer. This confirms existing no-op suppression in production before this release. The audit does not claim these counts are exclusively automation.

459 Estimates runs were completed in that window. Thus the packet's 234/day arithmetic is only the 90-date ALL minimum; older-date and Pool coverage materially increase actual work. Do not use that minimum as a production forecast.

Collection averages were about 1,974 bytes/receipt, 1,083/Observation and 1,249/Decision, before indexes: roughly **4.3 KB of logical evidence per newly captured action**, excluding run plans and Desk work. Decisions alone held 591,972,743 logical bytes and 50,196,480 index bytes. These are current sizes, not measured growth rates or disk projections. No evidence was deleted or retention weakened.

## Validation and release limits

- Targeted suite: 1,530 passed, 121 opt-in skips, zero failures (1,651 tests).
- Collector/lifecycle disposable replica: 17 passed, zero skips/failures; includes real no-op and Priority-only no-Sheet assertions.
- Joined pair/outbox/Desk replica passed, including replay counts, exclusive destination planning, transaction rollback and held-Form recovery.
- Lint passed. Tracked-source typecheck excludes existing ignored `ops/output/**`; ordinary typecheck still encounters the five pre-existing ignored audit-script diagnostics described in the implementation ledger. No compiler configuration was changed to hide tracked source errors.
- GitHub production workflow must independently pass its typecheck/test/build/deploy gates. Integration and deployment identity are recorded after push.

No new configuration, index, collection or migration is needed. Existing effect gates remain. Rollback is schedule admission back to 08/13/18 New York while retaining compatible consumers/readers and durable evidence (see RELEASE-HANDOFF.md).

**Still required for capacity qualification:** representative daytime, overnight and 06:00 overlap coverage, retained byte growth across time, lease contention, write latency and pending ages with headroom. Higher cadence does not mean six times the Sheet writes, but fresh evidence/refresh work does grow. A post-release snapshot cannot certify sustained storage safety.

Re-run aggregate-only evidence with `node --env-file=.env --import tsx ops/granot-frequency/read-only-audit.ts [since-ISO]`. It uses the native driver, no application models/hooks, prints counts/timings/sizes only and performs no mutations.
