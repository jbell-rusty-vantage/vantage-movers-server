# Unit 34 — Final current-Granot-webhook-payload application-logic certification

**Status:** Complete

**Date:** 2026-08-20 (America/New_York)

**Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`; `vantage-admin` and extension were verified without Unit 34 domain changes.

## Delivered contract

- Added an access-limited deterministic sanitizer and scanner that strips credentials and replaces contact, identity, address, date, amount, user, and free-text values while retaining structural relationships.
- Added guarded current-shape normalization tests. They require an absolute approved sanitized derivative path and cannot run accidentally in the normal suite.
- Added a fail-closed seed for only the disposable `testvantagemovers_unit34cert` database and registered a Unit 34 replica runner with explicit safe lifecycle flags and publication-blocked queued-outbox coverage.
- Removed the tracked webhook receipt examples after the Owner confirmed their use as the current-shape source. Raw payloads are not retained in the repository.
- Recorded the dated PII-safe certification in Markdown and JSON. No lifecycle domain behavior, source policy, normalization rule, identity ladder, command, case mode, queue algorithm, or migration definition changed.

## Authority and acceptance coverage

The implementation follows final-spec Sections 1–7, 9–18, 26–28, 33–36, 39, and 41; the standalone Unit 34 contract; S01–S23 production interfaces; invariants 1–12; and the complete AC-01–AC-40 baseline. Current shapes directly sampled AC-01, AC-05, AC-06, AC-25, AC-29, and AC-35. Unit 33 remains the exhaustive synthetic acceptance owner.

## Current-shape evidence

- 6 approved payloads formed 4 schema families: one `lead_created`, one `priority_updated`, three `booking_status_changed`, and one empty/no-compatible-route family.
- Scanner findings: 0 credentials, PII, realistic contacts, or custody paths.
- All three route families normalized safely. The empty payload failed closed and could not satisfy Lead-creation minimum data.
- Family counts and SHA-256 schema fingerprints are retained in `delivery/certification/UNIT-34-CERTIFICATION-2026-08-20.{md,json}`; no payload/body hash or raw field value is retained.

## Migrations, indexes, and isolated effects

On the exact disposable replica-set database `testvantagemovers_unit34cert`, receipts, source Registry, Lead provenance, aggregate revisions, and indexes each completed report → apply → verify. No production apply occurred.

`TEST_MODE=true` was required. Sheet delivery was disabled or publication-blocked. The matrix proved canonical `master_leads` / `master_booked` outbox intents and absence on no-effect outcomes; no Google delivery or other external effect occurred.

## Verification results

```text
sanitizer/scanner: 3 passed, 0 failed
guarded current shapes: 8 passed, 0 failed
Unit 34 replica core: 69 passed, 0 failed
Unit 34 queued outbox: 19 passed, 0 failed
focused server matrix: 131 total; 129 passed; 2 expected skips; 0 failed
full server: 1,520 total; 1,434 passed; 86 expected skips; 0 failed
server typecheck: passed
admin: 234/234 tests; lint/typecheck/build passed (41 routes)
extension 0.2.8: 146/146 tests; compile/Chrome/Firefox builds passed
```

Early shared-test-state and inherited-flag failures were `environment_defect` findings. The exact disposable database and explicit runner flags resolved them; all reruns were green. No implementation defect or true domain gap remains.

## Privacy, rollback, and release notes

- Unit 32 was skipped. No email behavior was added; email remains disabled.
- Raw and sanitized temporary custody copies were deleted after durable evidence was complete. The exact disposable database was also dropped. Both deletions are unrecoverable; the PII-safe tracked evidence and reproducible harness remain.
- Rollback of the harness is a code revert only. The runtime release rollback remains: disable Lead creation, disable RingCentral adoption, disable the narrowest affected Booking/Release/Referral gate, then restore shadow mode while retaining receipts and causal evidence.
- Certification recommendation: **go for isolated application logic only**. It does not authorize production rollout or the separate write-once activation/cutoff.
- The Owner requested combined Lead, Booking, Release, Referral, and RingCentral adoption after deployment. That operational override is recorded separately from certification and requires the release/activation authority in effect at execution time.

## External-action disclosure

At certification completion there had been no Git commit, push, merge, deployment, production database access/mutation, production payload replay, lifecycle flag/Registry mutation, production migration/index apply, or external customer send. Subsequent release actions must be reported in the final production handoff.
