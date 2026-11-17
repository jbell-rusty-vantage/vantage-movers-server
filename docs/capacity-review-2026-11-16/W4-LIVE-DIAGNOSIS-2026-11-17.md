# W4 live failure diagnosis — November 17, 2026

The retention lane still needs a measured query/access-path repair before it can qualify clean shadow days. The W0/W5 application release does not change this worker and must not be credited with fixing these failures.

## Live evidence

A read-only Vercel log query targeted the verified current production deployment `dpl_55kau2rKsicyWmnBx6Quyb2R7JgP`, project `prj_K1he4MhLkTAbudfQ3EsZzMTOdcvM`, scope `vantage-4d3db9ef`, runtime `3327b31ce7b5a2f001e74febb0b2d3be79e47543`. Query: retention route, HTTP 500, preceding 24 hours, maximum 20 requests; a second maximum-five extraction retained only allowlisted diagnostic tokens and timestamps.

Five requests returned `MongoServerError` and the exact diagnostic phrase `operation exceeded time limit`. They occurred on November 17 at 00:04:33, 02:16:33, 08:26:33, 08:28:33 and 09:20:33 New York (UTC timestamps are in the evidence). No retained token matched the explicit Pool-mismatch error. This is direct timeout evidence, but not proof of which query timed out or that no other failure mode exists. The seven failures observed in the current daily database counter are not fully reconciled by these five request logs.

Evidence: [sanitized request tokens](evidence/retention-failure-log-tokens-2026-11-17.json). Raw log messages, customer data, request IDs and headers were neither emitted nor saved. No production worker was invoked.

The deployed `futureRetention.ts` increments failures (and only the exact Pool mismatch increments mismatches), rethrows, then releases its owner lease. Its cron passes the error to the normal Express handler. The deployed daily document does not retain error code/stage, so counter-only inspection cannot identify a cause. Several selection, chain and reference queries have 3,000 ms bounds; the timeout message alone cannot select one of them.

## Existing local W4 work and remaining gate

The original integrated capacity checkout, excluded from the W0/W5 release, contains fixed-enum diagnostics for qualification/selection/references/closure/archive/transaction/Pool with code50 classified as `query_timeout`, owner/mode/cutoff/expiry lease fences, bounded source reads and opt-in maintenance budgets. These changes make failures explainable and certification safer; they do not by themselves prove that the live timeout's access path is repaired. The code retains reference checks and immutable cutoffs. Increasing timeouts or enabling more pages is not an adequate fix.

Its disposable-replica reference rehearsal tested 64 chains against 4,006 EntityChanges: the original OR shape examined 4,006 documents; three sparse provenance indexes reduced that to six documents/nine keys while preserving six protected holders, including ObjectId and legacy-string values. These are synthetic measurements, not current production plan/timing evidence.

Candidate definitions for independent review are sparse single-field indexes on `entity_changes.provenance.observation_id`, `entity_changes.provenance.decision_id`, and `entity_changes.provenance.receipt_id`, with proposed explicit names `entity_change_granot_observation_ref_v1`, `entity_change_granot_decision_ref_v1`, and `entity_change_granot_receipt_ref_v1`. All OR branches must have an efficient plan; do not install just one and assume the full OR is repaired. Existing equivalent definitions, current plans, index cost and actual timed-out stage must be checked first. No index installation is included or authorized by this diagnosis.

Next proof: correlate sanitized stage/stack or provider query evidence; obtain bounded representative `explain` on the implicated query and inspect existing indexes; compare protected-holder results in replica; independently review a narrow diagnostic/query repair; then seek specific production-index approval if needed. After separately qualified deployment, observe successful mature pages, unchanged reference/Pool/archive/replay semantics and clean required days before any promotion or throughput increase. Archive restore, load/backpressure and all retention/TTL/deletion approvals remain separate.

## Application build gate

The coordinator reported 91 annotations in the prior production build. An unchanged count is insufficient: compare normalized diagnostic identities (source file, diagnostic code and message) with the known deployed baseline, rather than merely totals. New diagnostics, especially in changed runtime files, must be resolved before deployment. An identical inherited diagnostic multiset plus passing standalone typecheck/tests, successful build and the existing built-Granot-retention artifact verifier can qualify this limited canary; it does not certify W4 behavior. This reviewer has not independently compared those annotation identities and does not claim that gate passed.

The latest matching request's sanitized stack contains `Connection.sendCommand` in MongoDB driver `connection.js:320:27`, plus HTTP logger frames; no application retention query stage was established. [Sanitized stack extraction](evidence/retention-failure-stack-2026-11-17.json). Numeric code extraction was deliberately discarded because a prefix could match HTTP 500; MongoDB code50 is not claimed from that log. The supported conclusion remains a Mongo server operation timeout, not a proved EntityChange query diagnosis.
