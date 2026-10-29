# Ringcentral Call Session Aggregator

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-session-aggregator.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `aggregateRingCentralCallSession`.
- Current exported types: types declared by the target.
- Direct import sites found: `src/services/ringcentral/call-session-aggregator.test.ts`, `src/services/ringcentral/call-session-store.ts`, `scripts/dev_ops/ringcentral/ringcentral-workflow-test.ts`.
- Related tests: `src/services/ringcentral/call-session-aggregator.test.ts`

## Current operation and naming boundary

Reject an empty party list or mixed telephony sessions. Select source/caller preview identity separately from elapsed timing: start is the earliest observed call start/firstSeenAt; terminal is true only when every observed party ended, and terminalAt is their latest terminal time. This avoids ending a transferred live party when a queue/former agent ends. Canonical ranking is a weighted score, including bounded duration and recency, not a strict multi-key lexicographic sort. Answered metadata is diagnostic; no durations are summed and no party authorizes Lead creation. `ingestEligible` is preview-only and final Call Log validation remains required. Preserve these distinctions in `aggregateRingCentralCallSession` and prove them in `call-session-aggregator.test.ts`.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
