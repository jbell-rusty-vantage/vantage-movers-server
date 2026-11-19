# Independent review — service operability, November 17, 2026

The owner needs a cheaper server and a dependable route from a clean checkout to service evidence. This review found no remaining blocking defect in the bounded Sheet Sync metadata change or the new local operator/launcher boundaries after the corrections below. The result is local implementation review, not deployment or production qualification. The fresh-context rehearsal and final default regression belong to the coordinating [qualification record](QUALIFICATION-2026-11-17.md).

## Reviewer separation and scope

The efficiency agent authored the metadata change and its proofs, then independently reviewed the CLI/setup agents' work: `ops/vantage/`, `ops/local-runtime.ts`, package/test/lint registrations, Cloud shell entrypoints, Dockerfile/environment definition and the task setup/runbook. It did not independently review its own persistence change. The root coordinator independently reviewed `persistDocSheetSync`, its tests and the replica harness and reported no blocking runtime issue.

Review used the current uncommitted `optimization/service-operability-2026-11-17` checkout based on `868db094`. The separate integrated capacity checkout was read only. No commit, push, production mutation or provider call was performed by this review.

## Findings corrected

1. **Replica verification before model loading.** The original recovery harness called application `connectMongo()` before checking the discovered replica. Mongoose auto-creation/indexing or replica discovery could therefore precede the safety check. Root requested correction; the harness now uses the shared local identity/environment contract, a native direct-connection PRIMARY/member preflight before runtime/model imports, disabled automatic model/index creation and a pinned direct-connection application URI. Explicit fixture writes start only afterward. This does not import any W6 runtime reclaim/retention behavior.
2. **Malformed advertised members.** The first shared `assertLocalHello` treated a present non-array `passives`/`arbiters` field as absent. The reviewer requested fail-closed validation. The CLI author now rejects malformed member-list fields, with explicit regressions in the boundary test.
3. **Disposable namespace and cleanup authority.** The recovery harness now refuses an already-existing PID-named database before importing models, preventing a reused PID from silently clearing a prior fixture. Both recovery and diagnostic replica harnesses verify the exact primary/member identity and owned namespace before cleanup. The diagnostics author added its final identity recheck in response to review.

## Consequential boundaries inspected

- Diagnostic discovery/help imports only operator modules, the native Mongo driver and Node APIs. It does not load app models or workers. Diagnostics use fixed local identities and direct connections, verify PRIMARY and all advertised members, and refuse production selection before connecting.
- Inspect/trace use bounded server-side scalar projections and time limits. Arbitrary stored statuses become `unknown`; errors, payloads, customer fields, sheet IDs and tombstones are not fetched. Trace joins canonical job/attempt/run IDs. Empty, truncated, expired or absent evidence remains explicitly partial. Permission failures cannot become healthy empty results.
- Child environments are allowlisted rather than merely stripping known secrets. Mongo/test/provider settings are explicit; inherited Node options, dotenv settings and arbitrary credentials do not flow into the child. The API runs in a temporary empty working directory. Startup-level options affecting the parent Node process remain outside JavaScript protection and are accurately documented.
- The launcher verifies replica identity before application import, refuses an occupied API port, verifies `/db` identity, observes child spawn/exit errors, terminates its owned child and removes its own temporary working directory. It does not overwrite `.env`. The local API is credential-isolated, not a network sandbox; explicit provider routes must remain outside this smoke path.
- Supported repairs and production diagnostics are explicitly absent. No generic Mongo command, lease reset, preview/apply bypass or authority expansion is added. The ordinary old scripts are not advertised as automatically safe.
- Cloud launch uses the same guarded launcher and Node 24 target as existing CI. Existing API acceptance checks `/db` and discloses that identity alone cannot attest its environment. A Dockerfile edit is not a completed image build or hosted-agent adoption.
- Package test and lint registrations include the new operator/launcher code. The recovery harness remains separately invoked for its durable proof; no default test is described as real Mongo coverage.

## Independent execution and limits

The efficiency reviewer independently ran:

```text
node --import tsx --import ./ops/test-setup.ts --test ops/vantage/cli.test.ts ops/local-runtime.test.ts
node --import tsx ops/vantage/diagnostics.replica.ts
```

The combined operator/launcher suite passed **14 tests with zero skips/failures**. It includes real scrubbed subprocesses and an on-disk hostile private `.env` sentinel, invalid primary/host/database identities, malformed members, invalid command scope, redacted errors, query bounds, partial read failure and help/doc discovery.

The diagnostics proof passed against the root-managed disposable Mongo fixture. Command monitoring recorded **five read commands**, hostile stored strings did not enter returned diagnostics, results truncated explicitly, and no collections were created by the diagnostic calls. Fixture setup/cleanup writes are separately scoped synthetic activity, not read-only diagnostic work. Permission refusal is exercised through injected errors, not a newly provisioned restricted Mongo user.

Metadata implementation verification separately passed six focused tests, the 160-test Sheet/Google/Admin/cron suite, and all seven actual recovery scenarios. The final guarded harness retained one append and three eventually synced jobs while reducing metadata updates from three to one per drain. [Efficiency evidence](../efficiency/sheet-metadata-2026-11-17.md) distinguishes exact before/after measurements from production cost claims. Whole-project typecheck and scoped runtime lint passed during the slice; the coordinator owns final integrated reruns after all concurrent edits.

This reviewer did not perform the API lifecycle launch, clean-snapshot fresh-agent rehearsal, hosted Cloud launch, container-image rebuild, live provider sandbox or production canary. Those proofs must be reported separately; none is inferred from unit or synthetic Mongo success. No schema migration or configuration change is needed for the metadata runtime change. Its rollback restores redundant writes while retaining existing job/attempt/metadata formats and recovery work.

## Final configuration-test review

The broad regression later found one existing test that assumed the default test database while inheriting the explicitly isolated `TEST_MONGO_DATABASE_NAME`. Root scoped that variable to absent for the default test and added an isolated-override test. The CLI author independently reviewed this test-only correction and found no masked runtime change: `runtime.ts` is unchanged, exact default/production expectations remain, the override must be ignored outside TEST_MODE, and `withEnv` restores inherited values in `finally`. Nine focused runtime tests passed; the final whole-suite result is recorded by the coordinator.
