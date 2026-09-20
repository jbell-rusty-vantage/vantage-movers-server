# CSI-16 checks

Fresh checks on the intake SHAs plus the CSI-16 certification harness/docs. Providers are fake; replica runners use random disposable databases on loopback `csi01:27189` and never load .env. Browser/HTTP use the guarded 3108 Admin → 3107 API preview. Original B–E fixtures are unchanged. Exact output excerpts and log fingerprints are in `test-results.txt`; prior proof fingerprints are in [SOURCES](SOURCES.md).

| Command (server unless noted) | Fresh result |
| --- | --- |
| `node --import tsx scripts/test-csi-backfill.ts` | PASS 14/14 |
| `node --import tsx scripts/test-csi15-retention.ts` | PASS 10/10 |
| `node --import tsx scripts/test-csi15-budget.ts` | PASS 13/13 |
| `node --import tsx scripts/test-csi15-period.ts` | PASS 4/4 |
| `node --import tsx scripts/test-csi-outreach.ts` | PASS 24/24 |
| `node --import tsx scripts/test-csi-runtime.ts` | PASS 23/23; real SDK/local HTTP MCP, fake model |
| `node --import tsx scripts/test-csi-owner.ts` | PASS 6/6 |
| `node --import tsx scripts/test-csi-capture.ts` | PASS 12/12 |
| `node --import tsx scripts/test-csi-attachment.ts` | PASS 12/12 |
| `node --import tsx scripts/test-csi-nudges.ts` | PASS 18/18; fake provider, no live send |
| `node --import tsx scripts/test-csi-media.ts` | FAIL: 18 passed / 2 failed, one leaf plus enclosing parent; exact Retry-After mismatch in F-01. |
| `node --import tsx --import ./scripts/test-setup.ts --test` with every `*.test.ts` under `src/services/salesIntelligence` and `src/services/numberActivity`, plus admin/cron/boundary CSI route tests | PASS 140/140, zero skipped. |
| Reviewer: `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/contracts.test.ts` | PASS 3/3, zero skips; actual sibling MCP generated contract comparison. |
| `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit` | FAIL: only three external probe TS18046 errors at line 231. |
| `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p .git/csi15-tsconfig.json` | PASS before new harness; final harness validation recorded below. Config extends original, retains `scripts/dev_ops/**` exclusion, excludes only external probe additionally. |
| Admin `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit` | PASS |
| Admin `node --import tsx --test lib/api/salesIntelligenceCoverage.test.ts lib/api/salesIntelligence.test.ts lib/api/salesIntelligenceCopy.test.ts` | PASS 15/15 |
| `node --import tsx scripts/test-csi08-local.ts` | PASS against restarted current API: pagination, attachment availability, review, BFF key replay/payload conflict/revision conflict, Admin/historical denial. Initial run before restart also passed; only current rerun is current API evidence. |
| `node --import tsx scripts/test-csi-live.ts` | PASS: streamed reconnect + clock frames, no-buffer header, Owner identity, Admin/anonymous denial, conflicting scope denial and idempotency. |
| `node --import tsx scripts/test-csi08-local.ts clock-regression` | PASS: unchanged idle revisions, once-only wait expiry. |
| `node --import tsx scripts/test-csi16-local.ts` | PASS: exact Saturday 19:50→Monday 08:20/08:05 defaults; current Coverage schema with day-zero disabled planning; scope denial; synthetic Lead entry 200; named subject IDs absent from isolated preview 404. `local-http.json`. |

The new harness first expected `backfill.available:true`; inspection of the existing contract confirmed it is `days > 0`. Corrected only this new CSI-16 harness to assert false at days zero and reran successfully. No old fixture was edited to hide a failure. Initial browser Coverage parse errors came from an old in-memory API process; restart resolved them. No application patch was needed.

## Browser proof

`browser-*.txt` are current accessibility artifacts, with synthetic phone text redacted. Coverage, three independent actions, Alex/Jordan/Casey responsibility, Owner date correction while AI is off, callback No answer completing only that action, customer wait retaining other work, explicit closure, analysis/Lead entry and ambiguity states are accounted in ACCEPTANCE. Text artifacts are UI proof, not fabricated screenshots. Each full scenario status and unexercised portion is explicit there.

## Review/checkpoint boundary

The prior CSI-15 broader checkpoint **failed** and stays failed. No isolated patch is applied. Current required finish-work review and final harness checks are recorded when completed; their result must not be inferred from the focused suite. MCP is read-only scope and unchanged, so its full typecheck/suite are not triggered by this task.

## Final task harness validation

Final scoped server typecheck after adding `scripts/test-csi16-local.ts`: PASS (exit 0). Initial default ESLint invocation ignored scripts because repository matching globs only include src/api; not counted as lint proof. Explicit `.git/csi16-eslint.config.mjs` extends the same correctness rules/parser to only the new harness; `pnpm exec eslint --config .git/csi16-eslint.config.mjs scripts/test-csi16-local.ts`: PASS, zero warnings. Server/Admin `git diff --check`: PASS. No runtime files or old fixtures changed.

Message-rep browser proof: loaded only stored `csi08-synthetic` account; picker offers directory User without reviewed Agent match and narrows channels to pager. Explicit Preview returns FEATURE_DISABLED because local NUDGE remains off (`browser-message-blocked.txt`). No send attempted. This is a local capability block, not a production probe.

Composer first review additionally found source-confirmed pending-recording retry delay drift, filed as F-07 (CSI-11/CSI-01). It is not hidden by the passing 404 fixture, which forces the job due. No runtime correction was applied.
