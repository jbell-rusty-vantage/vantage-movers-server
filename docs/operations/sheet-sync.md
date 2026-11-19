# Operate Sheet Sync

This local CLI slice inspects Mongo evidence and runs the existing recovery proofs without loading the application or provider credentials. Production inspection and repairs are explicitly unsupported. The canonical [Sheet Sync service](../knowledge/services/sheet-sync.md) owns scheduling, identity, leases and recovery behavior; this runbook does not change those rules.

## Start and discover

Prerequisites: Node 24, pnpm 10.13.1 and `pnpm install --frozen-lockfile` in this checkout. No `.env` is needed. Help and service discovery require no database:

```text
pnpm vantage -- help
pnpm vantage -- services --json
pnpm vantage -- runbook sheet-sync stalled
pnpm vantage -- test sheet-sync --suite fast --json
```

Fast tests must report `passed`, a nonzero proof count and zero skips. The wrapper runs the existing `src/services/sheetSync/**/*.test.ts` suite with the standard test setup, under an allowlisted environment. Failure output is redacted from JSON; a nonzero exit is never reported as passing. On test failure, `evidenceFile` points to a uniquely created local temp log of the scrubbed synthetic child's output (bounded to 2 MB; owner-only mode where supported). Read that file to identify the failing assertion, fix the issue, and rerun the same CLI command. No raw parent environment or Mongo connection error is written to it. If local file creation fails, the command still fails without a log. Remove the file after diagnosis; logs are not automatically uploaded or committed.

## Inspect local evidence

`agent` means the fixed `127.0.0.1:27017` primary replica `rs0`, database `testvantagemovers_agent`. The [local agent guide](../../CLOUD_AGENTS.md) explains setup. `sheet-replica` means `127.0.0.1:27129`, primary replica `sheetRecoveryProof`, database `testvantagemovers_sheetrecovery`. The server must advertise exactly the numeric loopback address. Standalone, secondary, different replica identity or any discovered remote member is refused before application code loads.

```text
pnpm vantage -- doctor --json
pnpm vantage -- sheet-sync inspect --target local --json
pnpm vantage -- sheet-sync trace --job 000000000000000000000001 --target local --json
pnpm vantage -- doctor --profile sheet-replica --json
pnpm vantage -- sheet-sync inspect --target local --profile sheet-replica --json
```

`doctor` proves only primary identity and read access. `inspect` returns the newest 25 jobs, not queue totals or backlog health. `trace` takes the **SheetSyncJob `_id`**, not a Lead ID, follows canonical `job_id` attempts and their `run_id` references, and returns up to 25 attempts and runs. The literal ID above is a valid synthetic example; `job_not_found` is expected until that fixture exists. Replace it with a job ID from inspect when diagnosing work.

Each query has a two-second server budget and a scalar projection. History queries use a 26-row lookahead. Guard queries read up to three rows for two exact, indexed keys; customer values, error messages, spreadsheet identifiers and tombstones are not fetched. Truncation flags are explicit. Reads are separate observations, not a snapshot. Runs/attempts expire after 90 days, and no archive is queried. Missing or empty evidence never proves that delivery did not happen. A Mongo `synced` result is not an independent Google membership check.

Commands label evidence `partial` even if the sample is empty. `permission_denied`, `unknown`, `refused` and `unsupported` must not be interpreted as zero backlog. Stop on identity or permission failure. Do not switch to an inherited Atlas URI; no URI override is accepted.

## Reproduce interrupted delivery safely

Use a disposable single-node Mongo replica on `127.0.0.1:27129`, set name `sheetRecoveryProof`, advertising `127.0.0.1:27129`. The tool does not start, initiate or reconfigure Mongo. The existing harness owns only `testvantagemovers_sheetrecovery<PID>` and drops that database in its cleanup. Do not place other fixtures in that namespace. The diagnostic profile reads the base database, not the harness's short-lived PID database.

```text
pnpm vantage -- test sheet-sync --suite replica --json
```

The wrapper verifies primary/host identity and read access before starting the harness. A clean child environment removes inherited providers, Mongo targets, Node options, dotenv paths and arbitrary flags, forces local test mode and redirects dotenv to the OS null device. The harness mocks the workbook/provider and exercises real Mongo transactions, indexes, outbox, crashes/uncertainty and recovery. The result reports actual passing proofs and zero skips. This writes and deletes only synthetic local data; it does not qualify production delivery. As with any Node process, startup-level `NODE_OPTIONS` in the shell can execute before JavaScript begins; launch from a trusted shell. Child startup options are stripped.

## Stalled, retrying or uncertain work

Interpret the job, attempts and run together. A `completed` run means that drain finished, not that every job synced. A `retrying` job with a `deferred` append and `attempts: 0` still has an unresolved delivery obligation: deferral does not consume the ordinary failed-attempt budget. It does not prove that no provider request occurred or that the row is absent. A past `due_at` and expired job lease make the job a candidate for a later drain; they do not establish that the scheduler ran or that the global lease, topology fence and quota permit progress.

Read each deferred attempt's `deferral_reason`. A `structural_write_unconfirmed` reason records uncertainty in the drain's structural delivery. The same reason can propagate to later operations after the drain stopped sending. Individual attempts cannot establish which request reached Google. A `delivery_guard_stopped` reason records a request guard, `quota_budget_exhausted` records a denied reservation, and `destination_upsert_pending` records a delete held for its destination. Unrecognized or missing reasons are `unknown`. Error details stay inside Mongo.

Compare the attempt timestamp with `guards.observed_at`. A `held` topology fence blocks new drains at the observation time. A `held` drain lease prevents another drain from acquiring ownership. Expired leases or absent records describe only that read. The current UTC-minute quota sample gives user read/write reservation counts. The worker's effective configured budgets and remaining capacity are unknown. A current guard cannot establish what caused an earlier deferral. Neither lease expiry nor a due job proves the scheduler woke or a worker will run.

The authenticated Admin GETs under `/api/v1/admin/sheet-sync` expose `health` (queue-wide status aggregation), `jobs` and `runs` (paged records plus counts), and `runs/:id` (all attempts for one run). They lack these named guard observations and bounded redaction. The separate POST retry control requeues jobs and starts a drain. Production CLI diagnosis remains unsupported pending a deployment-bound read-only identity and verified permissions for the exact read operations; the local replica proof covers neither production credentials nor delivery.

1. Trace the known SheetSyncJob ID directly, or inspect the named target to find a recent job. Preserve the result and timestamp. Use the authenticated Admin surface for evidence within its scope.
2. For deferred structural delivery, preserve the job and attempt history. The next due drain reloads identity and reconciles uncertain appends/deletes. For topology/headers, check the canonical service's writer-fence and identity requirements before any operator correction.
3. For terminal failure, diagnose/correct the underlying issue, then use the existing reviewed Admin retry path with an explicit scope. This CLI supplies no repair, reset, lease bypass or generic Mongo command. Never reset processing rows to make a dashboard green.
4. Verify convergence with subsequent job/attempt evidence and an independently authorized Google membership check. Neither a sampled CLI result nor an offline test proves current provider delivery.

Rollback of this tooling is removal of its package entrypoint; it makes no schema changes. Runtime rollback remains the reviewed application revision procedure and retains outbox/attempt evidence. No deployment, provider sandbox call or production mutation is authorized by this runbook.

Exit codes: `0` completed command (check evidence status), `2` usage error, `3` unavailable/refused/permission denied, `4` unsupported production path, `5` test failure or missing proof. Use `--json` for one result document; for pipelines invoke `pnpm --silent vantage -- services --json` (or the desired command) to suppress pnpm's own script banner. Raw driver and subprocess errors are never printed.
