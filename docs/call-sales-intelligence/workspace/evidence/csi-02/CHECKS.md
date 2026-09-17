# CSI-02 verification

Executed September 17, 2026 on the uncommitted `sales-intelligence` patch over baseline `dc70b43`. Provider pages and webhook payloads are synthetic; nothing below is a live RingCentral capability proof.

| Check | Command / scope | Result / artifact |
| --- | --- | --- |
| Server typecheck | `pnpm exec tsc --noEmit` | Exit 0; [typecheck.txt](typecheck.txt). |
| CSI-02 pure tests | `node --import tsx --import ./scripts/test-setup.ts --test "src/services/numberActivity/*.test.ts"` | 22/22 (part of the focused run below). |
| Focused server suite (CSI-01 + CSI-02) | Command below | 65/65, 0 skipped; [focused-server-tests.txt](focused-server-tests.txt). |
| CSI-02 replica proof | `pnpm test:csi:capture:replica` | 12/12 including outer test, 0 skipped; [csi02-replica-tests.txt](csi02-replica-tests.txt). |
| CSI-01 replica regression | `pnpm test:csi:replica` | 15/15 after the two additive schema edits; [csi01-replica-regression.txt](csi01-replica-regression.txt). |
| Unchanged qualification suites | `node --import tsx --import ./scripts/test-setup.ts --test "src/services/ringcentral/*.test.ts" "src/routes/ringcentral-cron.routes.test.ts" "src/routes/ringcentral-webhook.routes.test.ts"` | 93 pass, 0 fail, 3 skipped (pre-existing opt-in `GRANOT_LIFECYCLE_REPLICA_TESTS` proofs, unrelated to this change); [qualification-suites.txt](qualification-suites.txt). |
| Patch hygiene | `git diff --check` | See HANDOFF. |

```powershell
node --import tsx --import ./scripts/test-setup.ts --test "src/validation/intelligence/*.test.ts" "src/services/salesIntelligence/foundation.test.ts" "src/routes/sales-intelligence-boundary.routes.test.ts" "src/middleware/requireApiSecret.test.ts" "src/models/LeadConversation.test.ts" "src/services/conversations/*.test.ts" "src/services/numberActivity/*.test.ts"
```

## Replica environment

The CSI-01 disposable replica (`csi01`, loopback 27189) was not running at claim time and no local `mongod` binary existed. A disposable Docker container was started for this work only: `docker run -d --name csi01 -p 127.0.0.1:27189:27189 mongo:8.0 mongod --replSet csi01 --port 27189 --bind_ip_all`, then `rs.initiate({_id:'csi01', members:[{_id:0, host:'127.0.0.1:27189'}]})`. The runner `scripts/test-csi-capture.ts` refuses any other host, ignores `.env`, and selects a fresh `testvantagemovers_csi02<random>` database per run. No production database, provider, queue, subscription or messaging action occurred. The container can be removed with `docker rm -f csi01`.

## What the database proofs cover

Atomic persistence of interaction + aliases + Contact Number rollups + `interaction` audit + pending jobs, and rollback of all of them when `enqueueCsiJob` fails; semantic replay as a no-op (no revision, audit or job); three concurrent identical deliveries yielding one interaction/alias set; concurrent distinct sessions on one number producing exact rollups under revision CAS; Call Log authority over later webhook terminal events; per-recording discovery jobs including a delayed second recording after terminal, deduped on replay; account-scoped identity (same session id under another account is a distinct row); no merge for two sessions on one number a minute apart; merge only with same-session provider proof (canonical = earlier row, tombstone `merged_into_id`, alias re-point, rollup decrement, `interaction.merged` audit, resolution through the tombstoned alias); internal/withheld/malformed observations creating no Contact Number or `outreach_ensure` job; reconcile cursor and `known_complete_through` advancing only on full success; page failure keeping the cursor while projecting fetched records and opening a gap that a later complete run closes; 429 ending the run with `throttled_count` and no gap repair; page limit recording `incomplete_before`; two concurrent workers electing one lease holder; an expired-lease worker unable to write cursor/state after a successor; unresolved or mismatched provider account failing closed; the qualified-call cursor collection never written.

## What is not proven here

Live RingCentral webhook delivery shapes beyond the fields read, Detailed Call Log pagination behavior on the real account, `Retry-After` header values (the shared client does not surface headers), production subscriptions, cron/queue registration, downstream consumers (`outreach_ensure`, `attachment_refresh`, `recording_discovery` handlers), directory snapshots (CSI-10), multi-node replica failover.
