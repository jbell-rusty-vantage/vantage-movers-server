# Ringcentral Call Candidate Evaluator

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-candidate-evaluator.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `isLikelyTerminalRingCentralStatus`, `evaluateRingCentralCallCandidate`, `estimateCallElapsedSeconds`, `estimateAnsweredDurationSeconds`.
- Current exported types: types declared by the target.
- Direct import sites found: `src/services/numberActivity/interactionProjection.test.ts`, `src/services/ringcentral/analytics-reconcile.service.ts`, `src/services/ringcentral/call-candidate-store.ts`, `src/services/ringcentral/call-candidate.test.ts`, `src/services/ringcentral/call-session-aggregator.test.ts`, `src/services/ringcentral/call-session-aggregator.ts`, `scripts/dev_ops/ringcentral/ringcentral-call-lead-api-probe.ts`, `scripts/dev_ops/ringcentral/ringcentral-workflow-test.ts`.
- Related tests (inspected as source, not executed): `src/services/numberActivity/interactionProjection.test.ts`, `src/services/ringcentral/call-candidate.test.ts`, `src/services/ringcentral/call-session-aggregator.test.ts`.

## Current operation and naming boundary

This pure evaluator is diagnostic. It measures floored elapsed seconds from call start (first-seen fallback is supplied by the caller), not answered duration. Inbound direction, mapped target/source/route and normalized caller are required; a terminal candidate without terminalAt needs review. Under-threshold running candidates remain pending; terminal under-threshold candidates reject. It may preview a qualified running candidate, so `wouldCreateCallLead` never authorizes minting. `isLikelyTerminalRingCentralStatus` accepts Disconnected/Finished/Missed/NoCall; Voicemail/Gone are not terminal. Keep `estimateAnsweredDurationSeconds` as the exact compatibility alias for elapsed duration and preserve decision reason strings. Tests are `call-candidate.test.ts`; final-record tests belong on the shared Call Log vetter/webhook qualifier.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
