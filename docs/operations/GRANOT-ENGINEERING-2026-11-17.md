# Phase 2 Granot collector and lifecycle qualification

The bounded Phase 2 slice is locally qualified. Projecting the worker claim reduced returned BSON, the expiry regression stopped a post-deadline dispatch, and a real worker recovered the canonical result without repeating the Lead change. Granot release and live qualification remain open. Phase 3 is queued.

## Scope and source

This local candidate belongs to `optimization/granot-phase-two-2026-11-17` in `C:/Users/Pinda/.codex/worktrees/granot-phase-two/vantage-main-server`. Its base and verified remote main at intake were `868db09443681753390c25d0e6cec2160a130795` in `jbell-rusty-vantage/vantage-movers-server`. The base differs from the serving application in committed documentation only.

The operator CLI and guarded setup are shared local prerequisites copied from the preserved [Sheet handback](SHEET-ENGINEERING-2026-11-17.md). The Granot checkout uses the base's Sheet runtime. The original Sheet S6 release manifest and the separate capacity checkout remain the authorities for those candidates. Select Granot files from the [local source inventory](evidence/granot-source-2026-11-17.json) for any future release review. The checkout contains earlier program documentation and tooling for local integration.

All 57 files in the S6 manifest matched on intake. At 3:56 p.m. New York, a separate quality worker (run `1794948368688-fcff51ee`) applied a lease-release change in `src/services/sheetSync/drainer/runSheetSyncDrain.ts` and the matching `ops/sheet-sync-recovery/replica.ts` case in the original Sheet checkout. Their bytes now differ from its existing manifest. The exact original contents of both files were recovered from the pre-edit Git objects and independently matched to their raw SHA-256 values. The other 55 entries matched directly. All 57 original files plus the original manifest were archived and read back with every hash verified. Archive path `C:/Users/Pinda/.codex/worktrees/granot-phase-two/sheet-s6-intake-2026-11-17.zip`, SHA-256 `7d0803f7326968fa84d49a347ad2501fb3bb8596980ea9e5dac56bc782091a1f`. Use the archive as an overlay on `868db094` in a separate checkout for the original S6 review. Reconcile the quality-worker changes separately before treating the current Sheet directory as release evidence. The final content inventory of the capacity checkout matched its earlier 283-path inventory.

## Measured improvement and traced run

Every successful scheduler claim previously returned the full run, including any sealed plan, approval and embedded results. Its caller consumed only the ID and status. The candidate projects those two fields from the same atomic claim. Planning and apply continue to load and validate their own full inputs. In the three one-row plans, each planning claim fell from 868 to 41 returned BSON bytes. Approved claims fell from 3,747–3,792 bytes to 43. No commands, submitted mutation BSON or retained records were removed. The independent candidate repeat matched every measured stage. [Per-stage cost table and methods](evidence/granot-stage-measurement.md)

| Workload | Mongo commands before and after | Returned document BSON before | Returned document BSON after | Retained behavior |
| --- | ---: | ---: | ---: | --- |
| Genuine change | 104 | 33,496 | 28,920 | Form Lead priority 0 to 5, revision 4 to 5, one canonical Command, EntityChange and queued Sheet intent |
| Fresh unchanged | 92 | 31,297 | 26,754 | New Observation and Decision, later temporal winner, same revision, existing-subject refresh |
| Older report approved after newer observations | 76 | 26,630 | 22,099 | Stale Decision, newer winner and revision preserved |
| Re-enter original terminal operation | 4 | 2,431 | 2,431 | Original receipt, Observation and Decision IDs, same retained counts and BSON |

In the independently repeated fixture, run `6afcbe42ed93f6f5ef475bf0` sealed and approved one selected Estimates action. Its full approval checksum starts `7c41d166`. Its operation ID joined the run ID to the original action ID. Capture returned receipt `6afcbe43ed93f6f5ef475bf2`, normalization produced Observation `6afcbe43ed93f6f5ef475bf3`, and live Decision `6afcbe44ed93f6f5ef475bf4` recorded the update to existing Form Lead `000000000000000000000101`. The fresh unchanged Observation then became the winner. Replaying the first operation returned the first Decision and left the later winner in place. The evidence contains full IDs, approval checksum, timestamps and per-stage returned, update and insert BSON. [Repeat and exact chain](evidence/granot-measurement-repeat.json)

A second fault interrupted a real canonical action after its transaction and before its run checkpoint. The stale worker lost its epoch with zero embedded results. The successor recovered the original operation to exactly one embedded receipt, one Command, one EntityChange and a single Lead revision increase from 5 to 6. The plan, approval, original expiry and purge timestamps matched across recovery. The fixture used synthetic Granot HTTP responses, suppressed queue publication and performed no external delivery. [Fault proof](../../ops/capacity/granot-canonical-crash.ts)

## Who owns the durable work

| Stage | Authority, identity and effect |
| --- | --- |
| Collect and seal | The collector creates the run ID and original 24-hour expiry and sets the seven-day purge deadline. Queue messages nominate work. The worker claims the shared Granot account lease and one run by lease owner and epoch. The Estimates planner parses the complete provider report, records each row's provider capture time, resolves Registry and target, and seals the schema-v2 plan once under a fence. Progress checkpoints are advisory. |
| Approve | The owner command checks state, original expiry, checksum and selected IDs, then stores the approving actor, time, exact selected actions and checksum. A system-approved Estimates slot has its own existing actor. A preview by itself authorizes no effect. Creation and approval may publish automation wake-ups. |
| Dispatch and capture | The worker reloads the approved plan under its lease and recomputes its checksum. Per-action gates read both leases on the primary and renew when needed. The action uses its sealed operation ID and approving actor. Capture inserts a credential-redacted Observation Receipt under the unique channel and operation key. A duplicate must agree on payload hash and operation kind. Same key with a different payload is a conflict. |
| Normalize, resolve and decide | The synchronous apply path claims or polls that same receipt. It sends no lifecycle queue message. The lifecycle queue and five-minute drainer can also claim due work, under a separate receipt lease. Normalization upserts the Observation by receipt ID. Registry gates, source-scoped matching and a fresh target read govern the Decision. The temporal comparator orders captured time, then Observation ID on a tie. |
| Canonical Lead effect | For an authorized matched change, `synchronizeLeadFromGranot` checks the target revision and winner inside the canonical transaction. It records the Command, Decision, Lead and any Record Link/EntityChange and Sheet intent required by that result. Post-commit finalization owns the Sheet wake-up and Daily Operations fact. An unchanged fresh observation can advance the temporal winner. A stale observation cannot displace it. |
| Completion and recovery | The drainer settles the receipt under its lease or schedules the next match/technical attempt. The collector upserts the action result and checkpoint under the run fence. Estimates Outreach refresh has its own durable completion marker. A crash can leave the lifecycle result ahead of the embedded run checkpoint. Recovery reuses the same operation or already-captured receipt. Fresh unprocessed actions require valid original approval. |

The collector yields after 25 actions or 120 seconds per apply batch. A pending match can release the run for independent actions and other runs. The lifecycle receipt owns the due clock. The automation heartbeat and queue can nominate recovery, but neither changes approval, forces a match or proves that a scheduler ran. The operator runbook describes which parts can be observed at a given moment. [Collector](../knowledge/services/granot-http-collector.md) · [Automation apply](../knowledge/granot-lifecycle/automation-apply.md) · [Canonical commands](../knowledge/services/domain-commands.md) · [Local trace](granot.md)

## Original expiry under a partial apply

The deployed worker checked the original deadline at batch entry. The two-action replica case admitted the second action when the first action's post-commit refresh crossed expiry. The regression first failed with `Missing expected rejection`. Independent review reproduced it.

The candidate checks the original deadline after per-action lease I/O and immediately before calling apply. The already-admitted action can finish and save its receipt. The next action is refused, the run uses its existing failure path, and the approval, plan, checksum, original expiry and purge deadline are preserved. A separate resumed-partial fixture verifies that the worker retains the first receipt and dispatches zero actions after expiry. A lifecycle receipt validly captured before expiry still owns its existing processing and recovery clock. There is no new archive, TTL, replay authority or alternative admission path.

## Production baseline and dated gates

At session start on November 17, neither the November 18 nor November 23 9:06:40 p.m. New York W1 checkpoint had elapsed. The earlier November 17 daytime sample had 1,012 already-current and 70 stale Call Decisions, zero requested Sheet effects and zero new Call update jobs. That earlier window contained no genuinely changed Call. [W1 evidence](../capacity-review-2026-11-16/evidence/w1-daytime-observation-2026-11-17.json)

A fresh production window, 3:00–3:30 p.m. New York, contained 507 already-current, 37 stale and two applied Call Decisions. The 20 sampled equal-date Calls retained their observed temporal winners and had no effects. One genuine multifield change included a stored move-date delta. A bounded oplog read placed its Call update, Decision, EntityChange and exact Sheet job in one transaction. The completed receipt pointed to the Decision. The exact job/run recorded one synced update and two synced deletes, with Decision-keyed Granot and job-keyed Sheet completion facts. The other change updated priority and requested no Sheet effect. This closes the natural changed-Call application delivery example for the serving W1 release. It establishes neither a physical Google membership read nor move date as the sole trigger. W1's 48-hour and seven-day windows and the W2 A prerequisite remain open. [Window counts](evidence/granot-w1-window-2026-11-17.json) · [Causal verification](evidence/granot-w1-causal-2026-11-17.json)

The production alias resolved to READY deployment `dpl_384JZ1Fn3N22ZnFRTAhqdC1XgLhm`. The indexed worker stamp agreed at 3:36 p.m. New York on application commit `7d12c4b3e09ef1e0e87c16dabbb8cc816427d73a`. This includes the earlier W1 correction and W5 bounded checkpoint, receipt persistence and lease-renewal subset. The broader uncommitted W1/W5 work in the capacity checkout includes a different expiry/retention policy and remains separate. [Earlier qualified release](../capacity-review-2026-11-16/QUALIFIED-RELEASE-2026-11-17.md)

The read-only refresh verified the production SRV, current three-member replica configuration and deployment stamp before one bounded database-statistics command on each member. At 3:36 p.m. New York, filesystem use was 74.231%, 85.484% and 84.685%. The earlier worst-member reading was 85.07%. Member names differed between samples, so use the maximum for fleet comparison. Continue the November 18 watch. A new 90% alert or measured acceleration calls for reassessment. These readings precede any Phase 2 release. [Three member readings](evidence/granot-capacity-2026-11-17.json) · [Earlier capacity audit](../capacity-review-2026-11-16/PRODUCTION-CAPACITY-AUDIT-2026-11-17.md)

## Review and operator rehearsal

An independent GPT-6.2 Astra reviewer reproduced the expiry failure on the previous worker and found a diagnostic that could wrongly associate an idempotency conflict with another payload's result. The final trace stops at the conflict, rejects missing or invalid checkpoint pointers and checks operation kind and target-specific effect references. With no collector checkpoint it can report an operation-key correlation only. The reviewer exercised six local tests and five independent Mongo trace cases, verified the measurement hashes and deltas, and found no remaining runtime or trace blocker.

A fresh Astra operator used AGENTS.md, service discovery and the runbook on the isolated local profile. On the final seed, run `6afcbf36268cb99136c1df60`, discovery, runbook lookup and trace each exited 0. The collector checkpoint recorded `accepted_for_processing`. The completed receipt referenced a later live Decision that recorded `lead_updated` for the exact Form Lead. A different Observation captured 30 seconds later was the Lead's current winner. The operator identified the original November 18 20:53:48.598 UTC expiry, the absence of a scheduled receipt retry, and the read's limits on actor identity, direct provider delivery and current field attribution. No repair or replay was attempted. Two malformed document separators found during rehearsal were corrected and the onboarding files were verified as UTF-8. [Operator runbook](granot.md)

## Validation on the local candidate

| Check | Result |
| --- | --- |
| Full offline regression | 4,044 tests discovered, **3,867 passed, zero failed, 177 gated skips**. Repository typecheck, lint and diff checks passed. |
| Lifecycle replica sweep | 110 passed with Sheet delivery disabled, 40 passed with queued synthetic Sheet targets. Zero skips. Includes duplicate operation capture, concurrent acceptance, stale/newer evidence, canonical transaction rollback and official Booking/Cancellation behavior. |
| Collector recovery | Ten Pool scheduling, pending-match and persistence cases and four worker recovery/expiry cases passed, zero skips. The latter include lease loss before checkpoint and a resumed partial run after the original deadline. |
| Sealed-run measurement and diagnostics | Before, after and repeat ran on fresh disposable databases. The repeat included a real interrupted canonical change. Three focused CLI/replica tests passed, including command monitoring and adversarial trace cases. |

The first full regression timed out in the unchanged request-telemetry test. That test passed alone. The final full regression passed with five concurrent test files and the original timeout. Other corrected failures include a missing local CSI index, a wrong disposable database prefix, suites competing for queued fixtures in a shared test DB, and TypeScript errors in command-monitor tests. The [validation record](evidence/granot-validation-2026-11-17.json) lists the failed attempts, proof boundaries and all 177 skip names. The exercised replica suites use separate fake-provider environments. Other opt-in groups retain their own gates.

For a fresh engineering rehearsal use a single writable `capacityp1` replica member on `127.0.0.1:27216`. On an unused port, the following starts an isolated fixture. An existing fixture can be reused only after checking its advertised identity. The measurement launcher verifies the target before creating its unique temporary database.

```powershell
docker run --name vantage-granot-phase-two -p 127.0.0.1:27216:27216 -d mongo:8.0 --port 27216 --replSet capacityp1 --bind_ip_all
docker exec vantage-granot-phase-two mongosh --norc --quiet --port 27216 --eval 'rs.initiate({_id:"capacityp1",members:[{_id:0,host:"127.0.0.1:27216"}]})'
node --import tsx ops/capacity/granot-phase-two.replica.ts "$env:TEMP/granot-measurement-$([guid]::NewGuid()).json"
node --import tsx ops/capacity/run-recovery.replica.ts
```

The read-only operator rehearsal uses its separate fixed `rs0` profile. [Local target, commands and interpretation](granot.md)

## Release and rollback

The owner has authorized local engineering only. The branch has no Phase 2 commit, hosted build, preview, production deployment, enablement or live benefit measurement. Sheet S6 requires separate authority. No production data, scheduler, index, allocation or retention changes were made. RingCentral remains the normal Call admission authority and official Bookings/Cancellations retain their reporting path.

For a separately authorized release, freeze the exact source against fresh main, independently review the Granot delta and its tooling prerequisites, rerun replica and integrated checks, and follow the repository's preview/build and diagnostic-parity gates. Check the alias and a fresh worker stamp after rollout. Compare equivalent naturally scheduled windows by action count, selected-action mix and plan BSON size. Track completion latency, due work, lease refusal and partial/failed runs. Join changed and unchanged Decisions to actual canonical effects. Local BSON counts cannot establish fleet traffic, storage savings or real-provider delivery.

The read projection can be reverted independently after a reviewed release. Both readers use the same stored schema and full apply-time checks. Retain the per-action expiry guard when reverting a performance change. Rolling back the guard independently reopens the reproduced expiry defect. Keep existing receipts, Decisions, temporal winners and downstream intent intact.
