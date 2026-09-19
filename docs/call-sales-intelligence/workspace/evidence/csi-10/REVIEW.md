# CSI-10 quality checkpoint

Required command: `pnpm finish-work --provider codex --no-apply`.

Run `1789766173173-f7635836`, input HEAD `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, fingerprint `eb457ddb8dc7e56e623c91a8931497a511b291fda8a554d8586028b6e6d3a03c`. The checkpoint uses an isolated snapshot and an older persisted quality baseline; its inventory consequently includes earlier committed CSI-05/06/12 files. This is not this task's changed-file inventory. CSI-10's files are recorded in [FILES.md](FILES.md).

The checkpoint finished with **stale** status (CLI exit 1 because source changed), while its isolated final review returned **QUALITY_RESULT: PASS**. Snapshot typecheck/lint passed; snapshot offline suite 2399 passed / 114 skipped / 0 failed; quality-runner tests 12/12 passed. [Final review](checkpoint-final-review.md), [input report](checkpoint-report.json), [initial findings](checkpoint-initial-review.md), [isolated cleanup](checkpoint-cleanup.md).

Its initial review reports two pre-existing findings outside CSI-10: browser CORS allowance for Idempotency-Key in `src/app.ts`, and Contact Number revision advancement on repeated speech restriction evidence in CSI-06. The isolated cleanup changed those files, but no checkpoint patch has been applied to this checkout. CSI Owner traffic is defined through the signed server BFF; no Admin transport or restriction-engine rewrite is part of this identity-only task. These broader findings remain recorded for their owners rather than being represented as CSI-10 changes.

Current-source verification is separately recorded in [CHECKS.md](CHECKS.md). Later stored-proposal GET handling, DTO envelope/evidence and expanded acceptance tests are not silently represented as part of the original checkpoint input. No independent final approval of those later current-source changes is claimed. Current typecheck/lint, focused 19/19 and identity replica 12/12 passed directly; the full current-source offline run passed 2398/114 skipped before the final focused read refinements. No unrelated checkpoint patch was applied.

CSI-06's older failed checkpoint remains historical evidence only. Its later direct source checks passed; that handoff was not independent final approval for CSI-06 or CSI-10.
