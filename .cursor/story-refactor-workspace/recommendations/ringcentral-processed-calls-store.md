# Preserve the processed-call ledger and identity indexes

- Status: recommended; reviewed 2026-10-29.
- Target: `src/services/ringcentral/processed-calls-store.ts`.
- Caller: `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`.
- Domain: `docs/knowledge/services/ringcentral-call-lead-qualification.md`.

## Current boundary and cleanup

Webhook and Call Log cron share a ledger for qualified calls. Keep `findProcessedCall`, `upsertProcessedCall`, index reconciliation and adoption index assertions as separate operations: lookup identity, upsert identity, and deploy-time index verification answer different questions. Consider naming `processedCallIdentityKey` to make its write-key priority visible while preserving its export as an alias until callers move. Keep transaction sessions on the current read and write calls; do not move qualification or business duplicate decisions into this store.

## Parity checks

- Lookup ORs every supplied telephony session, session, and Call Log ID, and returns null when all are absent. Upsert chooses telephony session ID first, else Call Log ID, and does nothing when neither exists; session ID alone is not a write key.
- Omit missing telephony session and Call Log IDs from persisted fields so sparse unique indexes remain effective. `firstProcessedAt` is insert-only; `updatedAt` changes on writes. Preserve the optional Mongo session and skip automatic index setup inside that session.
- Terminal statuses are `lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`, and `shadow_recorded`; `dry_run` and `skipped` are not members. Preserve persisted status strings and do not conflate terminal idempotency with 90-day business duplicate classification.
- In the test runner, reconciliation drops a same-key differently named conflicting index and creates the declared indexes. Outside it, verify name, key, unique and sparse settings against all declared indexes and fail closed if missing; namespace-not-found counts as none, other errors propagate. Runtime does not create production indexes.
- Adoption separately requires unique sparse single-field telephony-session and Call Log indexes. Preserve that assertion and test missing or malformed indexes, as well as the declared status/update and source/phone indexes and lookup/write identity cases.
