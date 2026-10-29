# Ringcentral Shadow Call Leads Store

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/shadow-call-leads-store.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations and constants: `insertShadowCallLead`.

## Current operation and naming boundary

`insertShadowCallLead` writes a staging record with provider and createdAt and returns its id. A Mongo 11000 returns null; every other error propagates. It creates a sparse unique telephony-session index and a source/time index through its cached index promise. Do not pretend this store applies Call Qualification, auth or write-mode selection: shared ingest owns those before calling it. Preserve the stored nullable identity shape and duplicate handling during a rename; changing sparse-null treatment or adding a Call Log uniqueness rule is a separate behavior change.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
