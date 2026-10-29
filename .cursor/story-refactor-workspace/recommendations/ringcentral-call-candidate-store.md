# Ringcentral Call Candidate Store

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/call-candidate-store.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `upsertRingCentralCallCandidateFromEvent`, `storeRingCentralCallCandidateDecision`, `listRingCentralCallCandidates`, `listRingCentralCallCandidateDecisions`, `findRingCentralCallCandidatesByTelephonySessionId`, `buildRingCentralCandidateDocument`, `CALL_CANDIDATES_TEST_COLLECTION`, `CALL_CANDIDATE_DECISIONS_TEST_COLLECTION`.
- Current exported types: `CandidateUpdateResult`.
- Direct import sites found: `src/routes/ringcentral-webhook.routes.ts`, `src/services/ringcentral/call-candidate.test.ts`, `src/services/ringcentral/call-session-store.ts`, `scripts/dev_ops/ringcentral/ringcentral-webhook-monitor.ts`, `scripts/dev_ops/ringcentral/ringcentral-workflow-test.ts`.
- Related tests (inspected as source, not executed): `src/services/ringcentral/call-candidate.test.ts`.

## Current operation and naming boundary

The store upserts per provider + telephony session + party, preserving firstSeenAt/createdAt while folding a normalized event into latest state and evaluating a diagnostic decision. Candidate decision insertion is a separate exported operation; do not collapse it into every upsert. List reads hide rawLatestParty, while decision reads retain the diagnostic records. Preserve session/party identity, out-of-order event folding, route evidence and current index behavior. It does not call shared ingest or prove final completion. Keep the pure `buildCandidateDocument` boundary and name event folding separately from Mongo persistence; verify against `call-candidate.test.ts` rather than claiming a live provider test.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
