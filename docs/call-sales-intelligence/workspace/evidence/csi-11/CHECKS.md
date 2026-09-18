# CSI-11 verification

Executed September 17, 2026 America/New_York on `vantage-main-server`, branch `sales-intelligence`, baseline `b92e7458`. All provider metadata/content and uploads are fakes, all audio is generated synthetic WAV data. No `.env` was loaded. Final successful artifacts replace development runs; an initial audit-shape issue and the additive CSI-04 Coverage assertion were corrected before these final results.

| Check | Exact command / scope | Result |
| --- | --- | --- |
| Typecheck | `pnpm exec tsc --noEmit` | Exit 0, no diagnostics; [typecheck.txt](typecheck.txt). |
| Focused suite | Command below | 108 passed, 0 failed/skipped; [focused-tests.txt](focused-tests.txt). |
| CSI-11 transactions, workers, availability | `pnpm test:csi:media:replica` | 19 passed including outer test, 0 failed/skipped; [replica-tests.txt](replica-tests.txt). |
| Final provider adapter regression | `node --import tsx --import ./scripts/test-setup.ts --test src/services/ringcentral/recordings.test.ts` | 2 passed; [provider-adapter-tests.txt](provider-adapter-tests.txt). |
| Foundation regression | `pnpm test:csi:replica` | 15 passed; [foundation-replica.txt](foundation-replica.txt). |
| Capture regression | `pnpm test:csi:capture:replica` | 12 passed; [capture-replica.txt](capture-replica.txt). |
| Fan-out regression | `pnpm test:csi:fanout:replica` | 11 passed; [fanout-replica.txt](fanout-replica.txt). |
| Number Activity reads regression | `pnpm test:csi:reads:replica` | 10 passed; [reads-replica.txt](reads-replica.txt). Existing no-read-mutation proof retained; expected Coverage adds recording counts. |
| Directory/rebuild regression | `pnpm test:csi:numbers:replica` | 7 passed; [numbers-replica.txt](numbers-replica.txt). |
| Qualification regression | Command below | 104 passed, 0 failed, 3 pre-existing opt-in skips; [qualification-tests.txt](qualification-tests.txt). Includes 2 new recording adapter tests. |
| Independent review | Read-only separate agent; own pure run and guarded replica run | All four findings resolved, final signoff; [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md). |
| Patch hygiene | `git -c core.safecrlf=false diff --check` | Exit 0; [diff-check.txt](diff-check.txt). |

```powershell
node --import tsx --import ./scripts/test-setup.ts --test "src/validation/intelligence/*.test.ts" "src/services/salesIntelligence/foundation.test.ts" "src/services/salesIntelligence/conversations/*.test.ts" "src/routes/sales-intelligence-boundary.routes.test.ts" "src/routes/sales-intelligence-cron.routes.test.ts" "src/routes/sales-intelligence-admin.routes.test.ts" "src/middleware/requireApiSecret.test.ts" "src/models/LeadConversation.test.ts" "src/services/conversations/*.test.ts" "src/services/numberActivity/*.test.ts" "api/queues/sales-intelligence-consumer.test.ts" "src/services/ringcentral/recordings.test.ts"

node --import tsx --import ./scripts/test-setup.ts --test "src/services/ringcentral/*.test.ts" "src/routes/ringcentral-cron.routes.test.ts" "src/routes/ringcentral-webhook.routes.test.ts"
```

## Disposable database

Reused the already-running `csi01` Docker MongoDB 8.0 single-node replica, `127.0.0.1:27189`; recipe remains [CSI-02 CHECKS](../csi-02/CHECKS.md). `scripts/test-csi-media.ts` overrides inherited database/env inputs with loopback, `TEST_MODE=true`, a random `testvantagemovers_csi11*` database, synthetic secrets and test-only media flag. The test asserts that URI, DB prefix and replica name before setup, applies existing CSI indexes only there, and drops its database in `finally`. Blob writes are replaced by an in-memory pathname→synthetic-byte map; no production endpoint, queue publish, subscription, backfill or download occurs. Existing CSI runners use their own distinct disposable databases. No container or service was created or removed for this task.

## What is proven

Real Mongo transactions and indexes: recording replay and completed-job replay, account-scoped uniqueness, canonical-row resolution, pending ID then delayed Call Log discovery, pending window exhaustion without fabricated rows, durable media intent before failed wake-up, discovery rollback on conflicting media intent, one worker for concurrent claims, stale epoch unable to commit, failure callback rollback when the lease expires, caught eight-failure dead-letter and killed eighth-claim recovery. Database eligibility reads cover valid references, event windows/Attached precedence/ambiguity, exact-session scope, Owner Number Review, proposed-vs-reviewed rep evidence and non-customer classification. Pure matrix covers every accepted reason and internal/company/non-customer/unknown exclusions.

Fake provider plus real worker/Mongo: metadata before content, 404→success, 404 exhaustion, 403+24h and denied Coverage, 429 header/default timing without burning attempts, oversize rejection without upload, immutable digest/path and successful evidence preserved on replay, current Owner exclusion during download, seed media capability honesty, Coverage states/counts and whole-database no-mutation snapshot. Pure streaming tests cover byte/hash/type/signature/length validation and temp-file cleanup. Wiring tests read vercel.json, invoke cron auth/off/lease-held paths and default discovery/media recovery, assert both registered queue handlers, and enforce forbidden import boundaries. Qualification cursor and downstream transcription/analysis job counts stay zero in CSI-11 proof.

## September 18 fresh-review verification

The user requested another independent subagent review. Its two findings and resolutions are recorded in [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md). Final patch checks:

- `pnpm test:csi:media:replica`: 20 passed, including concurrent rescheduling after restored eligibility; [final-review-replica.txt](final-review-replica.txt).
- `node --import tsx --import ./scripts/test-setup.ts --test "src/services/ringcentral/*.test.ts" "src/routes/ringcentral-cron.routes.test.ts" "src/routes/ringcentral-webhook.routes.test.ts" "src/services/salesIntelligence/conversations/*.test.ts"`: 111 passed, 3 pre-existing skips; [final-review-tests.txt](final-review-tests.txt).
- `pnpm exec tsc --noEmit`: exit 0, no diagnostics; [final-review-typecheck.txt](final-review-typecheck.txt).
- Evidence Markdown file targets resolve; `git -c core.safecrlf=false diff --check` passes.

## Capability limits remain unchanged

No live RingCentral grant, provider MIME/metadata compatibility, recording retention/finalization timing, real Blob privacy/token binding/network upload, deployed cron/queue delivery or multi-node replica failover. The September 14 recording denial remains historical; Team F re-verifies at G6. The 72h wait and 90s provider budget are documented engineering policies. The 25MB limit is tested with synthetic declared/streamed lengths, not a production large-audio transfer. No CSI-12 transcription, Owner UI, CSI-05/10 producer completion or analysis integration is claimed.
