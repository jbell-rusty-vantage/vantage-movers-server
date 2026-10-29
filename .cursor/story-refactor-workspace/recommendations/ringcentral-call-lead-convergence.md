# Ringcentral Call Lead Convergence

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/callLeadConvergence.service.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `ensureRingCentralConvergenceScopeLock`, `acquireRingCentralConvergenceScopeLock`, `selectRingCentralConvergenceCandidates`, `findPreCreationRingCentralConvergenceCandidates`, `attemptRingCentralCallLeadConvergence`, `adoptRingCentralCall`, `markRingCentralConvergenceConflict`, `toQualifiedCallIdentity`, `buildRingCentralCommandContext`, `MULTIPLE_ADOPTION_CANDIDATES`.
- Current exported types: `RingCentralConvergenceScopeRaceError`, `RingCentralQualifiedCallIdentity`, `RingCentralConvergenceCandidate`, `RingCentralConvergenceSelection`, `RingCentralConvergenceAttempt`, `AdoptRingCentralCallInput`, `MarkRingCentralConvergenceConflictInput`, `RingCentralConvergenceCandidateQuery`, `RingCentralConvergenceDependencies`.
- Direct import sites found: `src/services/domainCommands/index.ts`, `src/services/domainCommands/types.ts`, `src/services/granotLifecycle/createLeadFromGranot.ts`, `src/services/ringcentral/callLeadConvergence.replica.test.ts`, `src/services/ringcentral/callLeadConvergence.test.ts`, `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`.
- Related tests (inspected as source, not executed): `src/services/ringcentral/callLeadConvergence.replica.test.ts`, `src/services/ringcentral/callLeadConvergence.test.ts`.

## Current operation and naming boundary

Selection requires exact Source Granularity + normalized immutable ingested phone, pending `granot_lead_created` origin, no attached RingCentral session/log identity and inclusive createdAt within ±12 hours of call start. Missing identity yields ineligible; multiple candidates yield conflict, never a guessed winner. Canonical adoption revalidates candidate count, revision and active route/source scope in the transaction, preserving Granot origin/contact/CPL provenance while recording original caller and verified RingCentral evidence, Entity Change, outbox and terminal ledger atomically. Conflict mutation revalidates every eligible candidate and normal ingest continues only after it succeeds. The Granot create scope fence is always used when it has a phone; the ingest-side fence remains adoption-flag dependent. Mutation also requires create mode. Keep hashed Source Granularity/phone fencing and `RingCentralConvergenceScopeRaceError`; the unit and replica test files are source evidence, not a claim this review executed them.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
