# CSI-17 checks

Direct checks and the required quality checkpoint are distinct. Full outputs are local artifacts in this directory. No live provider/model or production proof was run.

## Direct source checks

Final direct results (September 19): server `pnpm typecheck` and `pnpm lint` exited 0. Full offline `pnpm test`: **2,540 tests, 2,426 pass, 0 fail, 114 skipped**. Focused CSI-17 units: **14/14**. Intake replica: **9/9**; final read replica: **9/9**. Required replica regressions: foundation **15/15**, reads **10/10**, Outreach **22/22**, identity **12/12**, transcription **19/19**. ObjectId/real-loader guard regression: **8/8**. MCP **35/35**, typecheck and safe isolated `pnpm build --webpack` passed; see MCP-CHECKS for exact build configuration. Earlier failures and superseded outputs remain separate files.

| Command (server root) | Evidence |
|---|---|
| `pnpm typecheck` | `typecheck.log` |
| `pnpm lint` | `lint.log` |
| `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/analysis/*.test.ts` | `focused.log` |
| `pnpm test` | `offline-suite.log` |
| `node --import tsx scripts/test-csi-intelligence.ts` | `intake-replica.log` |
| `node --import tsx scripts/test-csi-intelligence-reads.ts` | READS-CHECKS; final `reads-replica-final.log`; earlier 8-test `reads-replica.log` |
| `pnpm test:csi:replica` | `test-csi-replica.log` |
| `pnpm test:csi:reads:replica` | `test-csi-reads-replica.log` |
| `pnpm test:csi:outreach:replica` | `test-csi-outreach-replica.log` |
| `pnpm test:csi:rep-identity:replica` | `test-csi-rep-identity-replica.log` |
| `pnpm test:csi:transcription:replica` | `test-csi-transcription-replica.log` |

MCP's exact commands, actual transport assertions, typecheck and isolated build are in [MCP-CHECKS.md](MCP-CHECKS.md). No MCP lint script exists. Cross-repo generated contract parity executes from the shared workspace; isolated server snapshots do not have the sibling MCP artifact and report that single check as skipped.

## Resolved development failures

- Local replica initially refused connection because existing container was stopped; restarted existing loopback `csi01`, no production operation.
- New intake fixture used nonexistent `phone_digits`/`national_digits`; corrected against actual ContactNumber schema (`national_ten`, `digits_reversed`, required timestamps). This was test setup, not production model relaxation.
- Auth-denial assertion expected 403 for missing/unknown API key; existing guard correctly returns 401. Corrected assertion while retaining 403 for broad-but-insufficient secret and invalid signed run scope.
- Initial compile found unknown ObjectId filter and nullable-parent expression/dynamic import types in new files; fixed with typed job ID, explicit nullable branch and static import. Current-source typecheck result supersedes those intermediate failures.
- MCP initial canonical digest/concurrent-stream assertions were corrected as detailed in MCP-CHECKS.
- Final bounded-loader regression assertion needed optional access for the loader's optional `leads` result. Corrected `rows.leads?.[0]?.model`; the assertion still fails when the expected Lead is missing. The earlier compile failure is retained in `typecheck-before-test-fixture-fix.log`; final typecheck is separate.
- The full suite then caught `src/utils/objectId.test.ts`'s exact existing type-import shape guard after adding the `FindCursor` type. Preserved the guarded existing `Db, Document` import and imported `FindCursor` separately. `objectid-loader-regression.log` records the passing guard plus real loader regressions; `offline-suite-before-import-guard-fix.log` retains the prior single failure. No runtime Mongo ObjectId value import was added.

## Post-snapshot hardening

After the quality snapshot was captured, direct audit added bounded Job Number timeline database cursors (200 rows plus overflow sentinel, 5-second query limit), composite `(ObjectId, model)` pagination across Form/Call collections, run-wrapped activity cursors, explicit same-number conversation/Outreach context including Lead Owner instructions, and a lease-revocation capture regression. These have targeted direct proofs; the earlier checkpoint cannot approve these later source changes. New provider-limit error codes are preserved safely through MCP. All source is frozen for final direct checks.

## Required checkpoint

Command: `pnpm finish-work --provider codex --no-apply`. Run `1789786268819-98e1193c`, input HEAD `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, fingerprint `f7b32ec7b24c642992bf9c4c55a82a3c5dac337dffa7a96bb60d2cda6e3c1111`, stored under `.git/vantage-quality/runs/1789786268819-98e1193c/`. This snapshot includes accumulated prior dirty work, not only CSI-17.

Initial review found a separate CSI-10 issue: rep-identity replay only schedules recording discovery when `call.recordings.length` is nonzero. The proposed cleanup changes identity replay and its replica test; proposed documentation changes identity Service guidance and the software map. Reports are copied to `QUALITY-INITIAL-REVIEW.md`, `QUALITY-PROPOSED-CLEANUP.md`, `QUALITY-PROPOSED-DOCS.md`. No unrelated identity patch was applied to this checkout.

Snapshot automated checks: typecheck, lint and quality-runner tests exited 0. Its offline suite exited 1: two test processes (`granotLifecycle/operations.replica.test.ts`, `granotLifecycle/receiptSearch.test.ts`) failed during dependency loading with Node `readFileSync` **UNKNOWN / errno -4094 / syscall read**, before assertions. Snapshot totals: 2,522 tests, 2,406 pass, 2 failures, 114 skips. Running those exact two files again in the same isolated snapshot exited 0; actual output is `quality-targeted-files-retry.log`. This retry diagnoses a local file-read failure but does not rewrite the failed full-checkpoint result. Final direct source full suite independently passed as recorded above.

Final checkpoint status: **failed**, stage **verify**, finished `2026-09-19T03:14:02.141Z`; final review **QUALITY_RESULT: FAIL** because the recorded full test gate was unmet. Quality-runner regression tests passed **12/12**. Targeted retry in the same snapshot: **17 tests, 16 pass, 1 intentionally skipped**, exit 0. [Final review](QUALITY-FINAL-REVIEW.md), `quality-report.json`, `quality-offline-suite.log`, `quality-runner-tests.log` preserve the result.

Inspected proposed patch `QUALITY-PROPOSED.patch`: four paths only—`.cursor/rules/project-organization.mdc`, identity Service docs, identity replica test, and `repIdentity/worker.ts`. It proposes unconditional recording-discovery enqueue for replayed calls plus the associated documentation/test. It was **not applied**: this is separate CSI-10 behavior outside the authorized CSI-17 slice, and the checkpoint failed. The source's existing CSI-10 discovery gap is recorded as a follow-up, not claimed fixed. The snapshot also predates bounded-read hardening and cannot serve as final current-source approval. Existing CSI-14 P2 remains separate and unresolved; neither passing direct checks nor snapshot cleanup resolves it.
