# Ringcentral Duplicate Guard

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/ringcentral-duplicate-guard.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `classifyRingCentralCallLeadDuplicate`, `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS`.
- Current exported types: `RingCentralDuplicateClassification`, `RingCentralDuplicateInput`, `RingCentralDuplicateDeps`.
- Direct import sites found: `src/services/ringcentral/callLeadConvergence.service.ts`, `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`, `src/services/ringcentral/ringcentral-duplicate-guard.test.ts`, `scripts/dev_ops/ringcentral/ringcentral-workflow-test.ts`.
- Related tests: `src/services/ringcentral/ringcentral-duplicate-guard.test.ts`

## Current operation and naming boundary

Duplicate scope is exact Source Granularity + normalized phone against a different non-duplicate Call Lead. Convert call timestamp to the existing stored Eastern representation, then match `[call time - 90 days, call time)`. Lower boundary is inclusive; same-time/future rows cannot be prior leads. Exclude adopted id and matching telephony/session/call-log identities; ignore unresolved pending/conflict Granot rows without any attached RC identity. Preserve defensive phone recheck and newest-first existingLeadId/matchCount result. Source Company parameter/log vocabulary does not widen the Mongo scope. The debug duplicateWindowHours flag does not set this 90-day business rule; duplicate CPL remains zero downstream.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
