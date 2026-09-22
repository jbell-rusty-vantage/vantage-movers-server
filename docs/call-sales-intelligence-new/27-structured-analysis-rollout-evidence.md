# Structured analysis rollout — September 22, 2026

Scope: the summary/context/findings slice described in [26-structured-analysis-steps.md](26-structured-analysis-steps.md). No Vercel Workflows or Redis migration was introduced.

## Deployment

The Owner explicitly approved production deployment and the manual backfill. Implementation commits `a667ff4`, `14c035f`, `5bfaed8` and `b4b7aa9` were pushed to `fix/csi-structured-analysis`. Production runs `b4b7aa9`, including the per-lease reservation uniqueness fix, manual peer-lease observation and strict-provider schema compatibility.

Deployments were built from an isolated clean checkout, staged for production, checked for readiness and health, then promoted to `https://vantage-movers-main-server.vercel.app`. The first deployment was `dpl_6tcBAEvU9vjSuZDujcWuh9i7w7zG`; the final compatibility deployment is `dpl_4MryL5ZB7Qu7RMqvaRJBoKUjuzyG`. An authenticated production Owner API smoke check returned HTTP 200 for the structured analysis run, evidence inventory, summary artifact and context artifact. Both artifacts were available and complete.

The additive canonical-summary unique index migration was applied successfully. Existing application authority, Owner precedence and evidence checks remain in force.

## Verification

Typecheck and full lint passed. The offline suite passed 2,528 tests with 114 skips and no failures. All 14 disposable-Mongo real-worker tests passed, including retry recovery, persisted-summary reuse, shadow application fencing and normal application. The disposable replica was shut down afterward.

The required quality checkpoint's separate unconstrained test run hit an unrelated request-telemetry child-process timeout; that test passed on an isolated rerun. The checkpoint's proposed repair-count and hard-spend caps were not applied because they contradict the accepted specification. Production reached Ready despite nonfatal builder type-inference warnings; the repository's strict local typecheck passed.

## Backfill procedure

The shadow cohort pins the cutoff `2026-09-22T16:44:02.216Z` and 382 retained current summaries. Both shadow and application passes use the normal Owner reanalysis command and workers at concurrency four; concurrency two was briefly tried while diagnosing Gateway failures. Resumable manifests contain identifiers and outcomes, never source text, and remain local and uncommitted.

The shadow canary submitted successfully with application disabled and 2¢ recorded usage. All 382 full-cohort shadow runs subsequently submitted and verified the application-disabled fence. Two transient provider attempts recovered on the normal durable retry path; their unknown provider usage remains explicitly incomplete. The full shadow manifest records 800¢ of observed usage, not an exact final provider bill.

The application canary completed with one finding applied, two blocked by existing checks and one routed for review, with complete recorded usage of 2¢. The remaining 381 entries completed application, with zero outstanding failures. The final 81 entries finished without another provider error after the schema compatibility fix.

Independent database verification at `2026-09-22T20:02:37.795Z` confirmed the following for the complete pinned cohort, including the canary:

| Check | Result |
| --- | ---: |
| Retained conversations | 382 |
| Completed structured runs with application enabled | 382 |
| Completed application jobs | 382 |
| Conversations pointing to the expected new completed run | 382 |
| Invalid runs, invalid jobs or mismatched latest-run pointers | 0 |
| Findings applied | 347 |
| Findings blocked by existing checks | 353 |
| Findings routed for review | 473 |
| Observed application-pass usage | 430¢ |
| Application runs with incomplete provider usage | 6 |

Finding counts are not conversation counts; a conversation can produce several outcomes. Blocked/review findings are normal application results, not failed backfill jobs. The six application runs with uncertain provider usage recovered and completed; uncertainty was retained rather than presenting unknown usage as zero. Including the full shadow pass and its separate canary, recorded model usage is 1,232¢, with eight runs retaining incomplete accounting. This is observed usage, not a reconciled provider invoice.

Live processing exposed two operational issues. Production sometimes claimed a job before the manual runner; commit `5bfaed8` makes the runner observe a live peer lease before checking its final state. Its five focused tests and typecheck passed.

Later Gateway routes intermittently returned HTTP 400 with `Invalid schema for response_format 'response': In context=('properties', 'findings', 'items'), 'oneOf' is not permitted.` Commit `b4b7aa9` normalizes provably disjoint literal-tagged unions to equivalent `anyOf` only for provider transport. It retains the original validator and logical contract hashes, including cached summaries and replay authority. Three adapter tests, eight contract tests, all 14 real-worker checks, strict typecheck and lint passed. The worker mock now rejects `oneOf` in actual outgoing response schemas.

The final production deployment also passed the authenticated Owner run/evidence smoke check: all four reads returned HTTP 200 and both artifacts were complete. No Vercel Workflows infrastructure or orchestration migration was included.
