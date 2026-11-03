# Lead reporting and Best Relocation retirement

The owner requested the complete November 3 specification, including production backfills and permanent retirement, on `main`. Implementation, local proof, deployment, Mongo application, physical Sheet membership, and final reconciliation are separate states. This record must not claim completion while import conflicts or historical result gaps remain.

## Prerequisite and preserved contracts

The optimization release is `b60496d5fcec1e472237a9c51c1104766855beb8`. GitHub Actions run `41691481319` passed typecheck, full tests, build and production deployment. The owning handoff is the restricted local `vantage-main-server/scripts/output/granot-post-purge-handoff-20261103.md`, supported by `granot-storage-release-report-20261103.md`. Its completed historical purge finished November 3 at 19:00:04Z. Post-purge checks retained all 116 excluded chains, matched all 761 active Pool members, and restored all 39 sampled deleted observations. Future retention remains in shadow; its qualifying week and four-year runway are not established by this work. No retention policy, archive contract or purge cohort is changed here.

The original November 3 billing working-tree changes were integrated into the actual server `main` worktree at `vantage-storage-main`; the original dirty checkout was preserved. Corresponding billing behavior was already present on Admin `main` at `218129c`. The runtime owner remains the main server.

## Operator tooling

`ops/best-relocation-retirement/run.ts` defaults to read-only inspection. Raw snapshots, plans, annotations and per-row evidence belong in a restricted gitignored output directory. Never commit them. The source snapshot pins the external tracker and shared Booked Deal Form IDs from the specification rather than confusing the historical Source Company derivative with the external tracker. The source tracker is never written.

Run with the main server's existing environment from the checkout that owns its credentials. The exact invocation below uses the implementation worktree while retaining the original credential-relative working directory:

```powershell
node --env-file=.env --import tsx ../vantage-storage-main/ops/best-relocation-retirement/run.ts inspect --output-dir scripts/output/best-relocation-retirement
```

Modes:

- `inspect`: capture workbook identities, timezones, numeric tab IDs, actual headers, resolved cell values and deterministic identity sidecar; `--final-capture --deployment <full deployed SHA>` requires fresh deployment proof and the ingestion apply lease before quiescing/capture.
- `plan --source-snapshot <file> --deployment <SHA>`: preserve the frozen watermark; create checksummed source, preliminary Call, and topology plans. Account for out-of-window, out-of-scope, invalid and conflicting source rows.
- `migrate-tabs --tab-plan <file> --deployment <SHA>`: acquire the topology and drain fences, renew both through the 800-second old-invocation window, rename by numeric IDs and provision the canonical Bad Call Leads tab. Formula inspection/repair/readback must be recorded before release.
- `apply` / `resume --plan <source-plan> --call-plan <preliminary-call-plan> --checksum <source checksum> --expected-database vantagemovers --deployment <SHA> [--run-id <ObjectId>]`: apply only the frozen source phase. Save the run ID. Canonical commands and receipts are replayable from the start; per-action checkpoints are evidence, not permission to skip uncommitted dependencies.
- `plan-calls --plan <source-plan> --deployment <SHA>`: capture the final general Call plan **after** source Form/review changes, retaining the original November 1 04:00Z lower bound and frozen source watermark.
- `apply-calls --plan <source-plan> --call-plan <final-call-plan> --checksum <Call checksum> --expected-database vantagemovers --deployment <SHA> --run-id <run>`: apply audited Form Fill/result changes and independent projection intents under the lease.
- `drain`: deliver queued work using the normal bounded drainer; repeat while required work remains pending.
- `verify --plan <source-plan> --call-plan <final-call-plan> --run-id <run>`: inspect actual Mongo facts and per-ID Master tab membership. A receipt or queue publish is not delivery proof.
- `retire`: verify first, then persist the connection/company/source-ID retirement markers using the same lease. The explicit `--retire-with-incomplete-evidence` mode records **retired; final reconciliation incomplete** when conflicts remain; it never turns that state into a successful final ingestion.

The final source phase starts April 30, 2026 04:00Z; the general Call sweep starts November 1, 2026 04:00Z. Both use fixed through-watermarks. A newly captured/edited source requires an explicit tail plan. The second same-snapshot apply/verify must create no extra domain or financial records, revisions or physical rows. A repeated projection repair is safe but does not prove the first delivery succeeded.

## Local verification

The full server suite completed with 3,923 tests: 3,763 passed, 160 existing skips, zero failures. Focused ops and disposable-replica proofs run separately because the package test glob does not include these operator subdirectories. Subsequent operator-only hardening is checked with its focused tests and coordinated typecheck.

The focused policy suite covers New York boundaries and both DST hours, exact checker mapping, qualification precedence, Form Fill/duplicate/bad overlap, No-Sync, provider conflicts and protected provenance. Sheet tests cover all three Call destinations, opposite-tab cleanup by Mongo ID, physical duplicates, interrupted delivery, queued/direct agreement, warm-isolate title resolution and the writer fence. Insights tests preserve official Booking/Cancellation amounts while excluding duplicate/bad Call spend and retaining separate exception counts.

The disposable Mongo replica harnesses in this operator directory prove real transactions, durable command replay, outbox-failure rollback, stale lease/retirement rejection, source creation retirement and retained official Bookings. They use explicit loopback databases with `testvantagemovers` prefixes and never production credentials.

## Release evidence

Production commit/deployment references, final snapshot and plan hashes, run IDs, row accounting, financial differences, exact memberships, second-run proof, formula checks and retirement observation are added after execution. Until those entries exist, this document describes an implementation and operator contract only. Source conflicts and historical Call Log gaps must be listed explicitly even if runtime retirement is live.

Rollback preserves RingCentral-only qualification and Best Relocation no-create policies. Stop affected writers before correcting imported facts through audited same-source correction commands with expected revision and prior hash. Reproject from current Mongo; preserve official Bookings/Cancellations, qualification, receipts and historical evidence. Never automatically restart the retired ingestion path.
