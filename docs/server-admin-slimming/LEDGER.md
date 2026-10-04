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
| 1 | S-HIST: server historical removal | SLIM-03 | pending |
| 1 | S-GRANOT: Granot Health state, provenance, receipt search/live removal | SLIM-04.1, SLIM-02 (server) | pending |
| 1 | S-OBS: remove OperationalEvents callsites, extract invitation mail config | SLIM-04 | pending |
| 1 | S-NUM: independent Numbers/Accounts reads and nominations | SLIM-05 | pending |
| 1 | A-DEST: Admin destinations, audit log, Live Events, Granot receipts | SLIM-02, SLIM-08 | pending |
| 1 | A-OPS: Admin scope removal and operational list cleanup | SLIM-03 (admin) | pending |
| 1 | DATA: read-only production inventory, deletion manifest, purge tool | SLIM-01, SLIM-10 prep | pending |
| 2 | S-AI / S-OUT: remove the LLM/media pipeline and the legacy outreach model | SLIM-06, SLIM-07 | pending |
| 2 | A-SI: interim two-view Sales Intelligence | SLIM-02/05 (admin) | pending |
| 2 | MCP: retire analysis and conversation tools | SLIM-06 | pending |
| 3 | Integration, adversarial review, replica proofs, docs | SLIM-09 | pending |
| 4 | Deploy, quiesce, purge | SLIM-10 | pending (needs the user's go) |
