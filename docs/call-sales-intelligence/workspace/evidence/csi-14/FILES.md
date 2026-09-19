# CSI-14 file ownership and baseline

Observed before edits:

```text
repository: C:\Users\Pinda\Proyectos\vantage\vantage-main-server
branch: sales-intelligence
HEAD: 3355c6dcf68ed2c092824dc1dbb87c71a3f0c343
origin: https://github.com/jbell-rusty-vantage/vantage-movers-server.git
working tree: dirty (preceding CSI-10 changes)
```

The actual baseline was recorded; the task did not require it to equal a historical hash or require a clean checkout. No branch switch occurred. CSI-14 was claimed in LEDGER before implementation edits.

## Existing work preserved

Initially modified: CSI `02-domain-models.md`, `03-server-pipeline-and-jobs.md`, `04-server-routes.md`, workspace `CONTRACTS.md`, `LEDGER.md`, `teams/c-outreach.md`, catalog `docs/index.md`, Outreach Service, `package.json`, CSI configuration, model infrastructure, Owner/cron routes, `numberActivity/jobDispatch.ts`, conversation eligibility, CSI jobs, Outreach ensure, validation.

Initially untracked: CSI-10 evidence directory, Rep Identity Service, identity replica runner/test, and `src/services/salesIntelligence/repIdentity/**`. These are preceding CSI-10 work, not new CSI-14 implementation. Only the explicitly coordinated person-ID input/DTO and Service description were added to that consumer boundary. No preceding work was reset, cleaned, reverted or committed.

## Owned additions

- `src/services/salesIntelligence/nudges/adapters.ts`: narrow injectable transport, sender/Direct checks, single-attempt POST and exact receipt reads.
- `commands.ts`: Owner preview, durable send intent, explicit submission boundary, rate admission, audit/finalization.
- `eligibility.ts`: authoritative identity and Outreach checks, customer evidence guard and channel/template admission.
- `templates.ts`: versioned masked templates and edited body validation.
- `reads.ts`: pure history pagination and DTOs.
- `repair.ts`: bounded durable job recovery and reconciliation-only worker.
- `nudges.test.ts`, `routes.test.ts`: fake transport, contracts, signed Owner routes and authenticated cron proof.
- `scripts/test-csi-nudges.ts`, `scripts/test-csi-nudges.replica.test.ts`: disposable replica concurrency/crash/integration proof.
- `docs/knowledge/services/sales-intelligence-nudges.md` and this evidence directory.

## Coordinated additive changes

- `src/models/OwnerRepNudge.ts`: durable metadata on the existing collection/indexes.
- `src/models/salesIntelligence/infrastructure.ts`, `src/services/salesIntelligence/transactions.ts`: nudge audit kind.
- `src/config/domain/salesIntelligence.ts`: repair stage, bounded error codes and configuration accessor.
- `src/validation/v1/salesIntelligence.ts`: optional selected followup and explicit fallback authorization; Owner-reviewed messaging person ID.
- `src/services/salesIntelligence/repIdentity/reads.ts`: optional reviewed messaging person ID in the existing DTO.
- `src/services/salesIntelligence/policy.ts`: optional session for coherent policy reads.
- `src/services/salesIntelligence/outreach/reads.ts`, `outreach/timeline.ts`: read-only nudge page in detail and existing timeline composition.
- `src/routes/sales-intelligence-admin.routes.ts`, `src/routes/sales-intelligence-cron.routes.ts`, `src/services/numberActivity/jobDispatch.ts`: additive Owner endpoints and repair-only registration.
- `package.json`, `vercel.json`: isolated test script and five-minute authenticated repair schedule.
- CSI domain/routes/pipeline docs, shared contracts/ledger/Team C file, Outreach/Rep Identity/Number Activity Services and catalog: integration/handoff pointers.

The dashboard, MCP tools, official Lead/Booking/Cancellation writers, Agent/Extension User models and production configuration were untouched. The quality checkpoint inventory includes older changes relative to its persisted baseline; it is not this task's ownership inventory.
