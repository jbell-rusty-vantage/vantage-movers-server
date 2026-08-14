# W-02-01 — Index apply omits legacy indexes that verify requires

- **Severity:** warning
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** Unit 31, or the next edit to `scripts/migrations/granot-lifecycle-indexes*.ts`

## Contract

Section 34.5: create the named model-contract indexes; verify names/definitions against that contract. UNIT-02 §6.5 / §10: do not drop the two legacy indexes `{ event_type: 1, received_at: -1 }` and `{ processing_status: 1, received_at: 1 }`. `--verify` must match the §6.5 model contract **and** those retained legacy keys.

## Current behavior

`orderedReceiptIndexCreates()` / `createIndexes()` apply only `GRANOT_OBSERVATION_RECEIPT_INDEXES` (the five named Section 9.1 indexes). `verifyReceiptIndexDefinitions()` also requires `GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES` by key.

On the current `granot_webhook_receipts` collection those legacy indexes already exist, so production `--apply` then `--verify` is safe. A greenfield collection that only ran this apply would fail verify until the legacy indexes existed (for example via Mongoose `syncIndexes`, which production often disables).

## Suggested fix

Have index `--apply` create the two legacy key patterns if missing (still unnamed, still not a second name catalog), or document that verify’s legacy-key check is production-only and skip it when the collection is empty and newly created. Prefer creating the missing legacy indexes so verify stays one command.

## Files

- `scripts/migrations/granot-lifecycle-indexes.ts`
- `scripts/migrations/granot-lifecycle-indexes.lib.ts`
- `src/models/GranotObservationReceipt.ts` (`GRANOT_OBSERVATION_RECEIPT_LEGACY_INDEXES`)
