# N-02-03 — createdAt-only capture-time path is untested

- **Severity:** nit
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** next edit to `src/services/granotLifecycle/receiptEvidence.test.ts` or receipt migration tests

## Contract

Section 34.1 / UNIT-02 §6.7: capture time from `received_at || createdAt`.

## Current behavior

`resolveCapturedAt` implements `captured_at ?? received_at ?? createdAt`. Tests cover `received_at` and explicit `captured_at`. The `createdAt`-only path is implemented and untested.

## Suggested fix

Add one `[AC-02]` case: legacy row with `createdAt` and no `received_at` / `captured_at` fills `captured_at` and `processing.next_attempt_at` from `createdAt`.
