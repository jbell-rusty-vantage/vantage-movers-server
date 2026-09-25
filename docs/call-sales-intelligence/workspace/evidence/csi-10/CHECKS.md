# CSI-10 verification

All commands run from `vantage-main-server`, branch `sales-intelligence`, baseline `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`. Initial `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`, `git status --short`: expected branch/work-account remote; clean tree; CSI-06 already committed. No branch switch, commit or push.

Every replica runner explicitly selects a randomized `testvantagemovers_csi*` database at `mongodb://127.0.0.1:27189/?replicaSet=csi01`, disables providers/sheets, never loads `.env`, checks the database/replica, and drops only its own test database. A stopped disposable Mongo 8.0.17 binary was started locally using a fresh `.git/csi10-mongo` data directory, loopback-only port 27189 and `csi01`; no production database or installation was touched.

| Exact command | Actual result / output |
| --- | --- |
| `pnpm typecheck` | Passed; [typecheck.log](typecheck.log). |
| `pnpm lint` | Passed; [lint.log](lint.log). |
| `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/repIdentity/identity.test.ts src/services/salesIntelligence/repIdentity/routes.test.ts src/services/salesIntelligence/outreach/outreach.test.ts src/services/salesIntelligence/conversations/eligibility.test.ts src/routes/sales-intelligence-admin.routes.test.ts src/routes/sales-intelligence-cron.routes.test.ts` | 19/19 passed; [focused.log](focused.log). |
| `pnpm test:csi:rep-identity:replica` | 12/12 passed; [replica.log](replica.log). |
| `pnpm test:csi:outreach:replica` | 22/22 passed; [outreach-regression.log](outreach-regression.log). |
| `pnpm test:csi:media:replica` | 20/20 passed; [media-regression.log](media-regression.log). |
| `pnpm test:csi:transcription:replica` | 19/19 passed; [transcription-regression.log](transcription-regression.log). |
| `pnpm test:csi:replica` | 15/15 passed; [foundation-regression.log](foundation-regression.log). |
| `pnpm test:csi:reads:replica` | 10/10 passed; [reads-regression.log](reads-regression.log). |
| `pnpm test` | 2398 passed / 114 skipped / 0 failed; [offline.log](offline.log). This full run preceded the final GET stored-proposal/DTO envelope refinement; affected tests and typecheck/lint were rerun against current source. |
| `pnpm finish-work --provider codex --no-apply` | Snapshot checks and final review PASS; overall stale/exit 1 because source changed. Snapshot tests 2399 pass/114 skip, quality tests 12/12. [checkpoint.log](checkpoint.log), [review record](REVIEW.md). No checkpoint patch applied; no independent current-source approval claimed. |

Shell output was captured with `*> docs/call-sales-intelligence/workspace/evidence/csi-10/<artifact>.log`. Commands above are reproducible without that redirection.

Initial implementation checks caught a Mongoose DTO inference error and ObjectId-only job refs; DTO typing now uses the model schema and recovery metadata is a typed additive job field. Initial fixture failures (required conversation metadata, enum close reason, recording observation time, and an extra same-extension fixture in a pagination count) were corrected. These were code/test issues, not provider capability failures. Expanded current-source tests supersede initial logs.

Acceptance evidence includes exact/alias/duplicate/unmatched proposals, non-User rejection, account scope, multi-extension Agents, competing review race, finite interval overlap rejection, invalid periods, before/at/after boundaries, reviewed versus unreviewed retirement, replay/payload/revision conflicts, unchanged-call identity fingerprint recovery, Owner record/action assignment and explicit null preservation, unknown promising identity, cancelled/officially closed work, read non-mutation, bounded continuation and deferred STT scheduling without a provider. Existing Outreach/media/STT/Foundation regressions also exercise restrictions, leases and official-state races.

No live directory/provider probes, messages, production migration/backfill, deployment or production flag enablement. Flags remain off outside isolated tests. Synthetic Agent and official Lead/receiver snapshots remain unchanged by identity work.

Final `git -c core.safecrlf=false diff --check` passed. Branch and HEAD remain `sales-intelligence` / `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`.
