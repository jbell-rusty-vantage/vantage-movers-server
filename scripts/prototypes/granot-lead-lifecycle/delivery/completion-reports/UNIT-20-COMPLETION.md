# Unit 20 — RingCentral adoption/convergence and duplicate correctness

**Status:** Complete  
**Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`

## Authority and prerequisites

Implemented final-spec Sections 1–2, 4–7, 12.2, 14.2–14.4, 15.2–15.3, 16.2–16.3, 17, 23.1–23.3, 25–27, 33, 34.7, 35–37, 38/S14, and 39–41; Invariants 1–10 applicable to convergence; and Unit 20 ownership of AC-14, AC-15, and AC-16.

Unit 12 provenance/schema parity and Unit 19 Granot creation evidence were reverified before implementation. Unit 10–11 canonical command, append-only Change, revision, transaction, and Sheet outbox behavior remained the mutation boundary.

## Behavior delivered

- Added the shared `callLeadConvergence.service.ts` candidate/adoption/conflict owner and placed it after processed-call idempotency and before business duplicate classification in the qualified-call ingest used by both webhook and Call Log paths.
- Candidate selection is exact Source Granularity + immutable Granot creation phone + `granot_lead_created` + `pending` + no attached telephony identity + inclusive call-start ±12 hours. Missing start/phone, Job-only, zero, out-of-window, or mismatched evidence never guesses.
- Exactly one candidate is adopted by the canonical `adoptRingCentralCall` command. It preserves Granot Ingestion Origin/snapshots/scope, attaches verified route/call/timing evidence plus immutable `ringcentral.original_caller`, applies the existing duplicate/CPL rule against other Leads, advances one revision, appends one `EntityChange`, queues one Sheet update, and writes the terminal processed-call result in the same Mongo transaction.
- Multiple candidates are atomically marked `conflict` with `multiple_adoption_candidates` by `markRingCentralConvergenceConflict`, one revision/Change/outbox per candidate, and then the qualified call continues through normal create/shadow/dry-run behavior.
- The duplicate guard explicitly excludes the adopted target and unresolved Granot `pending`/`conflict` candidates without telephony evidence. It preserves exact Granularity, normalized phone, different physical call, non-duplicate prior Lead, and the established earlier-only 90-day rule.
- RingCentral-first calls still create through the normal path; Unit 19's pre-creation seam detects the existing exact-phone/Granularity Lead and replans instead of creating a second Lead. Granot-first calls adopt the pending Lead and suppress normal creation.
- Normal RingCentral creation and its terminal processed ledger now commit together. Duplicate-key races re-read the winning ledger, including call-log-only identities.
- Granot Call creation and RingCentral adoption/normal creation share a hashed Granularity+phone scope fence. Both transactions re-check after acquiring it, so simultaneous absent-row checks cannot create two Leads; candidate revision/idempotency races re-read and converge.
- Webhook and Call Log descriptors bridge through nonempty `sessionId` as well as telephony/call-log identity. Normal creation re-reads the terminal ledger inside the scope-fenced transaction, so zero-candidate cross-path races also create one Lead.
- Added bounded attempted/adopted/adopted-duplicate/conflict/not-found/ineligible operational events containing route/source/outcome references only.
- Added the default-false `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` rollout/rollback flag. Call qualification, Call Log cursor/cadence, lease/run telemetry, clients, Booking, Cancellation, notifications, and email remain unchanged.

## Issue-author allocations

- Internal canonical commands: `adoptRingCentralCall` and `markRingCentralConvergenceConflict`.
- Additive immutable `ringcentral.original_caller` evidence.
- Terminal processed statuses: `lead_adopted` and `lead_adopted_duplicate`.
- Default-false adoption flag.
- Separately authorized refinement: a collision-audited unique sparse processed-ledger `callLogId` index and Section 34.5 report/apply/verify path.

## Files

### Production and model behavior

- `src/services/ringcentral/callLeadConvergence.service.ts`
- `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- `src/services/ringcentral/ringcentral-duplicate-guard.ts`
- `src/services/ringcentral/processed-calls-store.ts`
- `src/services/ringcentral/ringcentral-config.ts`
- `src/services/ringcentral/call-log-sync.service.ts`
- `src/services/granotLifecycle/createLeadFromGranot.ts`
- `src/services/domainCommands/{index,types,entityChange,ringcentralProvenance}.ts`
- `src/models/CallLead.ts`
- `src/models/granotLifecycleSchemas.ts`

### Migration, tests, and harness

- `scripts/migrations/ringcentral-processed-call-indexes.{ts,lib.ts,test.ts}`
- `scripts/test-granot-lifecycle-replica.ts`
- `src/services/ringcentral/callLeadConvergence.{test,replica.test}.ts`
- `src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts`
- `src/services/ringcentral/ringcentral-duplicate-guard.test.ts`
- `src/services/ringcentral/processed-calls-store.test.ts`
- `src/models/CallLead.test.ts`
- `src/services/ingestion/ingestion.test.ts`

### Behavior documentation

- `.cursor/businesslogic/ringcentral-call-lead-qualification.service.md`
- `.cursor/rules/ringcentral-call-lead-candidates.mdc`
- `.cursor/rules/ringcentral-integration.mdc`
- `.cursor/rules/schema-and-crud-inputs.mdc`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

## AC and interface proof

- **AC-14:** focused and replica tests prove exact immutable-phone/Granularity/window selection, both arrival orders, call-log-only adoption, preserved Granot origin, complete immutable caller/telephony evidence, one Command/Change/revision/outbox/ledger chain, replay, one-millisecond boundary exclusion, and concurrent convergence on one adopted Lead and one ledger row.
- **AC-15:** focused and replica tests prove the target cannot duplicate itself, unresolved Granot candidates cannot create false duplicates, a different prior eligible Lead does produce duplicate/zero-CPL, adopted Leads from other physical calls remain eligible, future Leads are excluded, and the exact 90-day boundary remains inclusive.
- **AC-16:** tests prove zero/missing-start/missing-phone/Job-only outcomes do not mutate candidates and continue normal ingest; multiple candidates receive durable bounded conflict evidence before normal ingest creates the qualified RingCentral Lead; adoption and conflict rollback at every injected write stage.

Replica assertions also prove no Booking, Cancellation, Granot Decision, reconciliation case, notification, email, provider request, or external Sheet write is introduced.

## Migration and index verification

The authorized `ringcentral-processed-call-indexes/1` migration:

- reports masked duplicate `callLogId` groups and explicit null/empty placeholders;
- refuses apply while real string collisions remain;
- unsets null/empty placeholders so sparse semantics are real;
- replaces a legacy single-field non-unique `callLogId` index with the exact unique sparse index;
- verifies collision count zero, placeholder count zero, and the exact index definition.

Disposable `testvantagemovers.ringcentral_processed_calls_test` report/apply/verify completed with `collision_group_count: 0`, call-log/session sparse placeholder counts `0`, and `required_index_present: true`. Manifests were written under the ignored `scripts/output/ringcentral-processed-call-indexes/` directory.

No production report, apply, verify, migration, index mutation, or collection write was run.

## Flags and rollback

Checked-in/default adoption posture remains `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false`. Replica proof injected adoption/create true, shadow false, `TEST_MODE=true`, `RINGCENTRAL_COLLECTION_MODE=test`, and `SHEET_SYNC_MODE=disabled`.

Rollback starts by setting adoption false. Existing adopted/conflicted evidence, Commands, Changes, revisions, outbox rows, duplicate results, and processed ledger rows remain authoritative and are not reversed automatically. Existing RingCentral create/shadow/dry-run gates remain available. No schedule or cursor change is part of rollback.

## Verification

Focused:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/ringcentral/callLeadConvergence.test.ts src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts src/services/ringcentral/ringcentral-duplicate-guard.test.ts src/services/ringcentral/processed-calls-store.test.ts scripts/migrations/ringcentral-processed-call-indexes.test.ts src/models/CallLead.test.ts src/services/domainCommands/domainCommands.test.ts src/services/ingestion/ingestion.test.ts
```

- **91 passed, 0 failed, 0 skipped.**

Replica:

```text
TEST_MODE=true MONGO_DB_NAME=testvantagemovers RINGCENTRAL_COLLECTION_MODE=test RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true RINGCENTRAL_CREATE_CALL_LEADS=true RINGCENTRAL_SHADOW_CALL_LEADS=false SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=20
```

- **10 passed, 0 failed, 0 skipped.**

Repository:

```text
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test
pnpm typecheck
git diff --check
```

- `pnpm test`: **1,371 tests; 1,320 passed, 0 failed, 51 skipped** (opt-in replica suites).
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- The repository defines no separate `lint`, `compile`, or `build` script.

## Privacy, safety, and unchanged surfaces

All replica fixtures used synthetic phones/routes and masked causal evidence in the disposable test database. Sheet delivery was disabled. Operational events and manifests contain no caller name/phone, raw call payload, token, credential, or unmasked row identifier.

`vercel.json`, Call Log cursor advancement, overlap windows, lease fields, run telemetry, and cadence are unchanged; those remain Unit 21 ownership. No provider request, production payload inspection, production flag enablement, deploy, commit, push, Registry mutation, CRM/Sheet send, notification, or email occurred.

## Risks and next unit

- Production rollout still requires reviewed production collision reporting, reviewed index apply/verify, staging/synthetic qualification proof, explicit adoption-flag approval, and monitoring. This completion does not authorize those actions.
- The unique sparse `callLogId` index must be deployed before enabling adoption for call-log-only qualified identities; runtime adoption fails closed if either processed identity index is absent.
- Unit 21 is unblocked and alone owns Call Log lease/telemetry/cursor/overlap proof and cadence changes. It must preserve this shared convergence ordering and transaction boundary.

## Repository state and external actions

Final `git status --short` contains only the Unit 20 production/model, migration, focused/replica test, maintained behavior-doc/rule, delivery-ledger, and completion-report changes listed above. Changes remain uncommitted.

No commit, push, deploy, production mutation/report/index apply, live payload inspection, provider request, Registry change, external Sheet/CRM send, notification, email, or other external action occurred. Only disposable test-database fixtures, convergence-lock rows, processed-ledger rows, index synchronization, and cleanup were performed.
