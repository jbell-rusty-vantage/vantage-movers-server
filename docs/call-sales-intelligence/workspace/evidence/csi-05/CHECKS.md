# CSI-05 checks

Baseline: `git branch --show-current`, `git status --short`, `git log -1 --oneline` → `sales-intelligence`, clean tree, `c73df86`. All changes in vantage-main-server; dashboard untouched. Synthetic numbers are 202-555-01xx. Replica runner forces TEST_MODE, randomized `testvantagemovers_csi05*`, loopback `127.0.0.1:27189`, replica `csi01`, no `.env`, provider/media/STT flags off; its database is dropped in finally.

| Exact command | Actual outcome |
| --- | --- |
| `pnpm typecheck` | Final current-source run exit 0, [output](typecheck.txt). Initial errors corrected (nullable source fields, route params, evidence dates); later HTTP fake lacked its typed outcomes field, corrected before final run. |
| `pnpm lint` | Exit 0, [output](lint.txt). |
| `node --import tsx --import ./ops/test-setup.ts --test "src/services/salesIntelligence/attachment/*.test.ts" src/services/salesIntelligence/conversations/eligibility.test.ts src/routes/sales-intelligence-admin.routes.test.ts src/routes/sales-intelligence-cron.routes.test.ts` | 13 pass / 0 fail, [output](focused.txt). |
| `pnpm test:csi:attachment:replica` | Final expanded run: 11 pass / 0 fail, [output](replica.txt). First fixture run failed on invalid synthetic worker id and missing required interaction fields; fixed the fixtures. An expanded rediscovery assertion initially ran behind an intentional 205-job backlog; changed the proof to target its actual change-hook jobs, preserving the production drain bound. |
| `pnpm test:csi:media:replica` | 20 pass / 0 fail after CSI-11 shared-resolver and legacy account-scope integration, [output](media-regression.txt). |
| `pnpm test` | 2,386 pass / 114 skip / 0 fail (2,500 total), [output](offline-tests.txt). |
| `git diff --check` | Exit 0; only platform LF/CRLF informational warnings. |

`pnpm finish-work --provider codex --no-apply` completed with exit 1, run `1789751062858-85e53394`, `QUALITY_RESULT: FAIL`. Its earlier snapshot lacked `outcomes: []` in the attachment cron test fake (TS2322). That fixture was corrected in this checkout while the isolated review ran, and the current-source typecheck above passes. Snapshot lint/test/quality-tests passed (2387 tests passed, including the checkpoint's additional CSI-12 regression; 114 skips; quality-runner 12/12). No checkpoint patch was applied. Its sole substantive review finding and proposed repair concern pre-existing CSI-12 transcript redaction, explicitly outside this task. [Review details](REVIEW.md). This is not claimed as a passing checkpoint.

No production or live-provider validation performed. [Changed files](FILES.md). Branch and HEAD rechecked at completion: `sales-intelligence`, `c73df86`; no commit/push/reset/clean or flag enablement.
