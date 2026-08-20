# Unit 33 — Prototype retirement, compatibility cleanup, and complete synthetic regression

**Status:** Complete  
**Date:** 2026-08-19 (America/New_York)  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle`, `vantage-admin` / `granot-lead-lifecycle`, and `granot_sync_extensions_and_services` / `main`

## Delivered contract

- Classified every prototype artifact, removed executable prototype/dry-run behavior and superseded Intake-era documents, retained final authority/history and operational migration evidence, and removed the retired package commands.
- Removed the deprecated Granot webhook capture adapter, legacy receipt aliases, seven retired receipt runtime fields, and two retired indexes while preserving the physical `granot_webhook_receipts` collection and the complete v2 evidence/work contract.
- Extended the guarded receipt cleanup report/apply/verify migration with v2 completeness, refused-row, credential-residue, legacy-consumer, exact-field, and exact-index gates. Central index verification rejects the retired indexes.
- Added a fail-closed Unit 33 synthetic migration seed, an isolated Unit 33 replica runner, and a deterministic cleanup verifier. The verifier enumerates all non-ignored worktree files, including untracked delivery artifacts.
- Removed the caller-proven dead server-only `classifyCompatibilityFamily` helper. The three receipt-first extension apply endpoints and their processor-result response remain because supported extension `0.2.8` directly calls and consumes them. No direct legacy patch path was restored.
- Reconciled active business-logic, rule, migration, source-policy, and operator documentation with receipt/processor, Booking Reconciliation, Release Reconciliation, and canonical command vocabulary.

## Authorized production Registry policy

The Owner separately authorized the exact Best Relocation creation-policy change on `vantagemovers`.

| Gate | Result |
| --- | --- |
| Scoped report | `best_relocation_form` and `best_relocation_call` present; dependencies valid; zero collisions/refused families; each row drifted only in `lead_created_policy` |
| Apply | exactly 2 `granot_crm_sources` changed from `link_only` to `create_if_missing`; 0 automation rows; 0 errors; `production_apply:true` |
| Verify | both rows `noop`, zero drift, persisted `create_if_missing`, `verify.ok:true` |
| Idempotency | second scoped production apply changed 0 CRM rows and 0 automation rows; final verify green |

The migration's `--scope=best_relocation_creation_policy` refuses missing families, invalid dependencies, collisions/refused families, and any Best Relocation drift beyond `lead_created_policy`. It cannot apply unreviewed-source deferrals or automation-reference mutations.

No lifecycle flag, activation, Lead, Booking, Cancellation, receipt, Observation, Decision, or current payload was changed by this policy migration.

## Extension compatibility closure

Extension `0.2.8` was uploaded for rollout. The Owner established that extension use remains blocked until `0.2.8` is ready and installed, explicitly unblocking Unit 33 continuation. `UNIT-33-EXTENSION-CLIENT-ATTESTATION.md` records the resulting operational fact: no pre-`0.2.8` client is authorized or active on the supported apply surface.

Caller inspection found that `0.2.8` directly consumes:

- `PATCH /api/v1/form-leads/:id/granot-sync`;
- `POST /api/v1/call-leads/enrichment/sync`;
- `POST /api/v1/call-leads/booked-reconciliation/sync`; and
- the current receipt/processing/outcome/changed-path/fixed-message result fields.

Those interfaces remain the supported `0.2.8` contract. Repository version alone was not used as old-client absence proof, and browser user-agent data was not misrepresented as extension telemetry.

## Migration and synthetic evidence

- Disposable receipt/index proof on `testvantagemovers_unit33migration`: one redacted v2 receipt, seven retired fields, and two retired indexes; report/apply/verify green; second apply no-op; central 60-index contract green.
- Combined isolated replica command: 83/83 passed in one invocation—64 delivery-disabled lifecycle tests followed by 19 publication-blocked queued-outbox canonical-command tests; process exit 0.
- Focused receipt migration/model/capture suite: 54/54 passed.
- Required focused server matrix: 116 total, 114 passed, 2 expected replica opt-in skips, 0 failed.
- Final extension/route/cross-channel/source-policy focus after compatibility closure: 29/29 passed.
- Unit 20 RingCentral convergence regression: 10/10 passed.

All fixtures were synthetic and redacted. Sheet delivery was disabled or publication-blocked for final proof.

## Final repository verification

Main server:

```text
pnpm typecheck: passed
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test: 1,520 total; 1,434 passed; 86 expected opt-in/environment skips; 0 failed
pnpm verify:granot-lifecycle:unit33-cleanup: 1,121 non-ignored worktree paths; 1,015 active text files; 0 findings
```

Admin:

```text
pnpm test: 234/234 passed
pnpm lint: passed
pnpm typecheck: passed
pnpm build: passed
```

Extension `0.2.8`:

```text
pnpm test: 146/146 passed
pnpm compile: passed
pnpm build: Chrome production build passed
pnpm build:firefox: Firefox production build passed
```

The Unit 33 change set passes `git diff --check`. Unrelated Owner-TODO whitespace remains preserved in `src/services/leads/formLead.service.ts` and `src/services/leads/leadSourceCompatibility.ts` and is not attributed to this unit.

## Safety record

During early runner investigation, `SHEET_SYNC_MODE=test` was mistakenly treated as a fully isolated fake. One synthetic `master_booked` row reached the configured external test Google Sheet. Delivery was immediately disabled; no customer payload or production database was involved, and no compensating external mutation occurred without authority.

After the shared Atlas test cluster reached its collection cap, exactly ten enumerated disposable Unit 33 databases matching `^testvantagemovers_unit33[a-z0-9]*$` were dropped. Production and the base `testvantagemovers` database were not targeted. The deleted synthetic databases are unrecoverable; reproducible commands and migration manifests remain.

The guarded legacy-receipt cleanup was not applied to production because it retains its own separate production authorization gate. Its disposable proof is sufficient for Unit 33 implementation certification; later operational rollout must repeat report/review/apply/verify under explicit authority.

## Unit 34 handoff

Unit 34 is now ready. It alone owns isolated current-Granot-webhook-payload shape certification and the final go/no-go. Unit 34 must introduce no new domain behavior and does not authorize deployment, activation, lifecycle flag changes, official Booking/Cancellation mutation, external delivery, or production receipt cleanup.
