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
| 2 | S-AI / S-OUT: remove the LLM/media pipeline and the legacy outreach model | SLIM-06, SLIM-07 | pending |
| 2 | A-SI: interim two-view Sales Intelligence | SLIM-02/05 (admin) | pending |
| 2 | MCP: retire analysis and conversation tools | SLIM-06 | pending |
| 3 | Integration, adversarial review, replica proofs, docs | SLIM-09 | pending |
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
