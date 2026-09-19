# CSI-14 checks

All commands run in `C:\Users\Pinda\Proyectos\vantage\vantage-main-server`, without `.env`, production credentials, live provider calls, commit or push. Raw outputs are adjacent `.log` artifacts (PowerShell `*>` redirection). Tests use synthetic data and fake adapters.

| Exact command | Result / artifact |
| --- | --- |
| `pnpm typecheck` | exit 0, `typecheck.log` (rerun after refinements) |
| `pnpm lint` | exit 0, `lint.log` |
| `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/nudges/*.test.ts src/services/salesIntelligence/repIdentity/*.test.ts src/services/salesIntelligence/outreach/outreach.test.ts src/services/salesIntelligence/foundation.test.ts` | 31 pass, `focused.log` |
| `pnpm test:csi:nudges:replica` | 16 pass, `replica.log` |
| `pnpm test:csi:outreach:replica` | 22 pass, `outreach-regression.log` |
| `pnpm test:csi:rep-identity:replica` | 12 pass, `identity-regression.log` |
| `pnpm test:csi:replica` | 15 pass, `foundation-regression.log` |
| `pnpm test:csi:reads:replica` | 10 pass, `reads-regression.log` |
| `pnpm test` | final current-source run: 2409 pass / 114 skip / 0 fail, `offline-current.log`; preceding runs 2408/114/0 in `offline-final.log` and 2407/114/0 in `offline.log`. Initial run: 2399 pass / 114 skip / one test-file failure from Windows `UNKNOWN` reading installed `googleapis` in unrelated `granot-webhook.routes.test.ts`; retained in `offline-initial.log`. Subsequent timeline inclusion passed nudge/read/Outreach replica checks and current typecheck/lint. |
| `pnpm finish-work --provider codex --no-apply` | required isolated checkpoint; see `REVIEW.md` for actual result |

Initial implementation feedback: first compile found one nullable date typing error, corrected. Initial replica run had 12 pass / two reported failures (subtest plus parent) because the synthetic fixture attempted a Mongoose update to append-only directory evidence. Fixture setup corrected; no runtime weakening of append-only protection. `replica-initial.log` retains the failure. Current replica passes include identity conflict/non-User, real restriction, opt-in SMS, receipt persistence crash and bounded recovery additions.

The offline file-read failure is an environment result, not a CSI-14 assertion failure or a passing suite. It is recorded separately from the rerun and checkpoint. Live provider capability/send proof is intentionally unexecuted under the task's authorization boundary.

The added timeline assertion initially omitted two required `TimelineSourceInput` fixture fields. Current typecheck caught this (`typecheck-timeline-fixture.log`); the fixture now provides `e164`/`national_ten`, and typecheck passes. Its runtime assertion had already passed. First checkpoint's automated checks all passed, but final review failed on stale shared-contract prose; that prose was corrected and a second checkpoint is tracked in `REVIEW.md`.
