# Fence the Call Log sync lease and advance the cursor only on success

- Status: recommended; reviewed 2026-10-29.
- Target: `src/services/ringcentral/call-log-sync-state.store.ts`.
- Callers: `src/services/ringcentral/call-log-sync.service.ts`, `src/services/granotLifecycle/projections.ts`, and `scripts/migrations/granot-lifecycle-indexes.lib.ts`.
- Tests: `src/services/ringcentral/call-log-sync-state.store.test.ts`, `src/services/ringcentral/call-log-sync-lease.replica.test.ts`.
- Domain: `docs/knowledge/services/ringcentral-call-lead-qualification.md`.

## Current operation and naming boundary

Mongo's one `key: account` row owns cursor and five-minute renewable lease. Fail closed without the unique singleton key index; runtime never bootstraps that production index. Claim losers do no provider work. Renew, success, error and release are fenced by owner plus unexpired lease; expiry permits takeover, and stale owners cannot clear the successor. Only a fully fenced success advances lastSyncFrom/To. Preserve bounded closed error codes and masked lease telemetry; no raw caller/provider payload belongs in state. Unit and replica suites are `call-log-sync-state.store.test.ts` and `call-log-sync-lease.replica.test.ts`; inspect replica prerequisites before claiming they ran.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
