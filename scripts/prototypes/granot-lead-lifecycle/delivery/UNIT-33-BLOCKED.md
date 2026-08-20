# Unit 33 former blocked delivery report

Date: 2026-08-19 (America/New_York)  
Disposition: **resolved — retained as historical blocker evidence**

## Resolved release gate

The former gate required approved proof that no extension older than `0.2.8` remained active on the supported apply surface.

Current evidence cannot be upgraded into that proof: existing `browser_extension` receipts store a browser user-agent but no extension version, and the extension repository contains no centralized installed-client/deployment registry. Adding prospective version telemetry would not prove that older clients are absent. `UNIT-33-EXTENSION-CLIENT-INVENTORY-TEMPLATE.md` defines the required complete-universe, per-installation diagnostics evidence and Owner attestation; the unsigned template is not itself release evidence.

Resolution, 2026-08-19: the Owner established an operational block on extension use until uploaded version `0.2.8` is ready and installed, and explicitly unblocked continuation. `UNIT-33-EXTENSION-CLIENT-ATTESTATION.md` records that no pre-`0.2.8` client is authorized or active on the supported apply surface. This closes the release gate without pretending rollout telemetry exists.

Caller inspection proved that `0.2.8` itself directly uses all three receipt-based apply endpoints and the current processor-result response. They remain supported contract. The already-retired direct patch/capture adapter stays deleted, and the unused server-only UI-family compatibility helper was removed.

This is an authority/evidence prerequisite, not a test failure. All independently executable Unit 33 cleanup and synthetic verification work described below is complete.

## Delivered cleanup

- Classified every retained and removed prototype artifact in `UNIT-33-CLEANUP-INVENTORY.md`.
- Removed the executable prototype, prototype dry-run/seed commands, superseded Intake-era documents, and the deprecated Granot webhook capture adapter.
- Retained final specifications, issue/status/runbook history, completion evidence, and operational migration sources.
- Removed the seven retired receipt fields and all legacy receipt aliases from runtime schema/capture code while preserving the physical `granot_webhook_receipts` collection and v2 evidence/work fields.
- Upgraded the guarded receipts migration to report v2 completeness, refused rows, credential residue, supported legacy consumers, field cleanup counts, and retired index names before apply.
- Removed the two retired receipt indexes from the central index contract and made verification reject their presence.
- Added a fail-closed Unit 33 synthetic migration seed and a Unit 33 replica regression runner. The runner fixes external delivery at `SHEET_SYNC_MODE=disabled`, uses test RingCentral collections, and explicitly enables the adoption path asserted by the RingCentral regression.
- Added `verify:granot-lifecycle:unit33-cleanup`, a deterministic non-ignored-worktree verifier for removed aliases, receipt fields, vocabulary, commands, retired paths, and the required extension package version. Its final scan covered 1,121 worktree paths and 1,015 active text files with 0 findings, including untracked delivery artifacts.
- Reconciled active business-logic, rule, migration, source-policy, and operator documentation with the receipt/processor and Booking/Release Reconciliation vocabulary.

## Disposable database proof

Database: `testvantagemovers_unit33migration` on the configured replica set. No production database was mutated.

1. Seeded one synthetic redacted v2 receipt containing the seven retired compatibility fields plus both retired indexes.
2. Receipt report: 1 total, 1 v2-complete, 0 refused, 0 credentials, 0 supported legacy consumers, 1 cleanup candidate, 2 retired indexes.
3. Receipt apply: unset the seven allowed fields on 1 row and dropped exactly the two reported indexes.
4. Receipt verify: all retired field counts 0, retired indexes absent, v2 completeness preserved.
5. Central index report/apply/verify: 60 contract indexes; missing and mismatched sets empty after apply.
6. Second receipt apply was an idempotent no-op (`applied: 0`, `dropped_indexes: []`), followed by a green verify.

After the shared test cluster reached its collection limit during the first combined-run attempt, exactly ten disposable Unit 33 databases matching `^testvantagemovers_unit33[a-z0-9]*$` were enumerated and dropped. The production database and the base `testvantagemovers` database were not targeted. These synthetic databases are not recoverable; their checked-in commands and retained migration manifests remain the reproducible evidence. The final combined run used a fresh `testvantagemovers_unit33combined` database.

Receipt-cleanup production apply remains separately authorized under the runbook and was not attempted.

## Authorized production source-policy apply

On 2026-08-19 the Owner authorized the Best Relocation Forms and Inbounds creation-policy change on `vantagemovers`.

1. The checked-in reviewed manifest was corrected from `link_only` to `create_if_missing` for only `best_relocation_form` and `best_relocation_call`; Referral, Paid Overflow, Auto, and unreviewed sources were unchanged.
2. The migration gained `--scope=best_relocation_creation_policy`. The scope requires both Best Relocation families, refuses dependencies/collisions/refused families, refuses any Best Relocation drift beyond `lead_created_policy`, and never applies unreviewed CRM deferrals or automation-reference changes.
3. Production report: database `vantagemovers`, dependencies valid, zero collisions, zero refused families, and exactly two scoped rows whose only drift field was `lead_created_policy`.
4. Authorized production apply: 2 CRM rows changed, 0 automation rows changed, 0 apply errors; the manifest records `production_apply:true` and the exact scope.
5. Production verify: both rows persisted `create_if_missing`, action `noop`, no drift, and `verify.ok:true`.
6. Second production apply was an idempotent no-op: 0 CRM rows changed, 0 automation rows changed, 0 apply errors. A final verify remained green.

This closes the former AC-09/AC-38 source-policy release gate. It does not enable lifecycle flags, process a webhook, create a Lead, mutate a Booking/Cancellation, or authorize compatibility removal.

## Synthetic verification

- Receipt migration/model/capture focused tests: 54/54 green.
- Required server focused matrix: 116 tests, 114 passed, 2 expected replica opt-in skips, 0 failed.
- Unit 20 RingCentral convergence regression after making the runner posture explicit: 10/10 green.
- Unit 33 isolated replica matrix: 83/83 green in one `pnpm test:granot-lifecycle:replica -- --unit=33` invocation (64 delivery-disabled lifecycle tests, then 19 publication-blocked queued-outbox command tests; process exit 0). Coverage includes drainer fencing/retry/dead-letter, identity, processing, extension/automation apply, Lead mutation/creation, Booking/Release/Referral canonical commands and exact outbox intent, discrepancies, projections/health, RingCentral lease/cursor/adoption, and historical shadow.
- Admin: 234/234 tests green; lint, typecheck, and production build green.
- Extension `0.2.8`: 146/146 tests green; compile, Chrome build, and Firefox build green.
- Server ordinary full suite: 1,520 total, 1,434 passed, 86 expected opt-in/environment skips, 0 failed. Server typecheck is green.

All regression fixtures were synthetic and redacted. Unit 34 still owns current-payload certification.

## Safety incident

During an early runner investigation, `SHEET_SYNC_MODE=test` was briefly used under the mistaken assumption that it was a fully isolated fake. One synthetic `master_booked` write reached the configured external **test** Google Sheet (reported as row 16). The runner was immediately restored to `disabled`; all subsequent proof used disabled external delivery. No customer payload or production database was involved. No deletion or compensating external mutation was attempted without separate authority.

## Closed unblock evidence

- Accepted operational-control attestation: `UNIT-33-EXTENSION-CLIENT-ATTESTATION.md`.
- Compatibility decision: retain the three receipt-based endpoints and result response required by `0.2.8`; remove only caller-proven dead compatibility code.
- If desired, separate authorization to execute the guarded receipt cleanup against `vantagemovers` after reviewing its production report. This production apply is operational rollout work and is not required to validate the migration implementation on the disposable replica set.
