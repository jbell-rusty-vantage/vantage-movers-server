# N-02-01 — Write-once save test is not a persisted round-trip

- **Severity:** nit
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** next edit to `src/models/GranotObservationReceipt.test.ts`

## Current behavior

The save test constructs a document, sets `isNew = false`, mutates `payload`, and expects `save()` to reject. Constructor fields are already `isModified`, so the hook can fail on the first evidence field rather than because payload changed after insert. There is no test that a `processing.*` save succeeds after insert.

The pre-save hook itself is correct for a real persisted document.

## Suggested fix

If a Mongo test database is available: `create` → mutate evidence → `save` rejects; `create` → mutate `processing.state` → `save` succeeds. If not, keep the simulation and add a comment that it is not a persisted round-trip; still add a `doesNotThrow` for allowlisted `processing.*` on `updateOne`.
