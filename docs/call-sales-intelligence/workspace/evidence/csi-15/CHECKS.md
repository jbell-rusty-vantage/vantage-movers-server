# CSI-15 checks

Synthetic-only implementation proof; not CSI-16 certification.

| Check | Result |
| --- | --- |
| `node --import tsx scripts/test-csi-backfill.ts` | PASS 14/14; final rerun 82.49s. |
| `node --import tsx scripts/test-csi15-retention.ts` | PASS 10/10, including Lead audit/sent-nudge copies and purge-during-upload deletion failure/retry; 72.3s total / 30.2s test body. |
| `node --import tsx scripts/test-csi15-budget.ts` | PASS 13/13, including the exhausted crashed eighth claim; 287.43s with delayed startup. |
| `node --import tsx scripts/test-csi15-period.ts` | PASS 4/4, 8.28s. |
| Focused backfill, budget-month, conversation and Number Activity unit tests | PASS 64/64. |
| Admin/cron route tests | PASS 7/7; includes Owner-only backfill scope/key checks. |
| Server `pnpm typecheck` | Earlier PASS. Final full-workspace rerun fails only on three TS18046 errors at `scripts/probe-intelligence-mcp-agent.ts:231`, a concurrently added external script. Preserved unchanged. Final scoped check PASS: `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p .git/csi15-tsconfig.json`. This config extends the repository config, preserves its existing exclusion, and excludes only the external probe script. Earlier scoped attempts hit host/2 GB heap exhaustion; the 4 GB retry exited 0. |
| Server focused ESLint, all changed/new source TypeScript | PASS, zero lint warnings, including the final recovery change. |
| Admin `pnpm typecheck` | PASS. |
| Admin `node --import tsx --test lib/api/salesIntelligenceCoverage.test.ts lib/api/salesIntelligence.test.ts` | PASS 13/13. |
| Admin focused ESLint (Coverage view/schema/test) | PASS. |
| `pnpm finish-work --provider cursor --model composer-2.5 --no-apply` | Snapshot checks failed (typecheck and old Number search expectation); lint and quality harness pass. Final verify FAIL on those gates; no patch applied. See REVIEW. |

Replica runners select random disposable `testvantagemovers_csi15…` databases on `mongodb://127.0.0.1:27189/?replicaSet=csi01`, verify isolation, use TEST_MODE and fake providers, and drop their own database. No `.env` files are loaded. Schema/index installation occurs only inside those disposable replicas, never through production `migration:csi:indexes`.

Backfill covers durable command replay/conflicts/day-zero/range cap; saved-page crash, partial-page replay and stale lease fencing; stored exact Coverage counts/gaps and monotonic watermark; live job/reconcile priority; Retry-After, permission pause and eight genuine failures; missing queue activation recovery and more than eight successful continuation batches; attachment settlement and later-history barriers; fulfilled callback and official Booked/Cancelled closure; source-time audit events.

Retention covers independent 90/365/730 clocks; Blob failure/expired fence; atomic rollback; recent transcript copies, prompts, submissions, findings, effects, Owner instructions and summaries; original rerun denial/Owner tombstones; more than 50 runs with a resumable pending barrier; authenticated capture and run-preparation purge races; activity tombstones and retained identity aliases; completed media job cleanup intent survives immediate and cron Blob deletion failures, then clears after successful deletion.

Budget covers real mocked agent/MCP execution, admission pause, actual Owner settings cap increase, new period activation, the same run through submission/application, one durable followup after replay, no repeated STT, missing wake-up/expired lease drain, numeric and HTTP-date Retry-After, 401/403 without attempt burn, eight transient failures, and historical priority/mode. Period helper separately checks timezone/DST boundaries, preservation of custom active periods/spend, and once-only activation.

Validation corrections: partial-page replay found a shared attachment key with different call references; the key now includes the interaction id. Search expectations now include retention tombstone exclusion. A cron test now stubs the existing Rep Identity drainer instead of accidentally contacting Mongo. Admin's pre-existing malformed generated `.next/dev/types/routes.d.ts` and `validator.ts` were backed up under `.git/csi15-generated-types-backup` and removed; `next typegen` regenerated route types and typecheck passed.

Raw final local logs: `.git/csi15-backfill-final.log`, `.git/csi15-retention-final.log`, `.git/csi15-focused-tests.log`, `.git/csi15-typecheck-final.log` (external probe errors), `.git/csi15-typecheck-scoped.log` (final PASS), `.git/csi15-lint-final.log`. They are local check artifacts, not production evidence.

No production data, live provider/STT/Gateway, send, Atlas-backed browser walk, `.env` write, flag enablement, deploy, commit or push was performed. A process diagnostic inadvertently displayed an existing connector credential; it was not used for CSI-15 and should be rotated outside this task.
