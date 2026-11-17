# Exact release validation — November 17, 2026

The isolated W0 forecast and W5 bounded persistence release passes its application checks. Production load qualification, W1 observation windows and the production build/deployment gates are separate. The broad capacity implementation worktree is not this release.

The frozen [source hashes and validation results](evidence/qualified-release-gates-2026-11-17.json) cover 1,776 source, operator and configuration paths at base `491ab2a03d6f2706b6ecf5f75a62cd2a266f37da`; every path remained unchanged through these checks. The later build-only workflow is recorded with its own hash and independent review, not represented as tested application code.

| Check | Actual result |
| --- | --- |
| Complete offline suite, concurrency 2 | 4,024 discovered; 3,848 passed; 176 gated skips; zero failures/cancellations; child exit 0 |
| Whole-project TypeScript | Exit 0 |
| Package correctness lint / diff check | Both exit 0 |
| W5 persistence, workflow and apply | 20 passed; zero skipped/failed; exit 0 |
| W5 full worker crash, unchanged expiry and closure | 3 passed; zero skipped/failed; exit 0 |
| Granot lifecycle and transactional Sheet outbox replicas | 150 passed (110 + 40); zero skipped/failed; exit 0 |
| Release proof bootstrap lint | Zero errors/warnings; unchanged repository rules extended in memory |

The lifecycle run used the exact release tests and unchanged launcher, with explicit synthetic `SALES_INTELLIGENCE_DEPLOYMENT_ID=qualified-release-local-proof`. The launcher requires this dataset value but its baseline fixture configuration does not supply it. A redundant invocation without that synthetic value was already queued; its result is preserved separately and is not substituted for this successful proof. No production credential was used. Both checkout roots have no `.env`; the bootstrap also strips provider/Mongo values and pins a nonexistent dotenv file.

Every opt-in skip is listed in [the skip inventory](evidence/qualified-skipped-tests-2026-11-17.json). Relevant W5 and lifecycle coverage was executed separately; unrelated existing optional replica groups remain skipped. Synthetic provider transport and local transactions cannot prove real provider availability, natural-slot behavior, fleet load or production storage savings.

No production data, TTL, indexes, retention cutoff, purge policy or approval expiry was changed by this validation. The tests use verified loopback `capacityp1` and disposable synthetic databases. Sample production-export restoration is documented separately and is not an application replay proof. Rollback remains compatible with the unchanged run/receipt shapes and existing expiry behavior.

This report and its frozen manifest are immutable release evidence. Record later deployment, health, extra harness results or integrated-worktree rechecks in new evidence files.
