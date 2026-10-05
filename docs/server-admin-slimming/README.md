# Server and Admin slimming

Prepared October 3, 2026 (America/New_York) as an implementation specification; at that point no runtime changes, production reads, deployments or data deletions had been performed. It was executed, deployed and purged on October 4, 2026: see **Execution status** below.

The Owner has requested deletion of the historical database, OperationalEvents and its dependent collections, Lead Conversations and its underlying data, the Admin Audit Log model, and the legacy outreach intelligence system. The retained interim Sales Intelligence surface is Numbers + RingCentral Accounts. The new Sales Outreach Desk is a separate deterministic model.

Read in this order:

1. [Specification](SPECIFICATION.md): scope, protected behavior, dependency surgery, interim contracts, and relationship to the new desk.
2. [Code map](CODE-MAP.md): inspected implementation seams and source evidence.
3. [Implementation plan](IMPLEMENTATION-PLAN.md): ordered work packages, acceptance tests, release gates, and cutover.
4. [Data deletion and storage runbook](DATA-AND-STORAGE.md): collection classification, exact-manifest deletion process, restore boundary, and capacity controls.
5. [Source inventory](SOURCE-INVENTORY.md): generated search inventory for follow-up implementation; references include retained callers and must not be treated as a deletion list.
6. [Execution ledger](LEDGER.md), [evidence](evidence/) and the [deletion manifest](DELETION-MANIFEST.md): what was implemented (branch `slim/server-admin`, now merged to `main`), verified and still owed.
7. [Cutover runbook](CUTOVER.md): the ordered deploy, old-deployment removal, fence, quiet-snapshot, purge and recreation-check steps with exact commands. Why the old deployments must go first is in the [pre-deploy audit](evidence/PREDEPLOY-AUDIT.md).
8. [New-desk contract delta](NEW-DESK-DELTA.md): what the Sales Outreach Desk coordinator must record (deleted evidence, retired `/outreach/:id` ids, inert human facts, retained authorities).

**Execution status (2026-10-04):** shipped and purged. All four waves are merged to `main` and deployed: server `6123f85e` (live T0 2026-10-04T22:19:00Z), Admin `058adbc`, MCP `bd93b18`. The pre-slim deployments were removed, legacy jobs were fenced, and the production purge ran as `slimming-purge-2026-10-04T22-36-23-489Z` (evidence committed in server `ecc76257`: the [ledger](LEDGER.md) "Cutover" section and [`evidence/PURGE-APPLY.log`](evidence/PURGE-APPLY.log)). The recreation check at +0 found nothing. **Still owed:** the recreation checks at +30 min, +2 h and +1 day ([CUTOVER.md](CUTOVER.md) §9); a look at the index size, which rose from 158.8 MB to 193.8 MB; the SLIM-11 capacity work; and deleting the retired environment names from Vercel ([CUTOVER.md](CUTOVER.md) §10, listed in [`docs/knowledge/environment.md`](../knowledge/environment.md)). The ledger is authoritative for status. The Service docs under `docs/knowledge/` describe the slim code: removed capabilities are kept as `status: retired` stubs (`pnpm okf:query --status retired`).

Server repository: `jbell-rusty-vantage/vantage-movers-server`, inspected HEAD `becf8de02ed46aa6a4625e8188c299af6caa98ba`.
Admin repository: `jbell-rusty-vantage/vantage-admin`, inspected HEAD `0993e3151dd08fe4edea7baf348ad9339dacdbd5`.
These are local source revisions, not proof of deployed revisions. Server already had a modified `.gitignore`; both repositories already contained untracked Sales Outreach Desk preparation files. Those files were preserved.

Server owns this specification. The [Admin entry point](../../../vantage-admin/docs/server-admin-slimming/README.md) links here. Do not copy or modify the hashed Sales Outreach Desk packet as part of this planning task.

Authority: the Owner's October 3 slimming request controls these removals. The [Sales Outreach Desk specification](../sales-outreach-desk/SPECIFICATION.md) controls the replacement feature's policy, roles, evidence, and activation. The [Daily Operations contract](../../internal_hidden_docs/daily-operations/daily-operations-specification.md) controls the retained board. No slimming work changes that contract.

Planning verification: all local Markdown links in these new documents and the Admin entry point resolve. Source searches covered model namespaces, historical scope, OperationalEvents consumers, AI provider callsites, Admin audit writers, number/attachment producer coupling, schedules, and confirmed MCP/extension callers. Runtime tests and production data/capacity measurements have not been run; they are required implementation evidence in the plan. Existing source/runtime files and Sales Outreach Desk packet files were not changed.
