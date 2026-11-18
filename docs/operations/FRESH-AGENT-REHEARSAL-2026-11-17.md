# Fresh-agent Sheet Sync rehearsal — November 17, 2026

The owner needs an unfamiliar agent to diagnose and prove a workflow from the repository alone. This rehearsal reached a bounded diagnosis of the seeded Sheet Sync job and passed the supported fast, CLI safety and real-replica proofs without private configuration. It did not repair the fixture, establish a particular deferral cause, or qualify live delivery. The next operational proof for a real stalled job would be authorized Admin evidence for its deferral and current drain conditions, followed by later durable outcomes and an independently authorized Google membership check.

## Scope and setup

- Checkout: `C:/Users/Pinda/AppData/Local/Temp/vantage-operability-rehearsal-ef78e52c`; tracked baseline `868db09443681753390c25d0e6cec2160a130795`, plus the supplied uncommitted implementation snapshot.
- Entry sequence: `AGENTS.md` → `docs/operations/README.md`, `CLOUD_AGENTS.md`, `docs/operations/sheet-sync.md` → canonical `docs/knowledge/services/sheet-sync.md`.
- Node `v24.18.0`; pnpm `10.13.1`, obtained with `node --version` and `pnpm --version`.
- Dependencies and both local Mongo fixtures were already provisioned by the coordinating agent. This rehearsal did not rerun installation, create/reconfigure/stop containers, or access another checkout or private environment file. It therefore verifies use of the prepared standalone checkout, not independent dependency or Docker provisioning.
- Read-only diagnostic observations occurred on November 17, 2026, approximately 17:41–17:43 UTC; `Get-Date -AsUTC -Format o` recorded `2026-11-17T17:42:58.0771731Z` after the trace.

## Commands and observed results

Commands ran from the checkout root. `pnpm` emits its normal script preamble before the CLI result; JSON below refers to the result document.

| Command | Result |
| --- | --- |
| `pnpm vantage -- help` | Exit 0; discovers services, doctor, local inspect/trace, fast/replica tests and runbook; explicitly excludes production inspection and repairs. |
| `pnpm vantage -- services --json` | Exit 0, `available`; only `sheet-sync` advertised, production and repair `unsupported`. |
| `pnpm vantage -- runbook sheet-sync stalled` | Exit 0, `available`, path `docs/operations/sheet-sync.md`. |
| `pnpm vantage -- doctor --json` | Exit 0, `ready`, scope `local_primary_identity_and_read_privilege_only`; `testvantagemovers_agent`, replica `rs0`, `127.0.0.1:27017`; providers `not_loaded`, application health `unknown`. |
| `pnpm vantage -- doctor --profile sheet-replica --json` | Exit 0, same bounded ready scope; `testvantagemovers_sheetrecovery`, replica `sheetRecoveryProof`, `127.0.0.1:27129`. |
| `pnpm vantage -- sheet-sync inspect --target local --json` | Exit 0, `partial`, newest-job sample limit 25, `more:false`; one synthetic job returned. |
| `pnpm vantage -- sheet-sync trace --job 000000000000000000000001 --target local --json` | Exit 0, `partial`, `job_found`; one deferred append and its completed run; no truncation indicated. |
| `pnpm vantage -- test sheet-sync --suite fast --json` | Exit 0, `{"status":"passed","suite":"fast","passed":78,"skipped":0,"effects":"offline test mocks"}`. |
| `pnpm test:vantage` | Exit 0; 17 tests passed, 0 failed/cancelled/skipped/todo. Covers local identity, inherited credential/startup/dotenv isolation, unsupported launch options, standalone onboarding links/glossary, Cloud configuration, CLI scope, projection/bounds/redaction and failure handling. |
| `pnpm vantage -- test sheet-sync --suite replica --json` | Exit 0, `{"status":"passed","suite":"replica","passed":7,"skipped":0,"effects":"isolated PID database created and dropped; synthetic workbook only"}`. |
| `pnpm typecheck` | Exit 0; `tsc --noEmit` completed with no diagnostics. |

## Diagnosis and limits

The supported trace returned:

```json
{
  "job": {
    "_id": "000000000000000000000001",
    "status": "retrying",
    "resource": "source_lead",
    "attempts": 0,
    "due_at": "2026-11-17T17:35:39.140Z",
    "leased_until": "1970-01-01T00:00:00.000Z",
    "createdAt": "2026-11-17T17:40:39.140Z",
    "updatedAt": "2026-11-17T17:40:39.140Z",
    "run_id": "000000000000000000000002"
  },
  "attempts": [{
    "_id": "000000000000000000000003",
    "job_id": "000000000000000000000001",
    "run_id": "000000000000000000000002",
    "action": "append",
    "status": "deferred",
    "createdAt": "2026-11-17T17:40:39.140Z"
  }],
  "runs": [{
    "_id": "000000000000000000000002",
    "status": "completed",
    "started_at": "2026-11-17T17:40:39.140Z",
    "finished_at": "2026-11-17T17:40:39.140Z"
  }],
  "limit": 25,
  "more_attempts": false,
  "more_runs": false
}
```

This establishes that the named synthetic Mongo job is recorded as retrying with an unresolved deferred append. Its due time is in the past and its job lease is expired at observation. The canonical service explains that deferrals do not burn ordinary failed attempts; `attempts:0` is consistent with a recorded deferred attempt. A completed run does not establish that every constituent job synced.

The projection does not identify the exact deferral reason, global drain lease, topology fence, quota, scheduler execution or current source document. Uncertain append delivery is a possible explanation, not an established root cause; guard/quota deferral cannot be excluded. The past due time is not proof of scheduler failure or a stuck lease. The fixture's due time also predates its creation time, so it is unsuitable for real backlog-latency measurements.

No trace result establishes whether a provider request occurred, whether an append was accepted, whether a row is missing/duplicated, or whether later delivery converged. These are separate reads with 25-row caps and 90-day attempt/run retention, not a snapshot or complete queue-health assessment. `more:false` only says the sampled query was not truncated. Doctor's ready result establishes local target identity and read access, not application health.

I preserved the fixture and its history. No Admin retry, direct job reset, arbitrary database repair, provider call or production access was attempted. An additional drain without provider fakes is not a supported proof in this scope.

## What the service proofs close

The fast suite proves mocked branch behavior. The seven real-replica proofs exercise the actual drainer with real Mongo transactions/indexes and a synthetic workbook:

1. Domain/outbox transaction rollback remains atomic.
2. Lost append response, duplicate claimed keys and overlapping jobs recover using fresh Mongo and deduplicated completion. The harness asserts one metadata update per drain for three subscribers and no second physical append.
3. Lost tombstone delete response recovers without deleting the adjacent row.
4. Same-key subscribers retain independent financial retry hints.
5. Confirmed destination/stale deletion followed by Mongo metadata failure remains retryable and recovers both subscribers.
6. A competing drain skips; lease takeover prevents old-owner finalization and a later owner recovers.
7. A topology fence acquired during delivery preserves stale membership until a later permitted drain reconciles.

These proofs use a separate PID-named database and do not resolve the seeded diagnostic job. They inject failures at code boundaries rather than killing an OS worker. They do not prove live Google delivery, production overlap frequency/cost, elapsed observation gates, actual hosted Cloud launch, or deployment status. I inspected the existing harness to interpret the returned proof count; I did not invoke extra legacy operational scripts.

## Onboarding improvement and remaining setup proof

A small interpretation gap was found: the runbook explained partial evidence and recovery rules, but did not explicitly reconcile a completed run, deferred append and zero failed attempts, or explain what due/lease fields cannot establish. Two paragraphs added to [the runbook](sheet-sync.md#stalled-retrying-or-uncertain-work) explain these exact cases and the deliberate absence of reason/global guard evidence. This documentation-only change neither expands diagnostic projections nor introduces repair authority.

No other setup blocker was encountered. Installation and Docker fixture bootstrap were supplied, so a fully unattended from-zero provisioning claim remains unproved. I did not launch the local API (`pnpm dev` / `pnpm dev:identity`) because the requested supported service diagnosis/proofs do not require an API listener; launcher safety has unit/subprocess coverage in `pnpm test:vantage`, while actual API readiness is not claimed here. No production, provider sandbox, hosted Cursor Cloud, general Form-create smoke test, commit, push or deployment was performed.
