# Ringcentral Call Session Store

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-session-store.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `processRingCentralCallSession`, `listRingCentralCallSessions`, `listRingCentralCallSessionDecisions`, `findRingCentralCallSession`.
- Current exported types: `ProcessRingCentralSessionResult`.
- Direct import sites found: `src/routes/ringcentral-webhook.routes.ts`, `src/services/domainCommands/ringcentralProvenance.ts`.
- Related tests: Locate existing callers and targeted tests before changing this module.

## Current operation and naming boundary

`processRingCentralCallSession` loads all candidates for one telephony session, aggregates them, then upserts the session projection. It appends session-decision history only when decisionStatus changes; changed reason or timing alone is not a new status history row. Reads/list limits and the omission of leadPreview on list are distinct from the hydrated session lookup. Keep the provider/session identity and indexes stable. This is diagnostic state persistence, not the final qualification or ingest gate; the webhook route performs that later step.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
