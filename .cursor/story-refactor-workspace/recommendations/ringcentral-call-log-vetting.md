# Ringcentral Call Log Vetting

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-log-vetting.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `vetRingCentralCallLogRecord`, `qualifiedCallFromCallLog`.
- Current exported types: `RingCentralCallLogVetResult`.
- Direct import sites found (resolved relative imports): `scripts/call-ingestion-trace.ts`, `scripts/dev_ops/ringcentral/owner-prototype-qualification-funnel.ts`, `scripts/dev_ops/ringcentral/owner-three-lead-origin.ts`, `scripts/dev_ops/ringcentral/probe-inbound-threshold.ts`, `scripts/dev_ops/ringcentral/probe-ring-to-terminal.ts`, `scripts/dev_ops/ringcentral/ringcentral-call-lead-api-probe.ts`, `scripts/dev_ops/ringcentral/ringcentral-workflow-test.ts`, `scripts/dev_ops/ringcentral/sales-intelligence-validate.ts`, `scripts/verify-short-call-legs.ts`, `src/services/ringcentral/call-log-sync.service.test.ts`, `src/services/ringcentral/call-log-sync.service.ts`, `src/services/ringcentral/call-log-vetting.test.ts`, `src/services/ringcentral/webhook-call-log-qualification.ts`.
- Related tests: `src/services/ringcentral/call-log-vetting.test.ts`

## Current operation and naming boundary

Both transports use this vetter. Require `Inbound`, `Voice`, an explicitly `finished === true` parent, valid start, parent caller phone, call-log or telephony identity and an effective route at parent start. Prefer parent durationMs; 120000 qualifies inclusively, malformed supplied milliseconds fail closed. Without milliseconds, rounded seconds exactly 120 remain unqualified; do not sum parallel/transfer legs or borrow duration/caller. Target leg fallback must be inbound with the same normalized caller and no conflicting telephony session. `qualifiedCallFromCallLog` sets answeredAt null and terminalAt = start + elapsed; Accepted/recording/party disconnection cannot prove completion. Preserve exact rejectionReasons and conversion refusal. `call-log-vetting.test.ts` and `webhook-call-log-qualification.test.ts` cover these boundaries as source evidence; tests were not run by this review.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
