# Best Relocation and Reporting — Stage 1 Handoff Evidence

Status: implemented  
Implementation source: `best-relocation-stage-1-shared-foundations.md`

## Public interfaces

Shared durable-work exports:

- `src/services/durableWork/index.ts`
  - canonical JSON and SHA-256 checksums;
  - durable actors and audit envelopes;
  - effective-capability resolution;
  - provider failure classification and bounded retry/defer policy;
  - fenced lease, checkpoint, transition, and queue wake-up contracts;
  - Mongoose schema field builders and in-memory contract fakes.

Operational-workbook safety exports:

- `src/services/operationalWorkbooks/index.ts`
  - static registrations;
  - production completeness assertion;
  - exact spreadsheet-ID normalization and masking;
  - fail-closed reporting-destination evaluation;
  - immutable registration composition for later stages.

Canonical command exports:

- `src/services/domainCommands/index.ts`
  - `createFormLead`;
  - `createCallLead`;
  - `updateSourceOwnedLead`;
  - `createBookingFromLead`;
  - `createLeadlessBooking`;
  - `attachBookingToLead`;
  - `createCancellation`;
  - `canonicalDomainCommands`.

The command seam has no Express or Google dependency. It validates through the
existing v1 Zod schemas and reuses the existing lead, booking, cancellation,
and reconciliation implementations so Registry attribution, import guards,
customer/merchant/agent resolution, Sheet Sync intents, and post-commit effects
remain in one implementation.

Existing API-secret and scoped-key mutation routes remain on their legacy HTTP
adapters because the Stage 1 actor contract has no API-client actor type.
They share the same domain implementations and remain covered by the full
regression suite, but do not create `DomainCommandExecution` records. This is
an explicit compatibility decision: extending `DurableActor` or falsely
attributing those clients to an owner/ingestion worker was rejected. Stage 2
workers must use the direct canonical command seam and may not use HTTP
loopback.

## Durable command execution

`src/models/DomainCommandExecution.ts` persists the command outcome in the same
Mongo transaction as the canonical mutation and queued Sheet Sync intent.

Unique indexes:

```text
domain_command_executions:
  (origin, idempotency_key) unique
  command_id unique

sheet_sync_leases:
  scope unique
  leased_until
```

`runSheetSyncWrite` forces a transaction when a canonical command is active.
Before that transaction commits, it persists the command entity references and
warnings. Reuse with the same command and payload checksum returns
`already_applied`; command/checksum mismatch rejects. Duplicate-key races read
and return the winning durable outcome.

The existing Sheet Sync lease adapter now uses the shared epoch-fenced store.
Acquire/reclaim increments `lease_epoch`; renew, assert, and release require the
current scope/owner/epoch token.

## Status-graph examples

Owning stages declare their graph when constructing `MongoDurableRunStore` or
`InMemoryDurableRunStore`. The shared store refuses transitions not present in
that graph and uses status, lease owner, epoch, expiry, and checkpoint version
in compare-and-set updates.

```text
Ingestion example:
queued -> reading -> planning -> applying -> completed
                   \-> failed      \-> failed

Reporting example:
queued -> querying -> materialized -> completed
                  \-> failed       \-> failed
```

These are examples only. Stage-owned models retain separate collections,
status unions, counters, repositories, queue topics, and Google identities.

## Workbook registration inventory

Stage 1 statically registers these env-key-backed operational workbooks:

- `MASTER_LEADS_SHEET_ID` — Master Leads, required in production;
- `MASTER_BOOKED_SHEET_ID` — Master Booked, required in production;
- `TBM_LEADS_SHEET_ID`;
- `TBM_PRIME_LEADS_SHEET_ID`;
- `TOP10_LEADS_SHEET_ID`;
- `BEST_RELOCATION_LEADS_SHEET_ID`;
- `GETMOVERS_LEADS_SHEET_ID`;
- `MAINSITE_LEADS_SHEET_ID`.

Runtime IDs are never emitted by this evidence file. Health/log consumers must
use `maskSpreadsheetId`.

Stage 2 must compose required `ingestion_source` registrations for:

- `BEST_RELOCATION_SYNC_SHEET_ID`;
- `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`.

`BACKFILL_*` aliases are not registrations.

## Actor and audit evidence

- Signed owner/admin Registry actors map to `DurableActor`.
- Best Relocation ingestion and Reporting Projection use distinct system actor
  factories and origins.
- The command ledger stores actor, initiator, run/source provenance, checksum,
  entity references, warnings, and applied time in the domain transaction.
- Best-effort operational command events contain only sanitized identifiers,
  counts, and provenance keys; raw rows, tokens, credentials, and report data
  are excluded.

## Contract and regression evidence

Focused Stage 1 contract command:

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/durableWork/durableWork.test.ts \
  src/services/domainCommands/domainCommands.test.ts \
  src/services/operationalWorkbooks/registry.test.ts
```

Result on 2026-08-03: 19 passed, 0 failed.

Repository verification:

```text
pnpm typecheck
pnpm test
```

Results on 2026-08-03:

- TypeScript: passed;
- server tests: 644 passed, 0 failed.

The repository has no configured lint command; CI verifies typecheck and tests.

## Handoff constraints

Stage 2 must:

1. create its own ingestion run/receipt/conflict/connection models;
2. register both input workbooks;
3. call `canonicalDomainCommands` directly from workers;
4. use immutable plan checksums, command idempotency keys, fenced leases, and
   monotonic checkpoints;
5. keep parser/matching/conflict evidence outside canonical commands.

Stage 3 must:

1. create separate reporting definition/run/destination/delivery models;
2. use owner-authorized production Mongo reads only;
3. consume workbook safety before accepting destinations;
4. keep reporting OAuth, queue, lease namespace, and Google clients separate
   from ingestion.

No historical database merge, pre-cutoff recurring ingestion, reporting
dataset, Google report delivery, or Stage 2 parsing behavior is included in
this handoff.
