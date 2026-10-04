# Server and Admin slimming

Prepared October 3, 2026 (America/New_York). Status: implementation specification; no runtime changes, production reads, deployments, or data deletions performed.

The Owner has requested deletion of the historical database, OperationalEvents and its dependent collections, Lead Conversations and its underlying data, the Admin Audit Log model, and the legacy outreach intelligence system. The retained interim Sales Intelligence surface is Numbers + RingCentral Accounts. The new Sales Outreach Desk is a separate deterministic model.

Read in this order:

1. [Specification](SPECIFICATION.md): scope, protected behavior, dependency surgery, interim contracts, and relationship to the new desk.
2. [Code map](CODE-MAP.md): inspected implementation seams and source evidence.
3. [Implementation plan](IMPLEMENTATION-PLAN.md): ordered work packages, acceptance tests, release gates, and cutover.
4. [Data deletion and storage runbook](DATA-AND-STORAGE.md): collection classification, exact-manifest deletion process, restore boundary, and capacity controls.
5. [Source inventory](SOURCE-INVENTORY.md): generated search inventory for follow-up implementation; references include retained callers and must not be treated as a deletion list.

Server repository: `jbell-rusty-vantage/vantage-movers-server`, inspected HEAD `becf8de02ed46aa6a4625e8188c299af6caa98ba`.
Admin repository: `jbell-rusty-vantage/vantage-admin`, inspected HEAD `0993e3151dd08fe4edea7baf348ad9339dacdbd5`.
These are local source revisions, not proof of deployed revisions. Server already had a modified `.gitignore`; both repositories already contained untracked Sales Outreach Desk preparation files. Those files were preserved.

Server owns this specification. The [Admin entry point](../../../vantage-admin/docs/server-admin-slimming/README.md) links here. Do not copy or modify the hashed Sales Outreach Desk packet as part of this planning task.

Authority: the Owner's October 3 slimming request controls these removals. The [Sales Outreach Desk specification](../sales-outreach-desk/SPECIFICATION.md) controls the replacement feature's policy, roles, evidence, and activation. The [Daily Operations contract](../../internal_hidden_docs/daily-operations/daily-operations-specification.md) controls the retained board. No slimming work changes that contract.

Planning verification: all local Markdown links in these new documents and the Admin entry point resolve. Source searches covered model namespaces, historical scope, OperationalEvents consumers, AI provider callsites, Admin audit writers, number/attachment producer coupling, schedules, and confirmed MCP/extension callers. Runtime tests and production data/capacity measurements have not been run; they are required implementation evidence in the plan. Existing source/runtime files and Sales Outreach Desk packet files were not changed.
