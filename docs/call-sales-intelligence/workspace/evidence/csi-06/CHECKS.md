# CSI-06 verification

All commands run from `vantage-main-server` on `sales-intelligence`. Replica runners explicitly select randomized `testvantagemovers_csi06*` databases on loopback `127.0.0.1:27189`, replica set `csi01`, with sheets/providers disabled. They never load `.env` and drop only their own test database.

| Command | Actual result / artifact |
| --- | --- |
| `git status --short`; `git branch --show-current`; `git log -1 --oneline`; `git remote -v` | Clean; sales-intelligence; 999c63d; jbell-rusty-vantage/vantage-movers-server. |
| `pnpm typecheck` | Final source passed; [typecheck.log](typecheck.log). |
| `pnpm lint` | Passed; [lint.log](lint.log). |
| `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/outreach/outreach.test.ts` | 6/6 passed; final focused run includes route/capture compatibility. |
| `pnpm test:csi:outreach:replica` | Final source 22/22 passed; [replica.log](replica.log). Covers persisted ownership, concurrent Owner-vs-worker correction, multi-action/undated, ambiguous callback matching, waits, closure, restrictions, chronology, replay/CAS/lease, EntityChange and read-only Attention/timeline pagination. |
| `pnpm test:csi:reads:replica` | 10/10 passed; [reads-regression.log](reads-regression.log), including unchanged GET-mutation snapshot proof with populated Outreach DTOs. |
| `pnpm test` | 2392 passed, 114 skipped, 0 failed; [offline.log](offline.log). This full run preceded final snapshot/date-parser/timeline refinements; final affected checks are listed below. |
| `pnpm test:csi:attachment:replica` | 11/11 passed; [attachment-regression.log](attachment-regression.log). |
| `pnpm test:csi:fanout:replica` | 11/11 passed; [fanout-regression.log](fanout-regression.log). |
| `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/outreach/outreach.test.ts src/routes/sales-intelligence-admin.routes.test.ts src/routes/sales-intelligence-cron.routes.test.ts src/services/numberActivity/interactionProjection.test.ts` | Final source 31/31 passed; [focused.log](focused.log). Includes 30/15/1440 staffed minutes, DST/day-only/explicit-time/ambiguous-date cases and Owner-error HTTP mapping. |

Initial implementation failures (null prior values rejected by required audit fields, spreading Mongoose documents into the attribution resolver, Agent accessor mismatch, raw ObjectIds in canonical fingerprints) were corrected and re-proven. These are implementation findings, not provider or environment permission failures.

`git -c core.safecrlf=false diff --check` passed. Branch remains `sales-intelligence`; HEAD remains `999c63d`. No commit, push, migration, flag enablement or external send.

Required checkpoint: `pnpm finish-work --provider codex --no-apply`, run `1789755717319-34457adf`, finished failed against its earlier snapshot. Its typecheck failure was already fixed in source; final reviewer also identified a cron-table mismatch, now corrected. Snapshot lint/offline/quality checks passed (2393 offline passes, 114 skips; 12 quality passes). Initial P2 HTTP error finding is fixed and covered by current route tests. No patch applied; no final independent approval claimed. See [REVIEW.md](REVIEW.md). The checkpoint was not repeated after final fixes; current source results above are from actual direct commands.

No live capability proof is claimed. Flags remain off outside explicitly isolated tests.
