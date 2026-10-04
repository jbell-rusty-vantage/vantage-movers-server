# Slimming execution ledger

Execution started 2026-10-03. The Owner and the user authorized implementation and the physical Mongo deletion. Deletion runs once, from [`DELETION-MANIFEST.md`](DELETION-MANIFEST.md), after the slim server and Admin are deployed. If it ran before the deploy, the old code would recreate the collections.

## Baseline

| Repo | Branch | Base commit | Notes |
| --- | --- | --- | --- |
| vantage-main-server | `slim/server-admin` | `6a374fab` (main, 2 docs commits ahead of origin `becf8de0`) | `feat/sales-rep-tracker` is not merged, so it is out of scope |
| vantage-admin | `slim/server-admin` | `adda9e1` | The user's uncommitted Sales Outreach Desk packet edits are preserved and not touched |

Baseline typecheck and test outputs are in [`evidence/BASELINE.md`](evidence/BASELINE.md).

## Lanes

Each lane writes `evidence/<lane>.md`. Lane agents never commit. The coordinator commits once each wave is green.

| Wave | Lane | Plan package | Status |
| --- | --- | --- | --- |
| 1 | S-HIST: server historical removal | SLIM-03 | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | S-GRANOT: Granot Health state, provenance, receipt search/live removal | SLIM-04.1, SLIM-02 (server) | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | S-OBS: remove OperationalEvents callsites, extract invitation mail config | SLIM-04 | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | S-NUM: independent Numbers/Accounts reads and nominations | SLIM-05 | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | A-DEST: Admin destinations, audit log, Live Events, Granot receipts | SLIM-02, SLIM-08 | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | A-OPS: Admin scope removal and operational list cleanup | SLIM-03 (admin) | done: server `de0fe15f`, Admin `baeb21c` |
| 1 | DATA: read-only production inventory, deletion manifest, purge tool | SLIM-01, SLIM-10 prep | done: server `de0fe15f`, Admin `baeb21c` |
| 2 | S-AI / S-OUT: remove the LLM/media pipeline and the legacy outreach model | SLIM-06, SLIM-07 | done: server `9007f43f` |
| 2 | A-SI: interim two-view Sales Intelligence | SLIM-02/05 (admin) | done: Admin `cdc9510` |
| 2 | MCP: retire analysis and conversation tools | SLIM-06 | done: MCP `97bd755` |
| 3 | Integration, adversarial review, replica proofs, docs | SLIM-09 | done: server `709480d3`, Admin `474f662`, MCP `bd93b18`; see evidence REHEARSAL, WALK, COMPLETENESS |
| 4 | Deploy, quiesce, purge | SLIM-10 | pending (needs the user's go) |

## Wave 1 result (2026-10-04)

The workflow run is `wf_cd3bd658-bc8`. The host crashed twice from memory exhaustion, and the run was resumed from cached agents.

| Repo | Typecheck | Unit tests | Lint |
| --- | --- | --- | --- |
| server | 0 errors | 3,146 tests, 3 failures, all load or timing related (each file passes alone); the baseline had 34 | clean |
| Admin | 0 errors | 1,080 tests, 0 failures (52 tests left with the retired surfaces) | the same 26 problems as the baseline, none new |

Replica proofs were not run because the Docker `csi01` replica hung: Granot lifecycle sweep, numbers-slim, purge apply rehearsal. Coordinator decisions:
- The Daily card links to `/live-events` and `/observational` were removed. Only the links changed; facts, colours, counts and timing did not.
- Admin-role Sheet Sync retry is denied at the proxy, because its only UI was Observational. The Owner and the server route are unchanged.

Loss to report to the user: lane S-HIST deleted the gitignored local `scripts/historical/` and `scripts/historical_production_db_staged_merge_ingestion/`, including local audit reports. No copy was found.

## User decisions (2026-10-04)

- Deletion of the local gitignored historical scripts and reports is accepted.
- Ship the slim server, Admin and MCP after wave 3.
- No recovery copy of the conversation audio. Run the purge with `--skip-blob-backup`, so the Blob audio objects are deleted without a backup. The Mongo targets are still backed up.
- Purge window: about 15 to 30 minutes after the deploy instead of 48 hours. Before the deploy, run a final no-writer / no-recreation audit. Purge only when all of these hold:
  - the live commit is verified;
  - job recovery has fenced every legacy job (zero runnable or leased);
  - two inventory snapshots about 10 minutes apart show zero growth and no write after the deploy;
  - added by the pre-deploy audit: every pre-slim server and Admin deployment has been removed (CUTOVER step 3b), and the purge runs with the old-deployment gate. That gate requires `--cutover-at`, `--quiet-since`, and either `--old-deployments-removed=<dpl ids>` or `--old-deployments-kept` after T0 + 24 h 58 min. It aborts on any write to a target at or after `--quiet-since`, at step (a) and immediately before every drop.

  Then check for recreation at +30 minutes, +2 hours and +1 day, and re-drop idempotently if a collection reappears.

## Wave 2 and 3 results (2026-10-04)

- **Wave 2 (`wf_29ce7e57-670`).**
  - Server: typecheck 0 errors, 2,592 unit tests with 0 failures, lint clean.
  - Admin: 0 failures, and `next build` passes.
  - MCP: 33/33 tests pass.
  - The `ai`, `@ai-sdk/gateway`, `@ai-sdk/mcp` and `openai` packages are removed.
- **Wave 3 (`wf_198c94ce-4c2`).**
  - Replica proofs: the retired-stage fence, numbers-slim (Numbers with every retired collection absent) and the Granot lifecycle sweep (146/146) all pass on a native `csi01` replica. Docker Desktop was broken, and the user approved quitting it.
  - Purge `--rehearsal`: apply, verify (132/132), restore and resume all pass on synthetic data.
  - Browser walk: all 22 retained pages render, and the retired URLs return 404 or redirect as specified.
  - Fixes: three Admin review findings, plus two server index bugs (the Agent username unique partial index, and the processed-calls index check).
  - The full server suite has 2,599 tests and 0 failures.
- **Completeness gaps** are in `evidence/COMPLETENESS.md`. The coordinator accepts these limits for the interim cut:
  - no rehearsal on a production-shaped dataset;
  - no storage or latency comparison;
  - `finish-work --provider codex` was not run, because the codex CLI is not installed here;
  - Daily Operations behavior is proven only by byte-identical server code, a link-only Admin change and rendering in the walk;
  - SLIM-11 capacity work is deferred until after the purge.
- **Pre-deploy audit** is run `wf_1934d4ac-26c` (no-writer/no-recreation audit, purge hardening, CUTOVER.md).

## Lane HARDEN and the pre-deploy audit (2026-10-04, run `wf_1934d4ac-26c`)

Nothing is committed yet: the coordinator commits.

- **HARDEN.**
  - Cleanup C7 unsets `call_interactions` pointers into `lead_conversations`: `recording_discovery` and `recordings.$[].lead_conversation_id`.
  - Purge-safety fixes:
    - the manifest scope is re-derived from `policy.ts` on every run;
    - documents a cleanup mutates are backed up first;
    - `--resume` re-verifies the backups;
    - Blob deletes take a fresh listing and delete exact keys only.
  - New read-only `ops/slimming/cutover-check.ts`, which does the Agent duplicate check, the snapshots with compare, and the recreation check.
  - New docs: `CUTOVER.md`, `NEW-DESK-DELTA.md`, `evidence/ENDPOINTS.md`. `evidence/HUMAN-FACTS.md` was corrected.
  - The rehearsal is in `evidence/REHEARSAL.md` §8.
- **Pre-deploy audit.** Four findings were confirmed 3 of 3: raw-driver-1, producers-schedules-1, producers-schedules-2 and old-deployments-1. They share one cause. Pre-slim deployments keep receiving queue messages pinned to them for up to 24 h and run old code, which writes `operational_events` (and incidents, notifications, `outreach_*`, Blob `conversations/`). The old Admin writes `admin_audit_logs`.
  - Fixed in CUTOVER:
    - step 1.4 inventories the deployments;
    - step 3b removes the old deployments;
    - snapshot 2 waits until at least Tr + 800 s;
    - recreation checks run at +0, +5 min, +30 min, +2 h and +1 day.
  - Fixed in code: the `purge.ts` old-deployment and late-write gate (`ops/slimming/lib/write-gate.ts`), with 8 unit tests and a loopback rehearsal. Details are in `evidence/PREDEPLOY-AUDIT.md`.
  - The Admin preview launcher `scripts/csi07-local.mjs` now starts the server's `ops/dev-server.ts`.
