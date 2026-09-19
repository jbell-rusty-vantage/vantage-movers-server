# CSI-13 checks

Direct source checks and the required isolated quality checkpoint are recorded below. No production/live provider work is authorized or performed. Each replica runner uses a fresh disposable loopback database and synthetic fixtures.

Initial runtime development failures exposed fixture requirements, BSON canonical serialization and conservative context ceiling; corrected before the recorded passing proof. `runtime-development.log` retains the last development run; `runtime-final.log` retains the pre-checkpoint proof; `runtime-post-review.log` is the final proof.

## Replica regressions

Run sequentially with `node --import tsx scripts/test-csi-<name>.ts` (no env files or external services):

| Suite | Result | Log |
| --- | --- | --- |
| Runtime actual SDK/local HTTP MCP/server | 21 passed after review | `runtime-post-review.log` |
| Foundation | 15 passed | `foundation.log` |
| Outreach, including conversation authority | 24 passed | `outreach-final.log` |
| Rep identity | 12 passed | `rep-identity.log` |
| Transcription | 19 passed | `transcription-final.log` |
| Scoped intake | 9 passed | `intelligence.log` |
| Scoped reads | 9 passed | `intelligence-reads-final.log` |
| Number reads | 10 passed | `reads.log` |
| Number projection | 7 passed | `numbers.log` |

The initial transcription regression failed one obsolete assertion expecting `no_consumer`; CSI-13 now registers analysis. The updated test verifies dispatch to the disabled consumer and no repeat STT. Its full final rerun passed. `transcription.log` preserves that initial result.

The expanded runtime proof covers exhausted final-claim receipt recovery, incomplete history, number-only restrictions with uncertain dates, live Owner contact-type edits during application, a single successor for source changes during synthesis, and a pre-provider number eligibility flip that refunds its attempt/reservation without STT. A misplaced test setup initially targeted the completed analysis job in the application-expiry test; moved into the intended exhausted-analysis recovery fixture before the passing rerun.

Initial direct typecheck/lint passed. Initial full offline suite: 2,428 passed, 114 skipped, one obsolete CSI-12 wiring assertion failed because analysis is now registered (`offline.log`). That assertion is updated and CSI-13 auth/flag/registration tests added. Full direct offline rerun passed: 2,430 passed, 114 skipped, zero failed (`offline-final.log`). Subsequent worker/matcher refinements passed the 19-case runtime and 24-case Outreach replicas plus direct typecheck and lint (`typecheck-final.log`, `lint-final.log`). After the reviewed coverage fix, the expanded runtime passed 21/21 and the focused coverage test passed 1/1. Final post-review direct typecheck and lint both passed (exit 0, `typecheck-post-review.log`, `lint-post-review.log`); `git diff --check` passed. Earlier CSI-17/14/10 review status remains unchanged; direct tests are distinct from independent snapshot verification.

## Required isolated checkpoint

`pnpm finish-work --provider codex --no-apply` completed as **patch-ready**, run `1789795679279-a540097e`, with `QUALITY_RESULT: PASS`. The snapshot included earlier CSI changes because the quality baseline predates this task; it is not the task's Git baseline.

- Snapshot typecheck/lint passed; offline tests: 2,430 passed, 115 skipped, zero failed; quality infrastructure tests: 12 passed. The additional offline skip is cross-repository MCP schema parity because the isolated server snapshot has no sibling MCP checkout.
- Initial review found one medium CSI-13 issue: record-only number synthesis could publish without captured transcript evidence. Inspected `checkpoint-changes.patch` before manually adopting its four paths: two coverage/source guards, focused test and owning Service documentation. No unrelated proposal was applied.
- Cleanup's attempted focused validation initially reported snapshot dependency/config access limitations. Later automated snapshot checks passed. The new coverage test did not appear in that offline log, so it was explicitly run against the source checkout (1 passed, `coverage-post-review.log`). Final verify returned PASS (`checkpoint-verify.md`).
- Expanded real-transport replica proof after adoption passed 21/21: no eligible transcript creates no run/reservation/summary; later transcript changes schedule a successor; a legacy record-only receipt through real MCP capture/intake pauses at application without publishing. No accepted evidence was rewritten in that proof.
- The final source checkout includes those two additional replica scenarios beyond the checkpoint snapshot. This is a scoped adoption and direct revalidation, not a claim that the final checkout fingerprint is identical to the reviewed snapshot.

Evidence: `checkpoint-report.json`, `checkpoint-review.md`, `checkpoint-cleanup.md`, `checkpoint-docs.md`, `checkpoint-verify.md`, `checkpoint-changes.patch`, and the four `checkpoint-*.log` check logs. Source HEAD/index remained unchanged; no automatic application, commit or push.
