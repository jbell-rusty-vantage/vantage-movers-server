# Committed canonical command result

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/DomainCommandExecution.ts`
- Knowledge: `docs/knowledge/services/domain-commands.md`

## Current storage contract

Ledger stores applied command/provenance/refs/result with unique command_id and origin+idempotency_key. readStoredCanonicalCommandResult decodes replay, does not execute.

## Remaining naming and organization work

Name stored result decode separately from ledger definition. Preserve stored command/key/checksum and committed-only status/default connection.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`DOMAIN_COMMAND_EXECUTION_COLLECTION`; `DOMAIN_COMMAND_EXECUTION_INDEXES`; `DomainCommandExecutionDocument`; `DomainCommandExecution`; `readStoredCanonicalCommandResult`

## Parity checks for future implementation

Key uniqueness/scope; result roundtrip/missing shape; no executor/finalize from read; insertion remains transaction-owned.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
