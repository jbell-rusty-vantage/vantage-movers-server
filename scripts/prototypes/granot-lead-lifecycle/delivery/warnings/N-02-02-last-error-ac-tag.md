# N-02-02 — last_error.message test tagged AC-02 instead of AC-35

- **Severity:** nit
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** next edit to `src/models/GranotObservationReceipt.test.ts`

## Current behavior

`last_error.message` maxlength 500 is tested as `[AC-02]`. UNIT-02 §10 and Section 36 give AC-35 ownership of “PII-safe and ≤500 chars.” There is no PII scanner on the message; 500 is all this unit can enforce.

## Suggested fix

Rename the test to `[AC-35] last_error.message is capped at 500 characters` (keep `[AC-02]` only if the same test also proves a processing-shape rule). Do not invent a PII classifier.
