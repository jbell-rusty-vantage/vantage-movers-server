# Operate Sheet Sync

This local CLI slice inspects Mongo evidence and runs the existing recovery proofs without loading the application or provider credentials. Its one production path is the read-only placement check, `sheet-sync reconcile --production-read` ([below](#check-placement-in-both-directions-reconcile)). Every other production inspection, and every repair, is unsupported. Agents start from the Sheet Sync agent profile. It has the same content for Claude Code ([`.claude/agents/sheet-sync.md`](../../.claude/agents/sheet-sync.md)) and Codex ([`.codex/agents/sheet-sync.toml`](../../.codex/agents/sheet-sync.toml)), and a test in `ops/vantage/cli.test.ts` keeps the two identical. The canonical [Sheet Sync service](../knowledge/services/sheet-sync.md) owns scheduling, identity, leases and recovery behavior; this runbook does not change those rules.

## Start and discover

Prerequisites: Node 24, pnpm 10.13.1 and `pnpm install --frozen-lockfile` in this checkout. No `.env` is needed. Help and service discovery require no database:

```text
pnpm vantage -- help
pnpm vantage -- services --json
pnpm vantage -- runbook sheet-sync stalled
pnpm vantage -- test sheet-sync --suite fast --json
```

Fast tests must report `passed`, a nonzero proof count and zero skips. The wrapper runs the existing `src/services/sheetSync/**/*.test.ts` suite, excluding opt-in `*.replica.test.ts` files (whose offline skip would fail the proof), with the standard test setup, under an allowlisted environment. Failure output is redacted from JSON; a nonzero exit is never reported as passing. On test failure, `evidenceFile` points to a uniquely created local temp log of the scrubbed synthetic child's output (bounded to 2 MB; owner-only mode where supported). Read that file to identify the failing assertion, fix the issue, and rerun the same CLI command. No raw parent environment or Mongo connection error is written to it. If local file creation fails, the command still fails without a log. Remove the file after diagnosis; logs are not automatically uploaded or committed.

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

## Check placement in both directions (reconcile)

`reconcile` checks that every Lead, Booking and Cancellation that should have a Master Sheets row is on exactly its expected tab, and that every row resolves to a record that belongs there. The expected tab is the server's own rule, `planExpectedSheetTabs` (the function Admin Sheet Contains uses), so the tool never forks routing.

```text
pnpm vantage -- sheet-sync reconcile --sheet-snapshot <file.json> [--tab "<tab>"] [--samples <n>] [--json]
pnpm vantage -- sheet-sync reconcile --production-read [--tab "<tab>"] [--samples <n>] [--json]
```

For each of the eight tabs it reports counts, a breakdown and up to `--samples` (default 25) Mongo IDs with row numbers for:

| Category | Meaning |
|---|---|
| `missing` | The record is expected on this tab and has no row here. |
| `wrong_tab` | The row's record is reportable but expected on another tab (listed in `expected`). |
| `duplicate` | The same Mongo ID is on more than one row of this tab. |
| `orphan` | No Form Lead, Call Lead, Booking or Cancellation holds this Mongo ID (`no_record`), or the cell is not an ObjectId (`invalid_mongo_id`). |
| `excluded` | The record exists but no row is expected anywhere: `missing_call_reporting_admission`, `created_on_unmatched` or `no_sync`. |

Rows with a blank Mongo ID cell (managed cells cleared, operator content kept) are counted as `blank_id_rows`, not classified. A tab whose identity cannot be read (`sheet_identity_header_invalid`, `sheet_identity_rows_invalid`), or that is absent, reports `null` counts: an unreadable tab never proves absence. `managed_headers_match: false` means delivery to that tab would be refused with `sheet_identity_header_rewrite_unsafe`.

**Calls and Duplicate Calls are report-only.** They are labelled Owner-managed and carry no repair suggestion (Owner directive, November 20: no Calls-tab backfill, repair job or major change). Bad Call Leads gets no repair suggestion either, because a Call Lead re-delivery also removes Calls and Duplicate Calls rows. On the other tabs each category names its next step. Every step requires Owner approval, and queueing uses `enqueueSheetSyncJob(..., { createdBy: "script" })`.

**Read-only by construction** (`ops/vantage/read-only-sources.ts`):

- **MongoDB:** a frozen wrapper whose only method runs `find` with an empty filter and an inclusion projection, on `form_leads`, `call_leads`, `booked_leads` and `cancelled_leads`. It projects routing flags and `ingestion_origin` only, never contact fields.
- **Google Sheets:** the production client uses the `https://www.googleapis.com/auth/spreadsheets.readonly` scope, so Google itself refuses writes. The wrapper calls only `spreadsheets.get` (tab titles) and `spreadsheets.values.get` (row 1 and the Mongo ID column).
- **Tests:** `ops/vantage/cli.test.ts` uses recording proxies to prove that no other Mongo or Sheets method is reachable. It also scans the three reconcile modules for write calls and writer imports.

**Targets.**

- **Local (default):** the `rs0` agent replica (`127.0.0.1:27017`, `testvantagemovers_agent`, with the same identity checks as `inspect`), plus a workbook snapshot file: `{ "master_leads": { "Forms": [[header…], [row…]] }, "master_booked": { "Booked Deals": … } }`. `--sheet-snapshot` is required, because the CLI loads no Google credentials locally.
- **Production:** `--production-read` is required; `--target production` alone exits 4.
  - **What it reads from `.env`:** only named keys from this checkout's `.env`: `TEST_MODE` (which must be `false`), `MONGO_URI`, `MONGO_DNS_SERVERS`, `MASTER_LEADS_SHEET_ID`, `MASTER_BOOKED_SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON`. It never copies them into `process.env` and never prints their values.
  - **Read plan:** before any read it prints the plan on stderr: database `vantagemovers`, each collection with its projected fields, the Sheets scope and calls, and each workbook (ID suffix only) with its tabs.
  - **Mongo connection:** reads use `secondaryPreferred` and the app name `vantage-cli-sheet-reconcile-readonly`.
  - **The `.env` copy:** copy `.env` into your own worktree only for the run, confirm `git check-ignore .env`, and delete it afterwards. `src/services/crm/crmConfig.ts` loads `.env` through `dotenv/config`, so tests run in that worktree would load it too.

Sheets are read before Mongo, so a record created between the two reads can only appear as `missing`, never as an `orphan`. The reads are not a snapshot: a record saved within one drain cycle (about five minutes) of the run can show as missing. Source Company Sheets and the retired titles Duplicates, Bad Leads and Bad Calls are not read.

**Production baseline, November 21, 22:03 UTC** ([evidence](evidence/sheet-sync-reconcile-2026-11-21T22-03-16Z.json); IDs, rows and reason codes only). The run read 12,291 records.

- **Exact tabs:** six tabs placed every row and missed none, with no duplicates, orphans or blank IDs: Forms (7,846 rows), Duplicate Forms (193), Bad Form Leads (1,035), Bad Call Leads (19), Booked Deals (1,080) and Cancelled Deals (14).
- **Owner-managed tabs:** every remaining difference is on Calls and Duplicate Calls. Each matches the [COVERAGE](../knowledge/lead-lifecycle/COVERAGE.md) list and the November 20 handoff exactly:

| Tab | Missing | Wrong tab | Excluded |
|---|---:|---:|---:|
| Calls | 55 (31 `legacy_unknown`, 24 `ringcentral`) | 1 (row 317, a Form Fill Call expected on Duplicate Calls) | 203 (`missing_call_reporting_admission`) |
| Duplicate Calls | 4 (the row-317 Call and 3 Form Fill Calls on no tab) | 0 | 6 (`missing_call_reporting_admission`) |

Since COVERAGE's November 20 13:50 run, the only change is new records, and every one of them was placed:

- Forms rose from 7,816 to 7,846.
- Duplicate Forms rose from 192 to 193.
- Placed Calls rose from 1,402 to 1,407.
- Booked Deals rose from 1,072 to 1,080.

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

Rollback of this tooling is removal of its package entrypoint; it makes no schema changes. Runtime rollback remains the reviewed application revision procedure and retains outbox/attempt evidence. No deployment, provider sandbox call or production mutation is authorized by this runbook. The reconcile's production read is read-only and authorizes no repair.

Exit codes: `0` completed command (check evidence status), `2` usage error, `3` unavailable/refused/permission denied, `4` unsupported production path, `5` test failure or missing proof. Use `--json` for one result document; for pipelines invoke `pnpm --silent vantage -- services --json` (or the desired command) to suppress pnpm's own script banner. Raw driver and subprocess errors are never printed.
