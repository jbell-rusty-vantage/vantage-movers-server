# CSI-01 Step 2 verification

Executed September 17, 2026, on the uncommitted `sales-intelligence` patch. Grok baseline is `8219d2a`. No mocks are described here as database proof.

| Check | Command / scope | Result / artifact |
| --- | --- | --- |
| Server typecheck | `pnpm exec tsc --noEmit` in server | Exit 0, no diagnostics. |
| Dashboard typecheck | `pnpm exec tsc --noEmit` in admin | Exit 0, no diagnostics. |
| Server focused tests | Command below | 43/43, no skipped tests; [output](STEP2-server-tests.txt). |
| Dashboard compatibility | `node --import tsx --test tests/conversations-page.test.ts` | 9/9; [output](STEP2-admin-tests.txt). |
| Mongo replica proof | `pnpm test:csi:replica` | 15/15 including outer test, no skips; [output](STEP2-replica-tests.txt). |
| Migration CLI | Explicit loopback routing, `node --import tsx scripts/migrations/sales-intelligence-indexes.ts --report`, then `--verify` | Both exit 0, ready; [report](STEP2-migration-report.txt), [verify](STEP2-migration-verify.txt). |
| Patch hygiene | `git diff --check` in both repositories | Pass after owned-file whitespace cleanup. |

```powershell
node --import tsx --import ./ops/test-setup.ts --test "src/validation/intelligence/*.test.ts" "src/services/salesIntelligence/foundation.test.ts" "src/routes/sales-intelligence-boundary.routes.test.ts" "src/middleware/requireApiSecret.test.ts" "src/models/LeadConversation.test.ts" "src/services/conversations/*.test.ts"
```

The replica runner explicitly overrides inherited URI and TEST_MODE routing, does not load `.env`, and chooses a new `testvantagemovers_csi<random>` database. It refuses any host other than the disposable loopback replica `csi01` on port 27189. Tests inspect replica status and selected model databases before writes. A single-node MongoDB 8.0.17 replica was used; synthetic databases are retained for inspection. CLI report/verify targeted the post-review successful fixture database `testvantagemovers_csi1dd6c73ddfdf`; later reruns use fresh databases shown in their output. All migration applies occurred inside isolated tests, never on production.

Database proofs cover index uniqueness and absence, unresolved/contradictory attribution handling, preserved legacy summary/media, rerunnable apply, obsolete one-active-action index rejection, multiple nullable follow-ups, immutable snapshots/finalized run content, command replay/conflict and concurrent replay, aggregate/audit/job/command rollback, concurrent revisions, job lease recovery and expiry during effects, bounded retry/permission pause, budget reservation races/reconciliation/release, and policy CAS/ceiling-specific resumption.

HTTP tests use the real existing v1 guard and CSI boundary with an injected active-run lookup. They prove guard composition and denial, not stored-run lookup transactions. Token unit tests cover run/subject/tool/deployment/database/expiry/nonce/lease bounds and forged actors. Provider services, production account attribution, multi-node replica failover and full application/UI integration are not tested.

No credentials or customer/provider data occur in these fixtures. Local-only synthetic actor/key values in source tests are not deployment credentials.

## Independent review closeout

[GPT-6 independent report](STEP2-INDEPENDENT-REVIEW.md) preserves all five initial findings, their reproductions, resolution evidence and reviewed source hashes. The reviewer independently passed 9/9 focused tests, 15/15 replica tests and repeated the original immutability/cross-deployment probes. It approved CSI-01 completion and G1 foundation freeze. Main-agent post-fix tests above additionally cover the existing v1 guard and conversation compatibility. Server typecheck was rerun after the final code changes and passed; dashboard code is unchanged from its recorded 9/9/typecheck result.

New regression proofs include two generated run IDs using stable scoped-key templates; required confirmation/suggestion digests and original-run references; finding replacement/pipeline/delete/bulk rejection and permitted review updates; immutable finalized provenance; foreign-deployment job replay rejection; stored run/job scope/lease denial; and concurrent once-only budget period activation with future-period, foreign-dataset and permission-pause exclusions.
