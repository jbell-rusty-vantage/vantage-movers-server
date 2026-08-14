# N-02-04 — Public manifests store masked IDs only

- **Severity:** nit
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** Unit 31 / separately authorized 34.7 rollback script

## Contract

AC-35: migration manifests/logs report counts and masked IDs only. Section 34.7: manifests must record IDs changed so additive fields can be inspected or unset only by a separately authorized rollback script.

## Current behavior

The public receipt manifest writes `translated_masked_ids` and refused `masked_id` values. Unmasked `_id`s stay in the in-memory plan and are not written. First-4 / last-4 masks are not unique keys. UNIT-02-COMPLETION.md already states that a 34.7 rollback script is still required.

This is the correct AC-35 choice. It is tracked so rollback does not treat the gitignored manifest as an ID list.

## Suggested fix

The 34.7 script should re-scan `granot_webhook_receipts` for additive v2 fields (and the apply manifest’s counts) rather than unmask or trust `aaaa…aaaa` strings. Do not put raw IDs, payloads, or headers in public logs to “make rollback easier.”
