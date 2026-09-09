# Session story-domain-commands-idempotency-2026-09-09T0812Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `idempotency.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 0 / 7
- Recommendations on disk: 262 (through `employee-bookings-migration-apply-safety.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (unvisited) / enumerate

## This pass

- opened new service?: yes — enumerated `domainCommands` runtime modules
- path or skip: recommended → `recommendations/domain-commands-idempotency.md`
- operations named: apply this named command once or hand back the stored apply (replay does not re-run the operation; stored status stays applied); after a first successful apply, complete the pending after-commit work (skip on replay or omitted pending)
- remaining in this service: `commandContext.ts`, `ringcentralProvenance.ts`, `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `commandContext.ts`

## Messages posted

- 2026-09-09T0812Z next

## Ideas parked

- none

## Contradictions

- File is named `idempotency.ts` but owns the transaction, durable command row, replay/conflict, telemetry, and post-commit finalize gate
- `updateBooking` and gated Owner commands call `executeIdempotentCanonicalCommand` then finalize themselves instead of the post-commit wrapper
- Stored result is always `applied`; leftover counters still read compatibility `already_applied`
- When `command_id` is not ObjectId hex, `_id` is minted and `command_id` stays the caller string
- Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false; those callers exist but are not live owner operations
